/**
 * When a publish test passes, in one place: runReplay decides with it and the onboarding screen
 * names the failed conditions with it. Pure, no imports, safe for the browser bundle.
 *
 * Run: npm run test:pro-replay
 */

/** Unavailable turns and unexpected hand-offs are each tolerated up to this share of the turns. */
export const REPLAY_TOLERANCE = 0.25;

export const replayLimit = (turns: number): number => Math.floor(turns * REPLAY_TOLERANCE);

export type ReplayShortfall = "no_turns" | "breaks" | "unavailable" | "handoffs";

/** Why Pro could not answer a turn, in a few words the screen can name. */
export type UnavailableKind = "rate_limit" | "unreachable" | "timeout" | "deadline" | "no_api_key" | "other";

/** The kind a raw failure reason (an error message, or one of the brain's own codes) amounts to. */
export function unavailableKind(reason: string): UnavailableKind {
  const r = String(reason || "");
  if (r === "deadline") return "deadline";
  if (r === "no_api_key") return "no_api_key";
  if (r === "ai_timeout" || /timed? ?out|DEADLINE_EXCEEDED/i.test(r)) return "timeout";
  if (/\b429\b|quota|RESOURCE_EXHAUSTED|Too Many Requests|rate limit/i.test(r)) return "rate_limit";
  if (/Error fetching|fetch failed|ECONNRESET|ETIMEDOUT|\b50[234]\b|overloaded|UNAVAILABLE|network/i.test(r)) return "unreachable";
  return "other";
}

/** Failures that may pass on their own a moment later: the replay tries such a turn once more. */
export const RETRY_KINDS: ReadonlySet<UnavailableKind> = new Set<UnavailableKind>(["rate_limit", "unreachable", "timeout"]);

/** The conditions a run did not meet; none means it passed. Missing counts (old docs) read as 0. */
export function replayShortfalls(s: { turns: number; unavailable: number; unexpectedHandoffs?: number; breaks: unknown[] }): ReplayShortfall[] {
  const out: ReplayShortfall[] = [];
  const limit = replayLimit(s.turns);
  if (!(s.turns > 0)) out.push("no_turns");
  if (s.breaks.length > 0) out.push("breaks");
  if (s.unavailable > limit) out.push("unavailable");
  if ((s.unexpectedHandoffs ?? 0) > limit) out.push("handoffs");
  return out;
}
