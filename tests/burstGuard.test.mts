// The bot must not talk in bursts: at most a few bubbles per minute to one person, and one
// answer per album of photos. Run with tsx. The atomic media claim needs Firestore and is not
// exercised here; the per-minute arithmetic and the allowance it feeds are.
import assert from "node:assert/strict";
import { MAX_REPLIES_PER_MINUTE, REPLY_BURST_MS, repliesInLastMinute } from "../src/lib/bot/burstGuard";
import { replyAllowance, type BotConversation } from "../src/lib/bot/conversation";

const now = 1_800_000_000_000;
const s = (secondsAgo: number) => now - secondsAgo * 1000;

assert.equal(repliesInLastMinute(undefined, now), 0);
assert.equal(repliesInLastMinute([], now), 0);
assert.equal(repliesInLastMinute([s(5), s(20), s(59)], now), 3);
assert.equal(repliesInLastMinute([s(5), s(61), s(3600)], now), 1, "a minute-old stamp has expired");
assert.equal(repliesInLastMinute([now + 5000], now), 0, "a stamp from the future is not counted");
assert.equal(REPLY_BURST_MS, 60_000);

const conv = (recentReplies: number[], extra: Partial<BotConversation> = {}): BotConversation => ({
  phoneKey: "201012345678",
  phone: "+201012345678",
  state: "awaiting_choice",
  turns: 4,
  lastMessageAt: now,
  windowStartedAt: now - 10 * 60_000,
  repliesInWindow: 4,
  recentReplies,
  ...extra,
});

// Under the per-minute cap: allowed. At it: held as a burst, which is not the hourly limit.
assert.deepEqual(replyAllowance(conv([s(5), s(15), s(30), s(45)]), now), { allowed: true }, "a fast booking — menu, days, times, confirm — is never held");
assert.deepEqual(replyAllowance(conv([s(5), s(15), s(30), s(45), s(55)]), now), { allowed: false, reason: "burst" });
assert.equal(MAX_REPLIES_PER_MINUTE, 5);

// The burst clears by itself as the stamps age out — no handoff had to be marked handled.
assert.deepEqual(replyAllowance(conv([s(70), s(80), s(90)]), now), { allowed: true });

// The hourly cap still wins when it is the one that was hit, and reads as itself.
assert.deepEqual(replyAllowance(conv([], { repliesInWindow: 15 }), now), { allowed: false, reason: "rate_limited" });
assert.deepEqual(replyAllowance(conv([], { turns: 40 }), now), { allowed: false, reason: "too_many_turns" });

console.log("burstGuard: all checks passed");
