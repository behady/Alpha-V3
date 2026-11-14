/**
 * Offline checks for the quiet nudge — run with `node test-quietNudge.js`.
 *
 * No Firebase, no network. Three things are pinned here. Who gets nudged: once a week at most,
 * inside 20–90 minutes of silence, never after a "no", a booking, a handoff, a stop, the bot's own
 * goodbye, or to someone who already holds a visit. What it says: varied, gender-neutral, never
 * the stored interest pasted in, English for an English chat. And on which line: the nudge
 * was written for the official Meta number only, so a clinic on its own QR line — the kind that
 * runs Click-to-WhatsApp ads and loses half its chats after the first answer — was never nudged
 * at all, with the switch showing "on" in its settings.
 */
const assert = require("node:assert");
const { nudgeText, nudgeRoute, nudgeAddress, shouldNudge, sendNudge, standingAppointment, offeredTimeAhead } = require("./quietNudge");

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
// Once a week, not once per silence. Each reply used to re-arm it: on 14/11 a patient answered the
// nudge ("لا العنوان بعيد عليا", "تسلمي"), got a reply, and was nudged again 45 minutes later.
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: now - 45 * MIN }), now), false, "they wrote again since the nudge: still one nudge");
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: now - 5 * 60 * MIN }), now), false, "nor five hours later");
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: now - 6 * 24 * 60 * MIN }), now), false, "one nudge per person per week");
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: now - 8 * 24 * 60 * MIN }), now), true, "a new enquiry next week can be nudged");
assert.equal(shouldNudge("1", quiet({ nudgedAtMs: 0 }), now), true, "never nudged");
// 14/11: "شكرا" -> "العفو 🙏 تحت أمر حضرتك في أي وقت." -> 23 minutes later "لسه معانا؟".
assert.equal(shouldNudge("1", quiet({ lastReason: "thanks" }), now), false, "the bot already said goodbye");
// "تأكيد الحضور" on a reminder is answered "تمام، مستنينك 🦷 + the visit"; three such patients were
// then asked "لسه معانا؟ لو حبيت أحجزلك كشف" half an hour later.
assert.equal(shouldNudge("1", quiet({ lastReason: "ack_confirmed" }), now), false, "they just confirmed their visit");
assert.equal(shouldNudge("1", quiet({ lastReason: "ack" }), now), false, "the bot's own 'we're here if you need us'");
assert.equal(shouldNudge("1", quiet({ lastReason: "ai_answer" }), now), true, "an ordinary answer is not a goodbye");
assert.equal(shouldNudge("1", quiet({ state: "booking_day" }), now), false, "a list is already on their screen");
assert.equal(shouldNudge("1", quiet({ lastInboundAt: 0 }), now), false, "they never wrote");

