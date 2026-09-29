// Click-to-WhatsApp ads: the ad is read off both channels, survives into the greeting, the
// scripts and the model's context, and the report can say which ad brought the bookings.
// Run with tsx.
import assert from "node:assert/strict";
import { adGreetingLine, adLabel, adPromptLines, adSubjectText, adSystemLine, parseBaileysAdReply, parseMetaReferral, readStoredAd } from "../src/lib/bot/adReferral";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";
import { buildBotPrompt } from "../src/lib/bot/botPrompt";
import { adStats } from "../src/lib/reports/adStats";

// ================================================================================================
// Parsing: Meta's `referral` and WhatsApp Web's `externalAdReply` become one record.
// ================================================================================================
const meta = parseMetaReferral({
  source_url: "https://fb.me/xyz",
  source_id: "120212345678901234",
  source_type: "ad",
  headline: "  تبييض الأسنان  بخصم 30% ",
  body: "احجز كشفك المجاني النهاردة",
  media_type: "image",
  image_url: "https://scontent/img.jpg",
  ctwa_clid: "ARBxyz",
});
assert.deepEqual(meta, {
  headline: "تبييض الأسنان بخصم 30%",
  body: "احجز كشفك المجاني النهاردة",
  sourceId: "120212345678901234",
  sourceType: "ad",
  sourceUrl: "https://fb.me/xyz",
  mediaType: "image",
  ctwaClid: "ARBxyz",
  thumbnailUrl: "https://scontent/img.jpg",
});
assert.equal(parseMetaReferral(undefined), null);
assert.equal(parseMetaReferral({}), null, "a referral with nothing identifying is no referral");
assert.equal(parseMetaReferral("ad"), null);

const baileys = parseBaileysAdReply({
  conversionSource: "FB_Ads",
  externalAdReply: { title: "تقويم شفاف", body: "قسّط على 12 شهر", mediaType: 2, sourceType: "ad", sourceId: "9", sourceUrl: "https://fb.me/q", ctwaClid: "C1" },
});
assert.deepEqual(baileys, { headline: "تقويم شفاف", body: "قسّط على 12 شهر", sourceId: "9", sourceType: "ad", sourceUrl: "https://fb.me/q", mediaType: "video", ctwaClid: "C1" });
assert.deepEqual(parseBaileysAdReply({ conversionSource: "IG_Ads", externalAdReply: { sourceId: "7" } }), { sourceId: "7", sourceType: "ad" }, "a boosted post with no creative is still an ad");
assert.equal(parseBaileysAdReply({ stanzaId: "x", quotedMessage: {} }), null, "a quoted reply is not an ad");
assert.equal(parseBaileysAdReply({ externalAdReply: { title: "", body: "" } }), null);

// The stored copy round-trips and drops junk.
assert.deepEqual(readStoredAd({ ...meta, extra: 1, headline: meta!.headline }), meta);
assert.equal(readStoredAd(null), null);

// ================================================================================================
// Wording.
// ================================================================================================
assert.equal(adLabel(meta), "تبييض الأسنان بخصم 30%");
assert.equal(adLabel({ body: "نص طويل جداً ".repeat(10) }).length <= 49, true, "a headline-less ad is named by its first words");
assert.equal(adLabel({ sourceId: "120212345678901234" }), "إعلان 901234");
assert.equal(adLabel({ sourceType: "post", ctwaClid: "x" }), "منشور");
assert.equal(adLabel(null, false), "Ad");
assert.ok(adSystemLine(meta!).startsWith("📣 جاي من إعلان: تبييض الأسنان بخصم 30%"));
assert.ok(adSystemLine({ sourceType: "post", headline: "عرض" }).includes("منشور"));
assert.ok(adGreetingLine(meta!).includes("*تبييض الأسنان بخصم 30%*"), "the greeting names what they tapped");
assert.ok(adGreetingLine(meta!, { offerLine: "خصم 30% على التبييض لحد آخر الشهر" }).endsWith("خصم 30% على التبييض لحد آخر الشهر"));
assert.ok(adGreetingLine({ sourceId: "1" }).includes("الإعلان"), "no headline: still thanked for coming from the ad");
assert.ok(adPromptLines(meta!).includes("«تبييض الأسنان بخصم 30%»"));
assert.equal(adSubjectText(meta), "تبييض الأسنان بخصم 30% احجز كشفك المجاني النهاردة");
assert.equal(adSubjectText(null), "");

// ================================================================================================
// The engine: the welcome event greets by the ad; the ad matches the clinic's scripts.
// ================================================================================================
const base: BotContext = { clinicName: "Alpha Dental", hoursText: "السبت: 10:00 - 22:00", canOfferBooking: true };
const withAd: BotContext = { ...base, ad: meta!, adOfferLine: "خصم 30% على التبييض" };

const welcome = decideBotReply({ state: "new", text: "", ctx: { ...withAd, welcome: true } });
assert.equal(welcome.reason, "ad_welcome");
assert.equal(welcome.next, "awaiting_choice");
assert.ok(welcome.reply.includes("Alpha Dental") && welcome.reply.includes("تبييض الأسنان بخصم 30%") && welcome.reply.includes("خصم 30% على التبييض"), welcome.reply);
assert.ok(welcome.reply.includes("*1*"), "and still offers the menu");

