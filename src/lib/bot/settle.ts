/**
 * Let the patient finish before answering.
 *
 * People write in bursts: four photos, then "😆😆😆", then "😆😆", all inside six seconds. Each
 * message starts its own turn, and every turn used to go to the model the moment it landed — so
 * on 16/11/2026 a photo's turn and an emoji's turn ran side by side and the patient got three
 * bubbles in five seconds, the photo's answer split around the emoji's, each asking the same
 * "today 8:00 or tomorrow 3:00?". A receptionist reads the whole burst, then answers once.
 *
 * So a turn bound for the model first waits until the patient has been quiet for `quietMs`
 * (bounded by `maxMs` after its own message, so a chatty patient still gets an answer). While it
 * waits, a newer message that will reach the model itself takes the turn over: this one stops,
 * and the newest turn — whose model reads the whole thread — answers everything. A newer message
 * that will not reach the model (an album photo, a sticker, a "شكرا") only restarts the quiet.
 *
 * Pure apart from the two functions it is handed, so it is tested without a clock or a database.
 */

/** The patient has stopped when nothing new has come for this long. */
export const SETTLE_QUIET_MS = 6000;
/** Never hold an answer longer than this after the message it answers. */
export const SETTLE_MAX_MS = 20000;
/** How often to look for a newer message while waiting. */
export const SETTLE_POLL_MS = 1500;

export type NewerLine = { at: number; takesOver: boolean };

export async function waitForQuiet(opts: {
  /** When this turn's own message arrived. */
  since: number;
  /** The patient's messages after it, and whether each will reach the model itself. */
  newer: () => Promise<NewerLine[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  quietMs?: number;
  maxMs?: number;
  pollMs?: number;
}): Promise<"quiet" | "superseded"> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const quietMs = opts.quietMs ?? SETTLE_QUIET_MS;
  const maxMs = opts.maxMs ?? SETTLE_MAX_MS;
  const pollMs = opts.pollMs ?? SETTLE_POLL_MS;
  const deadline = opts.since + maxMs;
  let lastAt = opts.since;
  for (;;) {
    const t = now();
    const until = Math.min(lastAt + quietMs, deadline);
    if (t >= until) return "quiet";
    await sleep(Math.min(until - t, pollMs));
    // A failed read is "nothing newer": the answer still goes out, exactly as before this rule.
    const lines = await opts.newer().catch(() => [] as NewerLine[]);
    if (lines.some((l) => l.takesOver)) return "superseded";
    for (const l of lines) if (Number.isFinite(l.at) && l.at > lastAt) lastAt = l.at;
  }
}
