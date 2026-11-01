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