// Without the welcome flag an empty message is still silence — nothing changed for ordinary turns.
assert.equal(decideBotReply({ state: "new", text: "", ctx: withAd }).reason, "empty_message");
// And a welcome event mid-booking does not reset the list the patient is answering.
assert.equal(decideBotReply({ state: "booking_time", text: "", ctx: { ...withAd, welcome: true } }).reason, "empty_message");

// A plain greeting from an ad click is greeted by the ad; without the ad, the ordinary greeting.
const hi = decideBotReply({ state: "new", text: "السلام عليكم", ctx: withAd });
assert.equal(hi.reason, "greeted");
assert.ok(hi.reply.includes("تبييض الأسنان بخصم 30%"));
assert.ok(!decideBotReply({ state: "new", text: "السلام عليكم", ctx: base }).reply.includes("تبييض"));

// The clinic wrote a script for whitening: the ad's headline reaches it even when the person only said "hi".
const scripts = [{ id: "s1", triggers: ["تبييض"], reply: "عرض التبييض 1500 بدل 2000 لحد آخر الشهر، تحب أحجزلك؟", enabled: true }];
const scripted = decideBotReply({ state: "new", text: "مرحبا", ctx: { ...withAd, scripts } });
assert.equal(scripted.reason, "ad_script");
assert.equal(scripted.reply, scripts[0].reply);
// Only on the first turn: later messages are matched on their own words.
assert.notEqual(decideBotReply({ state: "awaiting_choice", text: "مرحبا", ctx: { ...withAd, scripts } }).reason, "ad_script");
// And the typed words still win over the ad when they match a script themselves.
const two = [...scripts, { id: "s2", triggers: ["تقويم"], reply: "التقويم من 8000", enabled: true }];
assert.equal(decideBotReply({ state: "new", text: "عايز اعرف عن التقويم", ctx: { ...withAd, scripts: two } }).reply, "التقويم من 8000");
// Safety still outranks the ad: a symptom from an ad click goes to a person.
assert.equal(decideBotReply({ state: "new", text: "وشي وارم", ctx: { ...withAd, scripts } }).reason, "clinical");

// ================================================================================================
// The model is told.
// ================================================================================================
const prompt = buildBotPrompt({ clinicName: "Alpha", mode: "sales", clinical: false, priceLines: "", knowledge: [], dossierText: "", offeredSlots: [], ad: meta! });
assert.ok(prompt.includes("جاي من إعلان") && prompt.includes("«تبييض الأسنان بخصم 30%»"));
assert.ok(!buildBotPrompt({ clinicName: "Alpha", mode: "sales", clinical: false, priceLines: "", knowledge: [], dossierText: "", offeredSlots: [] }).includes("جاي من إعلان"));

// ================================================================================================
// The report: chats, typed, booked, attended, paid — per ad, joined on the patient.
// ================================================================================================
const day = (d: string) => new Date(`${d}T12:00:00Z`).getTime();
const range = { start: "2026-09-01", end: "2026-09-30" };
const conversations = [
  { id: "1", ad: { headline: "تبييض", sourceId: "A" }, adAt: day("2026-09-05"), adTypedAt: day("2026-09-05"), patientId: "p1", outcome: "booked", lastMessageAt: day("2026-09-05") },
  { id: "2", ad: { headline: "تبييض", sourceId: "A" }, adAt: day("2026-09-06"), lastMessageAt: day("2026-09-06") }, // tapped, never typed
  { id: "3", ad: { headline: "تقويم", sourceId: "B" }, adAt: day("2026-09-07"), adTypedAt: day("2026-09-07"), patientId: "p3", handoffAtMs: day("2026-09-07"), lastMessageAt: day("2026-09-07") },
  { id: "4", ad: { headline: "قديم", sourceId: "C" }, adAt: day("2026-08-20"), lastMessageAt: day("2026-09-02") }, // clicked before the period
  { id: "5", lastMessageAt: day("2026-09-10") }, // organic
  { id: "play_x", ad: { headline: "تبييض", sourceId: "A" }, adAt: day("2026-09-08"), lastMessageAt: day("2026-09-08") }, // rehearsal
];
const appointments = [
  { id: "a1", patientId: "p1", status: "Completed", createdAtMs: day("2026-09-05") + 1000 },
  { id: "a3", patientId: "p3", status: "Scheduled", createdAtMs: day("2026-09-08") },
];
const ledger = [
  { id: "l1", type: "payment", patientId: "p1", amount: 1500, paid: 1500 },
  { id: "l2", type: "expense", patientId: "p1", amount: 99 },
  { id: "l3", type: "payment", patientId: "p9", amount: 700, paid: 700 },
];
const s = adStats(conversations, appointments, ledger, range);
assert.equal(s.organicChats, 1);
assert.deepEqual(s.rows.map((r) => [r.key, r.chats, r.typed, r.handoffs, r.booked, r.attended, r.revenue, r.conversionPct]), [
  ["A", 2, 1, 0, 1, 1, 1500, 50],
  ["B", 1, 1, 1, 1, 0, 0, 100],
]);
assert.equal(s.totals.chats, 3);
assert.equal(s.totals.booked, 2);
assert.equal(s.totals.revenue, 1500);
assert.equal(adStats([], [], [], range).totals.conversionPct, null);

console.log("adReferral: all checks passed");
