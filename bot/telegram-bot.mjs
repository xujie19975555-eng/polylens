import { BotStore } from "./store.js";
import { handleBotCommand } from "./commands.js";
import { pollWatchAlerts } from "./poller.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error(
    "Missing TELEGRAM_BOT_TOKEN env var. Create a bot via @BotFather, then run:\n  TELEGRAM_BOT_TOKEN=123:abc npm run bot"
  );
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${TOKEN}`;
const store = new BotStore();

async function tgCall(method, body) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendMessage(chatId, text) {
  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

let offset = 0;
console.log("PolyLens Telegram Alert Bot started (60s alert poll + long polling)...");

setInterval(() => {
  pollWatchAlerts(store, sendMessage).catch((err) =>
    console.error("Poll error:", err?.message || err)
  );
}, 60_000);

while (true) {
  try {
    const data = await tgCall("getUpdates", { offset, timeout: 25 });
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
