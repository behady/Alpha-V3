/**
 * A patient answering the receptionist is answered by the receptionist, not the bot; and a message
 * into a chat a person holds alerts the desk instead of vanishing.
 *
 * Two live chats on 2026-11-14 (Africa/Cairo):
 *   - …707035: reception asked "where does it say we work with AXA" at 07:53:33. The claim minutes
 *     (15) ran out, the patient answered at 09:06:26, and the bot answered her.
 *   - …785354: reception paused the bot, wrote two statements at 10:10, and the patient's
 *     "إيقاف.. ولكم الشكر" at 11:23 raised nothing: no flag, no push, seen by nobody.
 *
 * The rule is pure (lib/bot/staffHold) and tested directly; the engine is pure and tested directly;
 * respond.ts opens the database on import, so its wiring is checked at the source, as the other
 * respond.ts suites do. Run: npm run test:staff-hold
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STAFF_QUESTION_HOLD_MS,
  asksPatient,
  deskHearsHeldMessage,
  staffQuestionAt,
  staffQuestionCouldHold,
  type HoldLine,
} from "../src/lib/bot/staffHold";
import { clinicalReplyText, decideBotReply, type BotContext } from "../src/lib/bot/engine";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const T = (hm: string) => Date.parse(`2026-11-14T${hm}+02:00`);
const line = (direction: "in" | "out", author: string, hm: string, text: string): HoldLine => ({ direction, author, at: T(hm), text });

// ------------------------------------------------------------------------------- the question --
test("a staff message that asks something, with or without a question mark", () => {
  // The real one: no "؟", and still a question.
  assert.equal(asksPatient("حضرتك ممكن تعرفني مكتوب فين ان احنا تبع اكسا للتصحيح"), true);
  assert.equal(asksPatient("تمام؟"), true);
  assert.equal(asksPatient("Is 5 pm OK?"), true);
  assert.equal(asksPatient("تحب نحجزلك امتى"), true);
  assert.equal(asksPatient("وامتى يناسبك"), true, "a leading و does not hide the word");
  assert.equal(asksPatient("إزاي أقدر أساعد حضرتك"), true, "hamza folded");
  assert.equal(asksPatient("What time suits you"), true);
});

test("what a desk states is not a question", () => {
  assert.equal(asksPatient("السلام عليكم، مع حضرتك احمد من الاستقبال."), false);
  assert.equal(asksPatient("مع حضرتك احمد من الاستقبال، بنعتزلك جدا عن خطأ الرد الالي."), false);
  assert.equal(asksPatient("موعد حضرتك تم تسجيله بنجاح الأحد الساعه ٣ عصرا"), false);
  assert.equal(asksPatient("متاح في فرع حدائق الاهرام"), false);
  assert.equal(asksPatient("See you tomorrow"), false);
  assert.equal(asksPatient("اللوكيشن: https://maps.google.com/maps?q=30.05,31.33"), false, "the ? inside a link is not a question");
  assert.equal(asksPatient("ده اللوكيشن https://maps.app.goo.gl/x?g_st=iw تحب نأكد الميعاد؟"), true, "the question beside it still is");
  assert.equal(asksPatient(""), false);
  // The follow-up template a desk sends to reopen the 24h window is not a question either.
  assert.equal(asksPatient("مرحباً أحمد، معاك Alpha Dental. بخصوص رسالتك على واتساب، عندنا رد ليك — ابعتلنا أي رسالة عشان نكمل الكلام معاك."), false);
});

// ---------------------------------------------------------------------------- the 707035 replay --
const STAMP_707035 = 1794635613325; // humanActiveAtMs on the conversation: 07:53:33.325
const thread707035: HoldLine[] = [
  line("in", "patient", "07:40:21", "انا قريت انك تابع تأمين اكس"),
  line("out", "bot", "07:40:27", "فهمت قصدك، بس إحنا فعلاً معندناش تعاقد مع شركات تأمين في العيادة."),
  line("out", "staff", "07:52:25", "السلام عليكم، مع حضرتك احمد من الاستقبال."),
  { direction: "out", author: "staff", at: STAMP_707035 - 300, text: "حضرتك ممكن تعرفني مكتوب فين ان احنا تبع اكسا للتصحيح" },
  line("in", "patient", "09:06:26", "انا مفكره العيأده تابع اكس"),
];

test("707035: the patient's answer 73 minutes later is still the receptionist's", () => {
  const at = staffQuestionAt(thread707035, STAMP_707035, T("09:06:26"));
  assert.equal(at, STAMP_707035 - 300, "held, keyed on the question's own moment");
  assert.equal(staffQuestionCouldHold(STAMP_707035, T("09:06:26")), true, "and worth reading the thread for");
  // Lines in any order: the newest outbound decides.
  assert.equal(staffQuestionAt([...thread707035].reverse(), STAMP_707035, T("09:06:26")), STAMP_707035 - 300);
});

test("the hold ends: hand-back, a later bot or system message, a statement, 12 hours", () => {
  const now = T("09:06:26");
  assert.equal(staffQuestionAt(thread707035, 0, now), 0, "«رجّع البوت» zeroes the stamp, and the bot answers again");
  assert.equal(
    staffQuestionAt([...thread707035, line("out", "bot", "08:30:00", "العفو 🙏")], STAMP_707035, now),
    0,
    "the bot spoke after her (a tapped button): the patient is answering the bot"
  );
  assert.equal(
    staffQuestionAt([...thread707035, line("out", "system", "08:00:00", "تذكير بميعادك بكره")], STAMP_707035, now),
    0,
    "a reminder went out after her: the patient is answering the reminder"
  );
  assert.equal(
    staffQuestionAt([...thread707035, line("out", "staff", "08:00:00", "متاح في فرع حدائق الاهرام")], T("08:00:00"), now),
    0,
    "her last word was a statement: the claim minutes are all the hold there is, as before"
  );
  const asked = T("07:53:33");
  const q: HoldLine[] = [{ direction: "out", author: "staff", at: asked, text: "تحب نحجزلك امتى؟" }];
  assert.equal(staffQuestionAt(q, asked, asked + STAFF_QUESTION_HOLD_MS - 60_000), asked, "inside 12 hours");
  assert.equal(staffQuestionAt(q, asked, asked + STAFF_QUESTION_HOLD_MS + 1), 0, "past 12 hours the bot answers again");
  assert.equal(staffQuestionCouldHold(asked, asked + STAFF_QUESTION_HOLD_MS + 1), false, "and the thread is not even read");
  assert.equal(staffQuestionCouldHold(undefined, asked), false);
  assert.equal(STAFF_QUESTION_HOLD_MS, 12 * 60 * 60 * 1000);
});

test("a question nobody just sent does not hold: a line filed from history, a patient's own question", () => {
  const asked = T("07:53:33");
  const q: HoldLine[] = [{ direction: "out", author: "staff", at: asked, text: "تحب نحجزلك امتى؟" }];
  assert.equal(staffQuestionAt(q, asked - 10 * 60_000, asked + 60_000), 0, "the stamp predates the line: no person sent it now");
  assert.equal(staffQuestionAt([line("in", "patient", "09:00:00", "بكام الكشف؟")], asked, T("09:01:00")), 0, "inbound lines are never the clinic's word");
  assert.equal(staffQuestionAt([], asked, T("09:01:00")), 0, "no thread read (or a failed one): no hold, as before");
});

// ------------------------------------------------------------------------------- who is told --
test("the desk is told: a paused chat, a staff question's answer, media, anything urgent", () => {
  const quiet = { paused: false, askedAtMs: 0, mediaOnly: false, urgent: false };
  // 785354: paused, the patient's "إيقاف.. ولكم الشكر" — told, even if staff wrote a minute ago
  // (handoffSla skips paused chats, so this push is the only one they get).
  assert.equal(deskHearsHeldMessage({ ...quiet, paused: true }), true);
  // 707035: the answer to "حضرتك ممكن تعرفني مكتوب فين…" — told, whenever it comes inside 12 hours.
  assert.equal(deskHearsHeldMessage({ ...quiet, askedAtMs: STAMP_707035 }), true);
  assert.equal(deskHearsHeldMessage({ ...quiet, mediaOnly: true }), true, "a photo or voice note nobody has seen");
  assert.equal(deskHearsHeldMessage({ ...quiet, urgent: true }), true, "a symptom in a held chat (dentist mode no longer answers it)");
  // A "شكرا" right after a staff STATEMENT, inside the claim minutes: the receptionist is in that
  // chat now. No flag, exactly as before — a flag would keep a menu-mode bot quiet for a day.
  assert.equal(deskHearsHeldMessage(quiet), false);
});

// ------------------------------------------------------------------------------------ the engine --
const ctx: BotContext = { clinicName: "Alpha Dental", clinicPhone: "01000000000", canOfferBooking: true, aiAvailable: true, aiFirst: true };
const dentist: BotContext = { ...ctx, clinicalMode: "dentist" };

test("a held thread stays silent, and the model dentist does not talk over the person", () => {
  const answer = decideBotReply({ state: "handed_off", text: "انا مفكره العيأده تابع اكس", ctx: { ...ctx, heldByStaff: true } });
  assert.equal(answer.reason, "already_with_a_human");
  assert.equal(answer.reply, "");
  const held = decideBotReply({ state: "handed_off", text: "ضرسي بيوجعني من امبارح", ctx: { ...dentist, heldByStaff: true } });
  assert.equal(held.reason, "already_with_a_human", "a symptom in a person's thread goes to that person");
  assert.equal(held.reply, "");
  assert.equal(held.action, undefined, "no model call at all");
});

test("an emergency phrase still gets the fixed safety line with the clinic's number, held or not", () => {
  const sugar = decideBotReply({ state: "handed_off", text: "عندي سكر وضرسي وارم", ctx: { ...dentist, heldByStaff: true } });
  assert.equal(sugar.reason, "clinical");
  assert.equal(sugar.handoff, true);
  assert.equal(sugar.reply, clinicalReplyText("01000000000"));
});

test("nothing changes where no person holds the thread, or the clinic is not in dentist mode", () => {
  const free = decideBotReply({ state: "awaiting_choice", text: "ضرسي بيوجعني من امبارح", ctx: dentist });
  assert.equal(free.reason, "clinical_ai", "dentist mode still answers a symptom as the desk dentist");
  const flagOnly = decideBotReply({ state: "handed_off", text: "ضرسي بيوجعني من امبارح", ctx: { ...dentist, heldByStaff: false } });
  assert.equal(flagOnly.reason, "clinical_ai", "a bot-raised flag with nobody behind it is not a person's thread");
  const handoffMode = decideBotReply({ state: "handed_off", text: "ضرسي بيوجعني من امبارح", ctx: { ...ctx, heldByStaff: true } });
  assert.equal(handoffMode.reason, "clinical", "handoff mode keeps its fixed line, as before");
});

// ---------------------------------------------------------------------------------- the wiring --
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const respond = src("src/lib/bot/respond.ts");

test("respond.ts: a held thread says nothing — no photo to the model, no «وصلتنا», no model dentist", () => {
  for (const s of [
    "const heldByStaff = conversation.staffActive === true || staffAskedAtMs > 0;",
    "ctx.heldByStaff = heldByStaff;",
    "const photoToModel = !heldByStaff &&",
    '? { reply: "", next: "handed_off" as const, handoff: false, reason: "already_with_a_human" }',
    // The engine's state, kept in one place so a newer message is judged in it too (lib/bot/supersede).
    'const engineState: BotState = heldByStaff ? "handed_off" :',
    "decideBotReply({ state: engineState, text, ctx })",
    "staffQuestionAt(lines, wrote, now)",
  ]) {
    assert.ok(respond.includes(s), s);
  }
  // The thread is read only when a person wrote in the last 12 hours and the chat is not paused —
  // inside the claim minutes too, so an early answer to a question is still the desk's news.
  assert.ok(respond.includes("const pausedByStaff = conversation.staffPaused === true;"));
  assert.ok(respond.includes("if (!pausedByStaff && staffQuestionCouldHold(conversation.staffWroteAtMs, now)) {"));
  // The hold is decided before the decision that it changes.
  assert.ok(respond.indexOf("const heldByStaff =") < respond.indexOf("const photoToModel ="));
});

test("respond.ts: the desk is told — flag, one push per staff message, urgent for media and symptoms", () => {
  const start = respond.indexOf("const heldMediaOnly =");
  const end = respond.indexOf("let replyText = decision.reply;");
  assert.ok(start > 0 && start < end, "the alert block runs right after the decision");
  const block = respond.slice(start, end);
  assert.ok(block.includes("!args.dryRun &&\n    heldByStaff &&\n    decision.reason === \"already_with_a_human\" &&"), "only for a silent held turn, never in the playground");
  assert.ok(
    block.includes('deskHearsHeldMessage({ paused: pausedByStaff, askedAtMs: staffAskedAtMs, mediaOnly: heldMediaOnly, urgent: heldSeverity === "urgent" })'),
    "who is told is the pure rule tested above"
  );
  assert.ok(block.includes('markHandoff(clinicId, conversation.phoneKey, "patient_replied_to_staff"'), "needsHuman: the chat shows «مستني رد»");
  assert.ok(block.includes("(heldMediaOnly && !(args.mediaNote && !args.mediaNote.urgent)) || needsHuman(text)"), "urgent as the media hand-off weighs it");
  // One push per staff message (and per severity), whoever is in the chat: the owner asked for it,
  // and a paused chat has no other alert at all.
  assert.ok(block.includes("const tell = await claimOnce(clinicId, `held_${conversation.phoneKey}_${staffSinceMs}_${severity}`"));
  assert.ok(!block.includes("staffLive"), "no live-receptionist exception that swallows the paused chat's only push");
  assert.ok(block.includes('event: severity === "urgent" ? "urgentPatientMessage" : "patientRepliedAfterClaim"'));
  assert.ok(!/roles:\s*\[/.test(block), "the audience is the clinic's, not named here");
});

test("conversation.ts hands respond.ts what it needs; the Chats screen reads the same rule", () => {
  const conv = src("src/lib/bot/conversation.ts");
  assert.ok(conv.includes("staffPaused: paused,"));
  assert.ok(conv.includes("staffWroteAtMs: humanActiveAtMs || undefined,"));
  assert.ok(conv.includes("pausedAtMs: paused ? pausedAt || undefined : undefined,"));
  // The claim minutes are untouched: no global extension of the hold.
  assert.ok(conv.includes("staffActive: humanActiveAtMs > now - humanClaimMs || paused,"));
  const chats = src("src/components/ai/ChatsPanel.tsx");
  assert.ok(chats.includes("staffQuestionAt(lines, chat.humanActiveAtMs || 0, Date.now())"));
  // Client-safe: the rule module imports only the pure text normaliser, which imports nothing.
  const hold = src("src/lib/bot/staffHold.ts");
  assert.deepEqual([...hold.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]), ["@/lib/patientMessaging"]);
  assert.equal(/^import /m.test(src("src/lib/patientMessaging.ts")), false);
});
