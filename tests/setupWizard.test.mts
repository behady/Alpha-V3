// The first-run setup: the template a new clinic is offered, and what it turns into on disk.
//
// The wizard is a second door into the same records the Settings screens write, so the shapes
// here must match those screens exactly — `schedule` as the Schedule tab stores it, service
// documents as the Prices tab creates them. If either drifts, the calendar or the invoice picker
// reads a clinic that "configured itself" wrongly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClinicSchedule } from "../src/lib/clinicSchedule";
import {
  DEFAULT_SCHEDULE,
  SERVICE_TEMPLATES,
  SETUP_FACT_KEYS,
  SETUP_ROUTE,
  SETUP_STEPS,
  WEEK_DAYS,
  answerModeOf,
  answersFromSettings,
  clampAnswerMode,
  initialServiceChoices,
  insuranceFactFrom,
  normalizeLink,
  whatsappDocFromAnswers,
  normalizePhone,
  scheduleDocFrom,
  serviceDocsFrom,
} from "../src/lib/setupWizard";

const REPO = join(import.meta.dirname, "..");

// --- the template ------------------------------------------------------------------------------

assert.ok(SERVICE_TEMPLATES.length >= 12, "enough for a first day");
assert.equal(new Set(SERVICE_TEMPLATES.map((t) => t.key)).size, SERVICE_TEMPLATES.length, "keys unique");
for (const t of SERVICE_TEMPLATES) {
  assert.ok(t.name.en && t.name.ar, `${t.key} named in both languages`);
  assert.ok(t.price > 0 && t.durationMinutes > 0, `${t.key} has a price and a duration`);
  if (t.requiresLab) assert.ok((t.estimatedLabFee ?? 0) > 0, `${t.key} needs a lab fee to estimate from`);
}

// --- the schedule ------------------------------------------------------------------------------

const sched = scheduleDocFrom(DEFAULT_SCHEDULE);
const parsed = parseClinicSchedule({ schedule: sched });
assert.equal(parsed.isConfigured, true, "the calendar reads a wizard-saved schedule as configured");
assert.equal(parsed.startHour, 10);
assert.equal(parsed.endHour, 22);
assert.deepEqual(parsed.offDays, ["friday"], "Friday closed, in the lower-cased form the calendar uses");
assert.equal(parsed.slotDuration, 30);
assert.deepEqual(
  scheduleDocFrom({ ...DEFAULT_SCHEDULE, offDays: ["Friday", "Someday"] }).offDays,
  ["Friday"],
  "unknown day names are dropped, not stored"
);
assert.deepEqual([...WEEK_DAYS].sort(), ["Friday", "Monday", "Saturday", "Sunday", "Thursday", "Tuesday", "Wednesday"]);

// --- the service documents ---------------------------------------------------------------------

const all = serviceDocsFrom(initialServiceChoices(), "ar");
assert.equal(all.length, SERVICE_TEMPLATES.length, "everything ticked by default");
const crown = all.find((d) => d.englishName === "Zirconia Crown")!;
assert.equal(crown.doc.name, "طربوش زركون", "stored in the language the owner is using");
assert.equal(crown.doc.requiresLab, true);
assert.equal(crown.doc.estimatedLabFee, 1800);
assert.equal(crown.doc.pricingMode, "per_tooth", "same explicit default the Prices screen writes");
assert.deepEqual(crown.doc.prices, {}, "no per-list overrides: the standard list needs none");
assert.equal(typeof crown.doc.createdAt, "string");

const some = serviceDocsFrom(
  [
    { key: "consult", price: 250, selected: true },
    { key: "scaling", price: 0, selected: true },
    { key: "whitening", price: 3500, selected: false },
    { key: "nope", price: 100, selected: true },
  ],
  "en"
);
assert.deepEqual(some.map((d) => [d.englishName, d.doc.price]), [["Consultation", 250]],
  "edited price kept; zero price, unticked, and unknown keys dropped");

// --- phones ------------------------------------------------------------------------------------

assert.equal(normalizePhone("010 1234 5678"), "01012345678");
assert.equal(normalizePhone("+20 101 234 5678"), "01012345678");
assert.equal(normalizePhone("2010-1234-5678"), "01012345678");
assert.equal(normalizePhone(" 02 2735 1234 "), "02 2735 1234", "a landline is kept as typed");

