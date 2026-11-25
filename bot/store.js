import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STORE_PATH = path.resolve(__dirname, "data/state.json");

export class BotStore {
  constructor(filePath = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    this.state = { users: {}, usedTxHashes: {} };
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = {
        users: parsed.users || {},
        usedTxHashes: parsed.usedTxHashes || {},
      };
    } catch {
      this.state = { users: {}, usedTxHashes: {} };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2) + "\n");
  }

  getUser(chatId) {
    const key = String(chatId);
    if (!this.state.users[key]) {
      this.state.users[key] = {
        chatId: key,
        proUntil: 0,
        whaleStreamMinUsd: 0,
        watchedWallets: [],
        watchedMarkets: [],
      };
    }
    return this.state.users[key];
  }

  isPro(chatId, nowSec = Math.floor(Date.now() / 1000)) {
    return (this.getUser(chatId).proUntil || 0) > nowSec;
  }

  getLimits(chatId, nowSec = Math.floor(Date.now() / 1000)) {
    return this.isPro(chatId, nowSec)
      ? { maxWallets: 20, maxMarkets: 20, tier: "PRO" }
      : { maxWallets: 1, maxMarkets: 1, tier: "FREE" };
  }

  isTxUsed(txHash) {
    return Boolean(this.state.usedTxHashes[String(txHash || "").toLowerCase()]);
  }

  markTxUsed(txHash, chatId, chain) {
    this.state.usedTxHashes[String(txHash).toLowerCase()] = {
      chatId: String(chatId),
      chain,
      usedAt: Math.floor(Date.now() / 1000),
    };
    this.save();
  }

  allUsers() {
    return Object.values(this.state.users);
  }
}
