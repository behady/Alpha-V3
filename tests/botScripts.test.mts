/**
 * The clinic's own scripts, and where they sit in the answer chain.
 *
 * Pinned: normalised matching (ى/ة/digits), longest trigger wins, disabled and half-filled rows
 * never fire, and the order against the built-in intents — a script beats a price question, but
 * asking for a person, cancelling and running late still beat the script.
 *
 * Run: npm run test:scripts
 */
import assert from "node:assert/strict";
import { matchScript, parseTriggers, cleanScripts } from "../src/lib/bot/scripts";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";
import type { BotScript } from "../src/types/whatsapp";

const scripts: BotScript[] = [
  { id: "kids", title: "Kids", triggers: ["اطفال", "طفل", "ابني", "بنتي", "kids"], reply: "أيوه بنستقبل الأطفال من 3 سنين 🦷" },
  { id: "ortho", triggers: ["تقويم"], reply: "التقويم عندنا من 15 ألف." },
  { id: "ortho-clear", triggers: ["تقويم شفاف"], reply: "التقويم الشفاف من 40 ألف." },
  { id: "off", triggers: ["تبييض"], reply: "التبييض 3000", enabled: false },
  { id: "half", triggers: ["زراعة"], reply: "   " },
];

// Matching
assert.equal(matchScript("عندكم اطفال؟", scripts)?.id, "kids");
assert.equal(matchScript("ابنى عنده 5 سنين ينفع", scripts)?.id, "kids", "ى must match ي");
assert.equal(matchScript("وبنتي كمان", scripts)?.id, "kids", "leading و is split off");
assert.equal(matchScript("do you see kids", scripts)?.id, "kids");
assert.equal(matchScript("التقويم بكام", scripts)?.id, "ortho");
assert.equal(matchScript("عايز تقويم شفاف", scripts)?.id, "ortho-clear", "longest trigger wins");
assert.equal(matchScript("التبييض بكام", scripts), null, "disabled script never fires");
assert.equal(matchScript("الزراعة بكام", scripts), null, "empty reply never fires");
assert.equal(matchScript("اطفالكم", scripts), null, "whole word, not substring");
assert.equal(matchScript("hello", scripts), null);
assert.equal(matchScript("hello", []), null);
assert.equal(matchScript("hello", undefined), null);

// Editing helpers
assert.deepEqual(parseTriggers("تقويم, تقويم اسنان، braces\n تقويم "), ["تقويم", "تقويم اسنان", "braces"]);
const cleaned = cleanScripts([
  { id: "a", triggers: [" x ", ""], reply: " y ", title: "  " },
  { id: "b", triggers: [], reply: "z" },
  { id: "c", triggers: ["q"], reply: "", enabled: false },
  { id: "d", triggers: ["q"], reply: "r", enabled: false },
]);
assert.deepEqual(cleaned, [
  { id: "a", triggers: ["x"], reply: "y" },
  { id: "d", triggers: ["q"], reply: "r", enabled: false },
]);
for (const s of cleaned) for (const v of Object.values(s)) assert.notEqual(v, undefined, "no undefined keys reach Firestore");

// Where scripts sit in the chain
const ctx: BotContext = {
  clinicName: "Alpha",
  patientName: "أحمد",
  hoursText: "من 3 م إلى 11 م",
  addressText: "القاهرة",
  scripts,
  facts: { installments: "في تقسيط 6 شهور" },
};
const say = (state: Parameters<typeof decideBotReply>[0]["state"], text: string) => decideBotReply({ state, text, ctx });

assert.equal(say("awaiting_choice", "التقويم بكام؟").reason, "script", "a script beats the built-in price answer");
assert.equal(say("new", "عندكم اطفال").next, "awaiting_choice", "a script on first contact opens the conversation");
assert.equal(say("awaiting_choice", "عندكم اطفال").reply, "أيوه بنستقبل الأطفال من 3 سنين 🦷", "sent verbatim");
assert.equal(say("awaiting_choice", "عايز اكلم حد بخصوص التقويم").reason, "asked_for_human", "a person outranks a script");
assert.equal(say("awaiting_choice", "الغي ميعاد التقويم").reason.startsWith("cancel"), true, "cancelling outranks a script");
assert.equal(say("awaiting_choice", "هتأخر شوية على ميعاد التقويم").reason.startsWith("late"), true, "running late outranks a script");
assert.equal(say("booking_name", "تقويم").reason, "registered", "a name typed at the name step is a name");
assert.equal(say("awaiting_choice", "في تقسيط؟").reason, "installments", "no script → built-in answers still work");

console.log("botScripts: ok");
