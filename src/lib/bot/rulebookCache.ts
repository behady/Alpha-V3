import { createHash } from "node:crypto";
import { GoogleAICacheManager } from "@google/generative-ai/server";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * The assistant's rulebook, uploaded to Google once instead of with every reply.
 *
 * Every WhatsApp reply used to carry ~4,500 tokens of instructions that are identical for every
 * clinic and every patient — 85% of the bill — and Google's automatic caching never caught it:
 * thirty replies seconds apart with the same prefix, every one billed in full. An explicit cache
 * charges a tenth of the input rate for those tokens and costs $0.50 per million tokens per hour
 * to keep, which for one shared rulebook is about a dollar and a half a month across all clinics.
 *
 * ONE cache, shared, not one per clinic. A clinic's own prices and ready answers are a tenth the
 * size of the rulebook, and a cache each would cost more to keep than it saved. So only what is
 * word-for-word the same everywhere goes in here, and the caller sends the rest with the turn.
 *
 * Keyed by a hash of the text: a deploy that changes a rule creates a new cache by itself, and an
 * old one simply expires. The current name is remembered in this process and in Firestore, so
 * the many short-lived lambdas that answer WhatsApp share one instead of each making their own.
 *
 * Every failure returns null and the caller falls back to sending the rulebook inline — slower to
 * bill, identical to answer. A caching layer must never be the reason a patient got no reply.
 */

const COLLECTION = "system_config";
const DOC = "gemini_rulebook_cache";
/** Long enough that a quiet clinic's next message still finds it warm; short enough that a bad deploy is gone by lunch. */
const TTL_SECONDS = 2 * 60 * 60;
/** Renew when this close to expiry, so a cache in steady use is never allowed to lapse mid-day. */
const RENEW_BEFORE_MS = 15 * 60 * 1000;

export interface RulebookCache {
  /** The resource name Google gave it, `cachedContents/…`. */
  name: string;
  /** How many tokens the rulebook occupies — what the meter should report as cached on a hit. */
  tokens: number;
  hash: string;
  expiresAt: number;
}

/** One per process: the lambda that answered the last message very likely answers the next. */
let memo: RulebookCache | null = null;

function hashOf(model: string, text: string): string {
  return createHash("sha256").update(`${model}\n${text}`).digest("hex").slice(0, 16);
}

function fresh(c: RulebookCache | null, hash: string): boolean {
  return Boolean(c && c.hash === hash && c.expiresAt - Date.now() > RENEW_BEFORE_MS);
}

async function readStored(): Promise<RulebookCache | null> {
  try {
    const snap = await adminDb().collection(COLLECTION).doc(DOC).get();
    const d = snap.data();
    if (!d || typeof d.name !== "string") return null;
    return { name: d.name, tokens: Number(d.tokens) || 0, hash: String(d.hash || ""), expiresAt: Number(d.expiresAt) || 0 };
  } catch {
    return null;
  }
}

async function store(c: RulebookCache): Promise<void> {
  try {
    const ref = adminDb().collection(COLLECTION).doc(DOC);
    // Firestore refuses a field set to undefined, so the first-run stamp is added only when it is
    // genuinely absent — this is the before/after line in the cost report, and it must never move.
    const payload: Record<string, unknown> = { ...c, updatedAt: new Date() };
    const existing = (await ref.get()).data();
    if (!existing?.firstCreatedAt) payload.firstCreatedAt = new Date();
    await ref.set(payload, { merge: true });
  } catch {
    // Remembering it is a convenience; the next lambda will make its own if this write is lost.
  }
}

/**
 * The cache to use for this rulebook, creating or renewing one as needed. Null means "send it
 * inline this time" — never an error.
 */
export async function getRulebookCache(args: { apiKey: string; model: string; systemText: string }): Promise<RulebookCache | null> {
  if (process.env.GEMINI_RULEBOOK_CACHE === "off") return null;
  const hash = hashOf(args.model, args.systemText);
  if (memo && fresh(memo, hash)) return memo;

  const stored = await readStored();
  if (stored && fresh(stored, hash)) {
    memo = stored;
    return stored;
  }

  const manager = new GoogleAICacheManager(args.apiKey);

  // A still-valid cache that is merely close to expiry is renewed rather than replaced: creating
  // one costs a token-counting round trip, and two caches alive at once cost double to keep.
  const renewable = [memo, stored].find((c): c is RulebookCache => Boolean(c && c.hash === hash && c.expiresAt > Date.now()));
  if (renewable) {
    try {
      const updated = await manager.update(renewable.name, { cachedContent: { ttlSeconds: TTL_SECONDS } });
      const next = { ...renewable, expiresAt: expiresAtOf(updated.expireTime) };
      memo = next;
      await store(next);
      return next;
    } catch {
      // Gone on Google's side (deleted, expired early): fall through and make a new one.
    }
  }

  try {
    const created = await manager.create({
      model: args.model,
      displayName: `alpha-rulebook-${hash}`,
      systemInstruction: args.systemText,
      // The API requires the field; the rulebook is entirely the system instruction, so the
      // conversation part of the cache is a single neutral turn the model is told to ignore.
      contents: [{ role: "user", parts: [{ text: "(بداية المحادثة)" }] }],
      ttlSeconds: TTL_SECONDS,
    });
    const next: RulebookCache = {
      name: created.name || "",
      // The API returns the size of what it stored; the SDK's type for the response omits it.
      tokens: Number((created as { usageMetadata?: { totalTokenCount?: number } }).usageMetadata?.totalTokenCount) || 0,
      hash,
      expiresAt: expiresAtOf(created.expireTime),
    };
    if (!next.name) return null;
    memo = next;
    await store(next);
    return next;
  } catch (e) {
    console.warn("[rulebookCache] could not create cache; sending inline:", e instanceof Error ? e.message : e);
    return null;
  }
}

function expiresAtOf(expireTime: string | undefined): number {
  const ms = expireTime ? Date.parse(expireTime) : NaN;
  return Number.isFinite(ms) ? ms : Date.now() + TTL_SECONDS * 1000;
}

/** For the cost report: when caching first went live, so rows can be split into before and after. */
export async function rulebookCacheFirstUsedAt(): Promise<number | null> {
  try {
    const snap = await adminDb().collection(COLLECTION).doc(DOC).get();
    const v = snap.data()?.firstCreatedAt;
    const ms = v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : NaN);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
