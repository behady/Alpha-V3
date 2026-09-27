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
   * Sending rules (see policy.js for the reasoning). Two kinds of message:
   *
   *   reply      — the patient wrote to this number in the last 24 h. Goes out at once, any hour,
   *                with a short human gap.
   *   proactive  — the clinic is starting the conversation (reminders, recalls, welcomes).
   *                Clinic hours only; held until the window opens otherwise; paced with a long
   *                random gap; counted against a daily allowance that grows with the number's age.
   *
   * Decided 2026-09-27: the window is 10:00–22:00 Cairo; anything outside waits for 10:00 the
   * next day and then leaves with random waits between messages.
   */
  sendTz: process.env.SEND_TZ || "Africa/Cairo",
  windowStartHour: Number(process.env.SEND_WINDOW_START || 10),
  windowEndHour: Number(process.env.SEND_WINDOW_END || 22),

  replyGapMs: [Number(process.env.REPLY_GAP_MIN_MS || 1500), Number(process.env.REPLY_GAP_MAX_MS || 4000)],
  proactiveGapMs: [Number(process.env.PROACTIVE_GAP_MIN_MS || 10_000), Number(process.env.PROACTIVE_GAP_MAX_MS || 30_000)],

  /** First-contacts per day: base × growth^daysLinked, capped at max. Day 0 → 20, day 6+ → 200. */
  warmup: {
    base: Number(process.env.WARMUP_BASE || 20),
    growth: Number(process.env.WARMUP_GROWTH || 1.5),
    max: Number(process.env.DAILY_PROACTIVE_MAX || 200),
  },

  /**
   * Emergency brake. A 403 from WhatsApp, or the phone logging this device out repeatedly in a
   * short span, is what a restriction looks like from here; reconnecting in a loop through it is
   * how a 24-hour restriction becomes a permanent ban. The instance stops and waits for a person.
   */
  logoutStormCount: Number(process.env.LOGOUT_STORM_COUNT || 3),
  logoutStormWindowMs: Number(process.env.LOGOUT_STORM_WINDOW_MIN || 15) * 60 * 1000,

  /** Inbound voice notes and photos are kept this long for the web app to fetch, then deleted. */
  mediaTtlMs: Number(process.env.MEDIA_TTL_HOURS || 48) * 3600 * 1000,
  maxMediaBytes: 16 * 1024 * 1024,

  logLevel: process.env.LOG_LEVEL || "info",
};
