import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BotStore } from "./store.js";
import { handleBotCommand } from "./commands.js";
import { pollWatchAlerts } from "./poller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env");

if (!process.env.TELEGRAM_BOT_TOKEN && fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN env var or .env entry.");
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${TOKEN}`;
const store = new BotStore();

async function tgCall(method, body, timeoutMs = 35_000) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Telegram HTTP ${res.status} on ${method}`);
  }
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API error on ${method}: ${data.description || JSON.stringify(data)}`);
  }
  return data;
}

async function sendMessage(chatId, text) {
  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  }, 10_000);
}

let offset = 0;
let polling = false;
console.log("PolyLens Telegram Alert Bot started (60s alert poll + long polling)...");

setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    await pollWatchAlerts(store, sendMessage);
  } catch (err) {
    console.error("Poll error:", err?.message || err);
  } finally {
    polling = false;
  }
}, 60_000);

while (true) {
  try {
    const data = await tgCall("getUpdates", { offset, timeout: 25 }, 35_000);
    for (const upd of data.result || []) {
      offset = upd.update_id + 1;
      const msg = upd.message;
      if (!msg?.text || !msg.chat?.id) continue;
      const reply = await handleBotCommand(msg.chat.id, msg.text, store);
      await sendMessage(msg.chat.id, reply);
    }
  } catch (err) {
    console.error("Telegram loop error:", err?.message || err);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
