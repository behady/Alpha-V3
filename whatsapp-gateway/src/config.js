/**
 * Everything the gateway reads from the environment, checked once at boot.
 *
 * Two secrets, deliberately separate:
 *   GATEWAY_ADMIN_KEY   — what the web app presents to create instances and fetch QR codes.
 *                         Whoever holds it can connect or disconnect any clinic's number.
 *   GATEWAY_SESSION_KEY — encrypts the WhatsApp login material on disk (see authState.js).
 *                         Whoever holds it AND the data folder holds every clinic's WhatsApp.
 * A leaked admin key is rotated by changing one env var; a leaked session key means every
 * clinic scans again. Keeping them apart keeps the second, worse case rarer.
 */

function required(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    console.error(`[gateway] ${name} is not set. See .env.example.`);
    process.exit(1);
  }
  return v;
}

const sessionKey = required("GATEWAY_SESSION_KEY");
if (!/^[0-9a-f]{64}$/i.test(sessionKey)) {
  console.error("[gateway] GATEWAY_SESSION_KEY must be 64 hex characters (32 bytes). Generate one with: openssl rand -hex 32");
  process.exit(1);
}

const adminKey = required("GATEWAY_ADMIN_KEY");
if (adminKey.length < 24) {
  console.error("[gateway] GATEWAY_ADMIN_KEY is too short. Generate one with: openssl rand -hex 32");
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  dataDir: process.env.DATA_DIR || "./data",
  adminKey,
  sessionKey: Buffer.from(sessionKey, "hex"),
  /** Where the world reaches this gateway — used to build media URLs in webhooks. */
  publicUrl: String(process.env.GATEWAY_PUBLIC_URL || "").replace(/\/$/, ""),

  /*
   * Sending pace. WhatsApp bans numbers for behaving like machines, and the cheapest tell is a
   * burst of messages with zero milliseconds between them. Every send waits a random gap after
   * the previous one, and no instance sends more than `perMinuteCap` in any rolling minute —
   * anything beyond that waits its turn rather than being refused, so a reminder batch still
   * goes out, just at a human pace.
   */
  minGapMs: Number(process.env.SEND_MIN_GAP_MS || 1500),
  maxGapMs: Number(process.env.SEND_MAX_GAP_MS || 4000),
  perMinuteCap: Number(process.env.SEND_PER_MINUTE_CAP || 20),

  /** Inbound voice notes and photos are kept this long for the web app to fetch, then deleted. */
  mediaTtlMs: Number(process.env.MEDIA_TTL_HOURS || 48) * 3600 * 1000,
  maxMediaBytes: 16 * 1024 * 1024,

  logLevel: process.env.LOG_LEVEL || "info",
};
