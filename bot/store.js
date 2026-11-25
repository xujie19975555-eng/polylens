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
      // Back up corrupt state instead of silently wiping user subscriptions
      const backup = `${this.filePath}.corrupt.${Date.now()}`;
      try {
        fs.copyFileSync(this.filePath, backup);
      } catch {
        // ignore backup error
      }
      this.state = { users: {}, usedTxHashes: {} };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2) + "\n");
    fs.renameSync(tmp, this.filePath);
  }

  getUser(chatId) {
    const key = String(chatId);
    if (!this.state.users[key]) {
      this.state.users[key] = {
        chatId: key,
        proUntil: 0,
        watchedWallets: [],
        watchedMarkets: [],
      };
    }
    return this.state.users[key];
  }

  getLimits() {
    // V3: Freeze paid TG upgrades while cloud persistence is pending; give 5 free slots
    return { maxWallets: 5, maxMarkets: 5, tier: "FREE" };
  }

  allUsers() {
    return Object.values(this.state.users);
  }
}