// --- the WhatsApp questions --------------------------------------------------------------------
//
// Every answer lands on a switch the WhatsApp settings screens already own. The three bot fields
// are one decision on that screen; these pin that the wizard stores it the same way.

assert.deepEqual(SETUP_STEPS, ["hours", "services", "contact", "insurance", "whatsapp", "assistant"]);

const ALL = { messages: true, bot: true, ai: true };
const NONE = { messages: false, bot: false, ai: false };

assert.equal(answerModeOf(undefined), "off");
assert.equal(answerModeOf({ botEnabled: true }), "bot");
assert.equal(answerModeOf({ botEnabled: true, botAiEnabled: true }), "both");
assert.equal(answerModeOf({ botEnabled: true, botMode: "ai_first", botAiEnabled: true }), "ai");
assert.equal(answerModeOf({ botEnabled: false, botMode: "ai_first" }), "off", "off wins over a stale mode");

assert.equal(clampAnswerMode("ai", { ...ALL, ai: false }), "bot", "no AI add-on: AI falls back to the bot, not to silence");
assert.equal(clampAnswerMode("both", { ...ALL, ai: false }), "bot");
assert.equal(clampAnswerMode("bot", { ...ALL, bot: false }), "off", "no bot add-on: nobody answers");

// A clinic that never opened WhatsApp settings starts from the recommended, cautious answers.
const fresh = answersFromSettings(undefined);
assert.equal(fresh.autoMessages, true);
assert.equal(fresh.answerMode, "bot");
assert.equal(fresh.answerStrangers, false, "strangers off: the ban-protection default");
assert.equal(fresh.autoConfirm, false, "bookings reviewed by the desk by default");
assert.deepEqual(Object.keys(fresh.facts).sort(), [...SETUP_FACT_KEYS].sort());

// A clinic that has settings sees ITS settings, not the recommendations.
const existing = answersFromSettings({
  isPatientAutomationEnabled: false,
  botEnabled: true,
  botMode: "ai_first",
  botAiEnabled: true,
  botAnswerStrangers: true,
  botFacts: { parking: "Garage", aftercare: "kept" },
});
assert.equal(existing.autoMessages, false);
assert.equal(existing.answerMode, "ai");
assert.equal(existing.answerStrangers, true);
assert.equal(existing.facts.parking, "Garage");

// Round trip: stored → answers → stored changes nothing the wizard reads.
const round = whatsappDocFromAnswers(existing, ALL);
assert.equal(round.isPatientAutomationEnabled, false);
assert.equal(round.botEnabled, true);
assert.equal(round.botMode, "ai_first");
assert.equal(round.botAiEnabled, true);
assert.equal(answerModeOf(round), "ai");
assert.ok(!("aftercare" in (round.botFacts as object)), "facts the wizard does not ask about are left to the merge");

// The four modes write exactly what the settings chooser writes.
const modeDoc = (m: "off" | "bot" | "both" | "ai") => {
  const d = whatsappDocFromAnswers({ ...fresh, answerMode: m }, ALL);
  return [d.botEnabled, d.botMode, d.botAiEnabled];
};
assert.deepEqual(modeDoc("off"), [false, "assisted", false]);
assert.deepEqual(modeDoc("bot"), [true, "assisted", false]);
assert.deepEqual(modeDoc("both"), [true, "assisted", true]);
assert.deepEqual(modeDoc("ai"), [true, "ai_first", true]);

// Nothing locked is written — not even as "off" — so a later upgrade finds the old setting.
const locked = whatsappDocFromAnswers({ ...fresh, answerMode: "ai" }, NONE);
assert.ok(!("isPatientAutomationEnabled" in locked), "messages not in plan: not written");
assert.ok(!("botEnabled" in locked) && !("botMode" in locked), "bot not in plan: its stored mode is left alone, not switched off");
const noAi = whatsappDocFromAnswers({ ...fresh, answerMode: "ai" }, { ...ALL, ai: false });
assert.deepEqual([noAi.botEnabled, noAi.botMode, noAi.botAiEnabled], [true, "assisted", false], "AI locked: the bot answers");

