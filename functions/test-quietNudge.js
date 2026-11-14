/**
 * Offline checks for the quiet nudge — run with `node test-quietNudge.js`.
 *
 * No Firebase, no network. Two things are pinned here. Who gets nudged: once per silence, inside
 * 20–90 minutes, never after a "no", a booking, a handoff or a stop. And on which line: the nudge
 * was written for the official Meta number only, so a clinic on its own QR line — the kind that
 * runs Click-to-WhatsApp ads and loses half its chats after the first answer — was never nudged
 * at all, with the switch showing "on" in its settings.
 */
const assert = require("node:assert");
const { nudgeText, nudgeRoute, nudgeAddress, shouldNudge, sendNudge } = require("./quietNudge");

const MIN = 60 * 1000;
const now = Date.UTC(2026, 10, 14, 15, 0);
/** A chat where the assistant answered half an hour ago and the patient has said nothing since. */
const quiet = (over = {}) => ({
  aiUsed: true,
  lastDirection: "out",
  lastAuthor: "bot",
  lastInboundAt: now - 31 * MIN,
  lastMessageAt: now - 30 * MIN,
  phone: "+201280146636",
  state: "awaiting_choice",
  ...over,
});

// ── who ─────────────────────────────────────────────────────────────────────────────────────────
assert.equal(shouldNudge("280146636", quiet(), now), true, "half an hour of silence after the bot spoke");
assert.equal(shouldNudge("play_abc", quiet(), now), false, "never the test chat");
assert.equal(shouldNudge("1", quiet({ aiUsed: false }), now), false, "only chats the assistant took part in");
assert.equal(shouldNudge("1", quiet({ needsHuman: true }), now), false, "a person has it");
assert.equal(shouldNudge("1", quiet({ botPaused: true }), now), false);
assert.equal(shouldNudge("1", quiet({ outcome: "booked" }), now), false, "they booked");
assert.equal(shouldNudge("1", quiet({ optedOut: true }), now), false, "they said stop");
assert.equal(shouldNudge("1", quiet({ declinedAtMs: now - 2 * 24 * 60 * MIN }), now), false, "not now means not now");
assert.equal(shouldNudge("1", quiet({ lastDirection: "in", lastAuthor: "patient" }), now), false, "the patient spoke last");
assert.equal(shouldNudge("1", quiet({ lastAuthor: "staff" }), now), false, "a receptionist spoke last");
assert.equal(shouldNudge("1", quiet({ lastMessageAt: now - 10 * MIN, lastInboundAt: now - 11 * MIN }), now), false, "too soon");
assert.equal(shouldNudge("1", quiet({ lastMessageAt: now - 120 * MIN, lastInboundAt: now - 121 * MIN }), now), false, "too late");
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: now - 5 * MIN }), now), false, "one nudge per silence");
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: now - 5 * 60 * MIN }), now), true, "they wrote again since the last nudge");
assert.equal(shouldNudge("1", quiet({ state: "booking_day" }), now), false, "a list is already on their screen");
assert.equal(shouldNudge("1", quiet({ lastInboundAt: 0 }), now), false, "they never wrote");

// ── which line ──────────────────────────────────────────────────────────────────────────────────
const metaSecret = { metaWhatsapp: { token: "t", phoneNumberId: "123" } };
const gatewaySecret = { wapilot: { instanceId: "clinic-1", apiToken: "k", apiBaseUrl: "https://wa.example.app/api/v2/", provider: "alpha" } };
assert.equal(nudgeRoute({}), null, "no line, no nudge");
assert.equal(nudgeRoute({ wapilot: { instanceId: "x" } }), null, "a line with no key is no line");
assert.equal(nudgeRoute(metaSecret).kind, "meta");
assert.equal(nudgeRoute({ ...metaSecret, ...gatewaySecret }).kind, "meta", "the official number wins when a clinic has both");
const gw = nudgeRoute(gatewaySecret);
assert.equal(gw.kind, "gateway", "a clinic on its own QR line is nudged through that line");
assert.equal(gw.url, "https://wa.example.app/api/v2/clinic-1/send-message");
assert.equal(nudgeRoute({ wapilot: { instanceId: "i", token: "old-name" } }).url, "https://api.wapilot.net/api/v2/i/send-message", "older field names and the default host");
assert.equal(nudgeRoute({ wapilot: { instanceId: "i", apiToken: "k", sendUrl: "https://own.example/send" } }).url, "https://own.example/send");