// ── already holds a visit ───────────────────────────────────────────────────────────────────────
// The chat says "booked" only when the bot booked. Visits booked at the desk were nudged: one
// patient had written "انا في عيادة دكتور احمد دلوقتي" half an hour before "لو حبيت أحجزلك كشف".
assert.equal(standingAppointment([{ date: "2026-11-15", status: "Confirmed" }], "2026-11-14"), true, "tomorrow");
assert.equal(standingAppointment([{ date: "2026-11-14", status: "Completed" }], "2026-11-14"), true, "came in today");
assert.equal(standingAppointment([{ date: "2026-11-14T18:00", status: "" }], "2026-11-14"), true, "no status reads Scheduled");
assert.equal(standingAppointment([{ date: "2026-11-20", status: "Scheduled" }], "2026-11-14"), true, "next week");
assert.equal(standingAppointment([{ date: "2026-11-15", status: "Cancelled" }, { date: "2026-11-16", status: "No Show" }], "2026-11-14"), false, "a cancelled or missed visit does not count");
assert.equal(standingAppointment([{ date: "2026-11-13", status: "Completed" }], "2026-11-14"), false, "a past visit does not block");
assert.equal(standingAppointment([{ date: "" }, {}], "2026-11-14"), false, "rows with no date");
assert.equal(standingAppointment([], "2026-11-14"), false);
assert.equal(standingAppointment(null, "2026-11-14"), false);

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
// The stored interest is never pasted into the line: "كشف عشان كشف", "كشف عشان فينير", "كشف عشان
// زراعه مصري" were all that field dropped into a sentence nobody read before it went.
assert.equal(nudgeText({ patientName: "مروة محمد ابو ضيف", lastInterest: "تقويم" }), "مروة، لسه معانا؟ 😊 لو حبيت أحجزلك ميعاد أو عندك أي سؤال تاني، أنا هنا.");
assert.equal(nudgeText({ lastInterest: "كشف" }), "لسه معانا؟ 😊 لو حبيت أحجزلك ميعاد أو عندك أي سؤال تاني، أنا هنا.");
const todaysIds = ["032262995", "123054233", "270445685", "774787421", "558173775", "146708432", "152343331", "143801531", "060452099", "022900619"];
for (const interest of ["كشف", "فينير", "زراعه مصري", "تنظيف و تلميع", "عرض الكشف والتنظيف والتلميع"]) {
  for (const id of [...todaysIds, "x", ""]) {
    for (const c of [{ lastInterest: interest }, { lastInterest: interest, pendingSlots: ["2026-11-15|03:00 PM|"] }, { lastInterest: interest, ad: { headline: "عرض" } }]) {
      const t = nudgeText(c, id, now);
      assert.ok(!t.includes("عشان") && !t.includes("كشف") && !t.includes(interest), `interest leaked into the nudge: ${t}`);
      // "حابب" / "تحب" / an imperative speak to one gender; the bot does not know which.
      assert.ok(!/لو حابب|تحب |قولي|ابعتلي|معاك[؟ ]/.test(t), `a line that speaks to one gender: ${t}`);
    }
  }
}
// Variety: the same chat always gets the same line; different chats get different openers.
assert.equal(nudgeText({}, "032262995", now), nudgeText({}, "032262995", now), "deterministic");
const openers = new Set(todaysIds.map((id) => nudgeText({}, id, now).split(" 😊")[0]));
assert.equal(openers.size, 3, `all three openers in use across today's ten chats, got ${[...openers].join(" | ")}`);
// The last turn offered times still ahead: the nudge points at them, without claiming to hold them.
const cairo3pm = Date.UTC(2026, 10, 14, 13, 0); // 15:00 in Cairo (UTC+2 in November)
const morning = Date.UTC(2026, 10, 14, 6, 0); // 08:00 in Cairo
const offered = { pendingSlots: ["2026-11-14|06:30 PM|", "2026-11-15|03:00 PM|"] };
assert.ok(nudgeText(offered, "x", morning).includes("من اللي بعتهالك"), "times on the table");
assert.ok(!/شايل|محجوز|حجزتلك/.test(nudgeText(offered, "x", morning)), "never says the times are held");
assert.ok(nudgeText({ pendingSlots: ["2026-11-14|03:00 PM|"] }, "x", cairo3pm).includes("أحجزلك ميعاد"), "a time that has passed is not pointed at");
assert.ok(nudgeText({ pendingSlots: ["2026-11-14|03:20 PM|"] }, "x", cairo3pm).includes("أحجزلك ميعاد"), "nor one twenty minutes away");
assert.ok(nudgeText({ pendingSlots: ["2026-11-14|04:00 PM|Dr. Ali"] }, "x", cairo3pm).includes("من اللي بعتهالك"), "an hour away still counts");
assert.ok(nudgeText({ pendingSlots: ["2026-11-15|03:00 PM|"] }, "x", cairo3pm).includes("من اللي بعتهالك"), "tomorrow is still ahead");
assert.ok(nudgeText({ pendingSlots: null }, "x", morning).includes("أحجزلك ميعاد"), "no times, the plain line");
assert.equal(offeredTimeAhead({ pendingSlots: ["2026-11-14|12:30 AM|"] }, morning), false, "12:30 AM is just after midnight, already gone");
assert.equal(offeredTimeAhead({ pendingSlots: ["2026-11-14|12:30 PM|"] }, morning), true, "12:30 PM is past noon, still ahead at 8");
assert.equal(offeredTimeAhead({ pendingSlots: ["tomorrow at six", "", 7] }, morning), false, "an unreadable slot reads as no time");
assert.equal(offeredTimeAhead({}, morning), false);
// Late evening in Cairo is already the next day in the key: 23:30 on 14/11 local is 21:30 UTC.
assert.equal(offeredTimeAhead({ pendingSlots: ["2026-11-14|11:45 PM|"] }, Date.UTC(2026, 10, 14, 21, 30)), false, "fifteen minutes away is not ahead");
assert.equal(offeredTimeAhead({ pendingSlots: ["2026-11-15|03:00 PM|"] }, Date.UTC(2026, 10, 14, 22, 30)), true, "00:30 in Cairo on the 15th, 3 PM is ahead");
assert.equal(offeredTimeAhead({ pendingSlots: ["2026-11-14|06:30 PM|"] }, Date.UTC(2026, 10, 14, 22, 30)), false, "after midnight in Cairo, yesterday's time is gone");
// A patient the bot speaks English with is nudged in English, in every variant.
for (const id of ["032262995", "123054233", "146708432", "1", ""]) {
  for (const c of [{ patientName: "Sara Ali", lastLatin: true }, { patientName: "Sara Ali", lastLatin: true, pendingSlots: ["2026-11-15|03:00 PM|"] }]) {
    const en = nudgeText(c, id, now);
    assert.ok(!/[؀-ۿ]/.test(en), `Arabic in an English nudge: ${en}`);
    assert.ok(en.startsWith("Hi Sara! "), en);
  }
}
assert.ok(!/^Hi/.test(nudgeText({ lastLatin: true }, "1", now)), "no name, no 'Hi ' with a gap");
assert.ok(/[؀-ۿ]/.test(nudgeText({ lastLatin: false }, "1", now)), "Arabic by default");
assert.ok(/[؀-ۿ]/.test(nudgeText({}, "1", now)), "Arabic when the chat says nothing about language");
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
