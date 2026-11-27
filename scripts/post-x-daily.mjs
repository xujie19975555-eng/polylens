import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatAuditDate } from "./daily-audit.mjs";
import { hasPublishedOnDate } from "./generate-x-drafts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const X_TWEETS_URL = "https://api.x.com/2/tweets";
const REQUIRED_ENV_KEYS = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
];

export function loadDotEnv(envPath, targetEnv = process.env) {
  if (!envPath || !fs.existsSync(envPath)) return false;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2];
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (targetEnv[key] === undefined || targetEnv[key] === "") {
      targetEnv[key] = val;
    }
  }
  return true;
}

export function rfc3986Encode(value) {
  return encodeURIComponent(String(value ?? "")).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function buildOAuth1Header({
  method = "POST",
  url = X_TWEETS_URL,
  apiKey,
  apiSecret,
  accessToken,
  accessTokenSecret,
  nonce = crypto.randomBytes(16).toString("hex"),
  timestamp = String(Math.floor(Date.now() / 1000)),
} = {}) {
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    throw new Error("Missing X OAuth 1.0a credentials");
  }

  const parsed = new URL(url);
  const baseUrl = `${parsed.origin}${parsed.pathname}`;
  const oauthParams = {
    oauth_consumer_key: String(apiKey),
    oauth_nonce: String(nonce),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: String(accessToken),
    oauth_version: "1.0",
  };

  const pairs = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    pairs.push([rfc3986Encode(k), rfc3986Encode(v)]);
  }
  for (const [k, v] of Object.entries(oauthParams)) {
    pairs.push([rfc3986Encode(k), rfc3986Encode(v)]);
  }

  pairs.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return 0;
  });

  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const signatureBase = [
    String(method || "POST").toUpperCase(),
    rfc3986Encode(baseUrl),
    rfc3986Encode(paramString),
  ].join("&");
  const signingKey = `${rfc3986Encode(apiSecret)}&${rfc3986Encode(accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  const headerParams = {
    ...oauthParams,
    oauth_signature: signature,
  };
  const headerEntries = Object.keys(headerParams)
    .sort()
    .map((k) => `${rfc3986Encode(k)}="${rfc3986Encode(headerParams[k])}"`);

  return `OAuth ${headerEntries.join(", ")}`;
}

function extractFencedSection(md, headingPrefix) {
  const escaped = headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`##\\s+${escaped}[^\\n]*\\n+\`\`\`[^\\n]*\\n([\\s\\S]*?)\\n\`\`\``, "m");
  const match = String(md || "").match(re);
  return match ? match[1].trim() : "";
}

export function parseDraftMarkdown(md) {
  const text = String(md || "");
  const angleMatch = text.match(/^-\s+\*\*Angle:\*\*\s+([^\s\n]+)/m);
  const angle = angleMatch ? angleMatch[1].trim() : "whale-tax";
  const mainTweet = extractFencedSection(text, "Main Tweet");
  const replyTweet = extractFencedSection(text, "Self-Reply Tweet");

  if (!mainTweet) {
    throw new Error("Draft markdown is missing a non-empty ## Main Tweet block");
  }
  if (!replyTweet) {
    throw new Error("Draft markdown is missing a non-empty ## Self-Reply Tweet block");
  }

  return { angle, mainTweet, replyTweet };
}

export async function postTweet({
  text,
  replyToId = null,
  credentials,
  fetchImpl = fetch,
  apiUrl = X_TWEETS_URL,
  timeoutMs = 15_000,
} = {}) {
  const tweetText = String(text || "").trim();
  if (!tweetText) {
    throw new Error("Cannot post an empty tweet");
  }
  const authHeader = buildOAuth1Header({
    method: "POST",
    url: apiUrl,
    apiKey: credentials?.apiKey,
    apiSecret: credentials?.apiSecret,
    accessToken: credentials?.accessToken,
    accessTokenSecret: credentials?.accessTokenSecret,
  });

  const payload = replyToId
    ? { text: tweetText, reply: { in_reply_to_tweet_id: String(replyToId) } }
    : { text: tweetText };

  const res = await fetchImpl(apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "PolyLensAutopilot/1.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`X API HTTP ${res.status}: ${detail.replace(/\s+/g, " ").trim().slice(0, 200)}`);
  }

  const data = await res.json();
  const id = data?.data?.id ? String(data.data.id) : "";
  if (!id) {
    throw new Error("X API response missing data.id");
  }
  return { id, text: data?.data?.text || tweetText };
}