// ── where on that line ──────────────────────────────────────────────────────────────────────────
assert.equal(nudgeAddress({ phone: "+201280146636" }, "meta"), "201280146636");
assert.equal(nudgeAddress({ phone: "+201280146636" }, "gateway"), "201280146636@c.us");
assert.equal(nudgeAddress({ phone: "201280146636" }, "gateway"), "201280146636@c.us", "a number saved without its plus");
// Behind WhatsApp's privacy id there is no phone, but the id itself is a valid reply address on the
// gateway — and it is how most ad chats arrive.
assert.equal(nudgeAddress({ phone: "172357054414966@lid" }, "gateway"), "172357054414966@lid");
assert.equal(nudgeAddress({ phone: "172357054414966@lid" }, "meta"), "", "the official API cannot address a privacy id");
assert.equal(nudgeAddress({ phone: "" }, "gateway"), "");
assert.equal(nudgeAddress({}, "meta"), "");

// ── what it says ────────────────────────────────────────────────────────────────────────────────
assert.equal(nudgeText({ patientName: "مروة محمد ابو ضيف", lastInterest: "تقويم" }), "مروة، لسه معانا؟ 😊 لو حبيت أحجزلك كشف عشان تقويم أو عندك أي سؤال تاني، أنا هنا.");
assert.equal(nudgeText({ lastInterest: "كشف" }), "لسه معانا؟ 😊 لو حبيت أحجزلك كشف أو عندك أي سؤال تاني، أنا هنا.");
// Someone who came from an ad for an offer is booking the offer, not a check-up: the confirmation
// already leaves the consultation fee out for them, and the nudge must not bring the word back.
const adNudge = nudgeText({ patientName: "فاطمة خبير", lastInterest: "تبييض الأسنان", ad: { headline: "عرض التبييض" } });
assert.ok(!/كشف/.test(adNudge), "no check-up wording for an ad chat");
assert.equal(adNudge, "فاطمة، لسه معانا؟ 😊 لو حبيت أحجزلك ميعاد أو عندك أي سؤال تاني، أنا هنا.");

// ── the send itself ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const calls = [];
  const fetchOk = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.1" }] }), text: async () => "{}" };
  };
  const viaMeta = await sendNudge(nudgeRoute(metaSecret), "201280146636", "hi", fetchOk);
  assert.deepEqual(viaMeta, { ok: true, channel: "meta", waMessageId: "wamid.1" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/123/messages");
  assert.equal(calls[0].init.headers.Authorization, "Bearer t");

  const viaGateway = await sendNudge(gw, "172357054414966@lid", "hi", fetchOk);
  assert.deepEqual(viaGateway, { ok: true, channel: "wapilot" });
  assert.equal(calls[1].url, "https://wa.example.app/api/v2/clinic-1/send-message");
  assert.equal(calls[1].init.headers.Token, "k");
  assert.deepEqual(JSON.parse(calls[1].init.body), { chat_id: "172357054414966@lid", text: "hi", message: "hi" });

  // A line that refuses, or is unreachable, is a failed nudge — never a thrown job.
  const refused = await sendNudge(gw, "x@c.us", "hi", async () => ({ ok: false, json: async () => ({}), text: async () => "no" }));
  assert.deepEqual(refused, { ok: false, channel: "wapilot" });
  const down = await sendNudge(gw, "x@c.us", "hi", async () => { throw new Error("ECONNRESET"); });
  assert.deepEqual(down, { ok: false, channel: "wapilot" });

  console.log("quietNudge: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
