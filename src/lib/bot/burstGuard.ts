import { claimOnce } from "./replyClaims";

/**
 * Two guards against the bot talking in bursts.
 *
 * A forwarded album — seven floor plans sent to the clinic by mistake — arrived as seven
 * separate webhook deliveries inside one minute. Each photo was read (a credit each), each got
 * "we received your photo", and the model answered each one again: twelve bot bubbles in sixty
 * seconds under a picture of somebody's terrace. The hourly cap did not notice, because twelve
 * is under fifteen. Nothing about that is a conversation.
 *
 * 1. Media burst: the first captionless photo or voice note in a window is the one that gets
 *    read and answered; the rest are kept on the thread for staff and answered by nobody.
 *    Claimed atomically, so seven deliveries racing each other still yield one answer.
 * 2. Reply burst: however the messages arrive, the bot says at most a few things per minute to
 *    one person. Text floods hit this one; it is the backstop, not the first line.
 */

/** Photos or voice notes arriving within this of the first one are the same album. */
export const MEDIA_BURST_MS = 90_000;
/**
 * Bot bubbles to one person inside a minute. A fast booking is four (menu, days, times, the
 * confirmation) and must never be held; the album that prompted this was twelve.
 */
export const MAX_REPLIES_PER_MINUTE = 5;
export const REPLY_BURST_MS = 60_000;

/**
 * True for the first captionless media message from this chat in the window, false for the
 * album that follows it. Fails open (true) on any storage error — a swallowed photo of a
 * swollen face is worse than a duplicate acknowledgement.
 */
export async function claimMediaTurn(clinicId: string, phoneKey: string, now: number = Date.now()): Promise<boolean> {
  const key = `media_${String(phoneKey).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
  return claimOnce(clinicId, key, MEDIA_BURST_MS, now);
}

/** How many of these reply timestamps fall inside the last minute. */
export function repliesInLastMinute(stamps: readonly number[] | undefined, now: number): number {
  if (!stamps?.length) return 0;
  const floor = now - REPLY_BURST_MS;
  return stamps.filter((t) => Number(t) > floor && Number(t) <= now).length;
}