function readPublishedLog(logPath) {
  if (!fs.existsSync(logPath)) return { entries: [] };
  const parsed = JSON.parse(fs.readFileSync(logPath, "utf8"));
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return { ...parsed, entries };
}

function writePublishedLog(logPath, logData) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `${JSON.stringify(logData, null, 2)}\n`, "utf8");
}

export async function publishDailyXThread({
  rootDir = ROOT_DIR,
  dateStr = formatAuditDate(),
  env = process.env,
  fetchImpl = fetch,
  dryRun = false,
  apiUrl = X_TWEETS_URL,
} = {}) {
  const logPath = path.join(rootDir, "ops", "published-log.json");
  const logData = readPublishedLog(logPath);

  if (hasPublishedOnDate(logData, dateStr, "x")) {
    return { status: "skipped_already_published", date: dateStr };
  }

  const draftPath = path.join(rootDir, "ops", "drafts", `${dateStr}.md`);
  if (!fs.existsSync(draftPath)) {
    throw new Error(`Missing daily draft file: ${draftPath}`);
  }
  const { angle, mainTweet, replyTweet } = parseDraftMarkdown(
    fs.readFileSync(draftPath, "utf8")
  );

  if (env === process.env) {
    loadDotEnv(path.join(rootDir, ".env"), env);
  }

  const missing = REQUIRED_ENV_KEYS.filter((k) => !String(env?.[k] || "").trim());
  if (missing.length > 0) {
    return {
      status: "unconfigured",
      date: dateStr,
      missing,
      needsHuman: true,
    };
  }

  if (dryRun) {
    return {
      status: "dry_run",
      date: dateStr,
      angle,
      mainLength: mainTweet.length,
      replyLength: replyTweet.length,
    };
  }

  const credentials = {
    apiKey: String(env.X_API_KEY).trim(),
    apiSecret: String(env.X_API_SECRET).trim(),
    accessToken: String(env.X_ACCESS_TOKEN).trim(),
    accessTokenSecret: String(env.X_ACCESS_TOKEN_SECRET).trim(),
  };
  const handle = String(env.X_HANDLE || "xujie19975555").replace(/^@/, "").trim() || "xujie19975555";

  const mainRes = await postTweet({
    text: mainTweet,
    credentials,
    fetchImpl,
    apiUrl,
  });
  const mainUrl = `https://x.com/${handle}/status/${mainRes.id}`;

  try {
    const replyRes = await postTweet({
      text: replyTweet,
      replyToId: mainRes.id,
      credentials,
      fetchImpl,
      apiUrl,
    });
    const replyUrl = `https://x.com/${handle}/status/${replyRes.id}`;
    logData.entries.push({
      date: dateStr,
      channel: "x",
      mode: "api",
      account: `@${handle}`,
      angle,
      url: mainUrl,
      replyUrl,
    });
    writePublishedLog(logPath, logData);
    return {
      status: "published",
      date: dateStr,
      angle,
      url: mainUrl,
      replyUrl,
    };
  } catch (err) {
    // Persist the main tweet immediately so retries never double-post the thread root.
    logData.entries.push({
      date: dateStr,
      channel: "x",
      mode: "api",
      account: `@${handle}`,
      angle,
      url: mainUrl,
      replyUrl: null,
      replyError: err?.message || "Reply failed",
    });
    writePublishedLog(logPath, logData);
    return {
      status: "partial_main_only",
      date: dateStr,
      angle,
      url: mainUrl,
      error: err?.message || "Reply failed",
    };
  }
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dateArg = args.find((a) => a.startsWith("--date="));
  const dateStr = dateArg ? dateArg.slice("--date=".length) : formatAuditDate();

  try {
    const result = await publishDailyXThread({ dateStr, dryRun });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "partial_main_only") {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  }
}