// "No automatic messages" switches off the two sweeps that do not check the master switch.
const noMsgs = whatsappDocFromAnswers({ ...fresh, autoMessages: false, recall: true, reviews: true }, ALL);
assert.deepEqual([noMsgs.isPatientAutomationEnabled, noMsgs.isRecallEnabled, noMsgs.isReviewRequestEnabled], [false, false, false]);

// Firestore refuses a whole write for a single undefined.
for (const [k, v] of Object.entries(whatsappDocFromAnswers(fresh, ALL))) assert.notEqual(v, undefined, `${k} is defined`);
for (const [k, v] of Object.entries(whatsappDocFromAnswers(fresh, ALL).botFacts as object)) assert.equal(typeof v, "string", `fact ${k} is a string`);

// Bot off: its detail questions were never asked, so their stored answers are not touched.
const botOff = whatsappDocFromAnswers({ ...fresh, answerMode: "off" }, ALL);
assert.ok(!("botFacts" in botOff) && !("botAnswerStrangers" in botOff) && !("botPersonaName" in botOff));

assert.equal(normalizeLink(" maps.app.goo.gl/x "), "https://maps.app.goo.gl/x");
assert.equal(normalizeLink("http://x.y"), "http://x.y");
assert.equal(normalizeLink("  "), "");
assert.equal(
  whatsappDocFromAnswers({ ...fresh, facts: { ...fresh.facts, mapsUrl: "maps.app.goo.gl/x" } }, ALL).botFacts &&
    (whatsappDocFromAnswers({ ...fresh, facts: { ...fresh.facts, mapsUrl: "maps.app.goo.gl/x" } }, ALL).botFacts as Record<string, string>).mapsUrl,
  "https://maps.app.goo.gl/x"
);

assert.equal(insuranceFactFrom([], "ar"), "");
assert.ok(insuranceFactFrom(["AXA", " MedNet "], "en").includes("AXA, MedNet"));
assert.ok(insuranceFactFrom(["AXA", "ميدنت"], "ar").includes("AXA، ميدنت"));

// --- wiring ------------------------------------------------------------------------------------

assert.equal(SETUP_ROUTE, "/setup");
const login = readFileSync(join(REPO, "src/app/login/page.tsx"), "utf8");
assert.ok(login.includes("/api/onboarding/create-clinic"), "signup creates the clinic on the same form");
assert.ok(login.includes("SETUP_ROUTE"), "a fresh clinic goes to the wizard");
assert.ok(login.includes("currentSignupKey()"), "signup sends the key that stops a retry making a second clinic");
const onboarding = readFileSync(join(REPO, "src/app/onboarding/page.tsx"), "utf8");
assert.ok(onboarding.includes("SETUP_ROUTE"), "the onboarding screen sends a fresh clinic to the wizard too");
const page = readFileSync(join(REPO, "src/app/(dashboard)/setup/page.tsx"), "utf8");
assert.ok(page.includes("parseClinicSchedule("), "the wizard recognises hours set elsewhere");
assert.ok(page.includes('"clinic_info"'), "the wizard writes the same document the Settings screens do");
assert.ok(page.includes("<PayersSettings canEdit"), "the insurance step IS the Settings insurer editor, not a copy");
assert.ok(page.includes("UnsavedChangesProvider"), "a half-typed insurer asks before Next drops it");
const questions = readFileSync(join(REPO, "src/components/setup/WhatsAppQuestionsStep.tsx"), "utf8");
assert.ok(questions.includes("whatsappDocFromAnswers(") && questions.includes("merge: true"), "answers merge into settings/whatsapp");
const connect = readFileSync(join(REPO, "src/components/setup/WhatsAppConnectStep.tsx"), "utf8");
assert.ok(connect.includes("/api/admin/wapilot-config/gateway"), "the QR comes from the same route Settings uses");
const settingsShell = readFileSync(join(REPO, "src/app/(dashboard)/settings/layout.tsx"), "utf8");
assert.ok(settingsShell.includes("SETUP_ROUTE"), "Settings has the Quick clinic setup button");

console.log("setupWizard: all assertions passed");
