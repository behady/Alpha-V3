/**
 * Three things clinic owners asked the WhatsApp bot to stop, that came from code and not from the
 * model: dentist names in cards/lists/replies, the "clinic is closed" note under every hand-off,
 * and a second branch nobody could offer.
 *
 * respond.ts cannot be imported in a test (its import graph opens the database), so the pure
 * pieces live in src/lib/bot/ownerRules.ts and are tested here; the wiring inside respond.ts is
 * pinned by reading its source, the way botProWiring.test.mts does.
 *
 * Run: npm run test:bot-owner-rules
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appointmentLine, branchesTextOf, stripDoctorNames } from "../src/lib/bot/ownerRules";
import { arabicDayLabel, arabicTimeLabel } from "../src/lib/arabicDateTime";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

/** respond.ts's appointmentLine exactly as it was before the switch existed. */
function appointmentLineBefore(a: { date: string; time: string; doctor: string }): string {
  const parts = [`📅 ${arabicDayLabel(a.date)}`, `⏰ ${arabicTimeLabel(a.time)}`];
  if (a.doctor && a.doctor.toLowerCase() !== "any") parts.push(`👨‍⚕️ ${a.doctor}`);
  return parts.join("\n");
}

const APPTS = [
  { date: "2026-11-05", time: "05:00 PM", doctor: "Mahmoud amgad" },
  { date: "2026-11-05", time: "11:30 AM", doctor: "any" },
  { date: "2026-11-06", time: "09:00 PM", doctor: "" },
];

/* ---------------------------------------------------------------- appointmentLine ---------- */

test("appointmentLine with the switch off is byte-identical to the old one", () => {
  for (const a of APPTS) {
    assert.equal(appointmentLine(a), appointmentLineBefore(a));
    assert.equal(appointmentLine(a, false), appointmentLineBefore(a));
  }
});

test("appointmentLine with hideDoctor drops the dentist line and keeps day and time", () => {
  const line = appointmentLine(APPTS[0], true);
  assert.ok(!line.includes("👨‍⚕️"));
  assert.ok(!line.includes("Mahmoud"));
  assert.equal(line, `📅 ${arabicDayLabel("2026-11-05")}\n⏰ ${arabicTimeLabel("05:00 PM")}`);
});

/* ---------------------------------------------------------------- branchesTextOf ----------- */

test("no branches, or one, gives nothing (the prompt stays as it is today)", () => {
  assert.equal(branchesTextOf([]), "");
  assert.equal(branchesTextOf(undefined), "");
  assert.equal(branchesTextOf([{ id: "b1", name: "المعادي", address: "شارع 9", phone: "0100", rooms: [] }]), "");
});

test("two or more branches: one line each, phone when present, empty branches skipped", () => {
  const text = branchesTextOf([
    { id: "b1", name: "المعادي", address: "شارع 9، المعادي", phone: "01001234567", rooms: [] },
    { id: "b2", name: "مدينة نصر", address: " 12 عباس العقاد ", rooms: [] },
    { id: "b3", name: "فاضي", address: "  ", phone: " ", rooms: [] },
    { id: "b4", name: "التجمع", phone: "01112223334", rooms: [] },
  ]);
  assert.equal(text, ["• المعادي: شارع 9، المعادي — ت: 01001234567", "• مدينة نصر: 12 عباس العقاد", "• التجمع — ت: 01112223334"].join("\n"));
});

test("two branches with nothing to say about either gives nothing", () => {
  assert.equal(branchesTextOf([{ id: "b1", name: "أ", rooms: [] }, { id: "b2", name: "ب", rooms: [] }]), "");
});

/* ---------------------------------------------------------------- stripDoctorNames --------- */

const DOCTORS = ["Mahmoud amgad", "Sara Ali", "د. محمد سمير", ""];

test("a dentist's name in a reply becomes الدكتور, whatever its case and title", () => {
  const r = stripDoctorNames("ميعادك مع mahmoud AMGAD يوم الخميس، ود. محمد سمير موجود برضه", DOCTORS);
  assert.equal(r.stripped, true);
  assert.equal(r.text, "ميعادك مع الدكتور يوم الخميس، والدكتور موجود برضه");
  assert.equal(stripDoctorNames("هتكشف عند دكتور Sara Ali", DOCTORS).text, "هتكشف عند الدكتور");
  assert.equal(stripDoctorNames("هتكشف عند الدكتورة محمد سمير", DOCTORS).text, "هتكشف عند الدكتور");
});

test("an English reply gets 'the doctor', not an Arabic word in the middle", () => {
  const r = stripDoctorNames("Your visit is with Dr. Sara Ali on Thursday.", DOCTORS);
  assert.equal(r.text, "Your visit is with the doctor on Thursday.");
  assert.equal(r.stripped, true);
});

test("whole words only: Ali is not Alia, and a reply with no name is returned untouched", () => {
  const r = stripDoctorNames("Alia Sara Alis", ["Ali", "Sara Ali"]);
  assert.equal(r.stripped, false);
  assert.equal(r.text, "Alia Sara Alis");
  const plain = "تمام، الدكتور هيشوفك بكره 🦷";
  assert.deepEqual(stripDoctorNames(plain, DOCTORS), { text: plain, stripped: false });
  assert.deepEqual(stripDoctorNames(plain, []), { text: plain, stripped: false });
});

test("regex characters in a stored name cannot break the match", () => {
  const r = stripDoctorNames("مع Dr. (Hany) + co", ["(Hany) + co"]);
  assert.equal(r.stripped, true);
  assert.equal(r.text, "مع the doctor");
});

/* ---------------------------------------------------------------- respond.ts wiring -------- */

const respond = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8");

test("both switches are read default-off from settings/whatsapp", () => {
  assert.ok(respond.includes("hideDoctorNames: d.botHideDoctorNames === true,"));
  assert.ok(respond.includes("closedNote: d.botClosedNote === true,"));
});

test("the closed note is appended only when the clinic switched it on", () => {
  assert.match(respond, /if \(settings\.closedNote && handoff && profile && replyText\.trim\(\)/);
  // The note itself is still the same text; only the gate changed.
  assert.ok(respond.includes("closedNoteEn(profile.schedule) : closedNote(profile.schedule)"));
});

test("the dentist question is skipped while names are hidden (every caller goes through listDoctors)", () => {
  const at = respond.indexOf("const listDoctors = () => {");
  assert.ok(at > 0);
  const head = respond.slice(at, at + 400);
  assert.match(head, /if \(settings\.hideDoctorNames\) \{\s*listDays\(""\);\s*return;\s*\}/);
  // The engine's own "dentists first" door is closed the same way.
  assert.match(respond, /ctx\.doctorCount = settings\.hideDoctorNames \? 0 : profile\?\.doctors\.length \?\? 0;/);
});

test("cards, slot labels and the day heading drop the dentist only when hidden", () => {
  assert.equal((respond.match(/\.\.\.\(doctorName && !settings\.hideDoctorNames \? \[`👨‍⚕️ \$\{doctorName\}`\] : \[\]\)/g) || []).length, 3);
  assert.ok(!/\.\.\.\(doctorName \? \[`👨‍⚕️/.test(respond), "no card still shows the dentist unconditionally");
  assert.ok(respond.includes("${doctorName && !hideDoctor ? ` مع ${doctorName}` : \"\"}"), "nextSlots label");
  assert.ok(!respond.includes("appointmentLine(appt)"), "every appointmentLine call passes the switch");
});

test("staff push notifications still carry the dentist (they are internal)", () => {
  assert.equal((respond.match(/\$\{doctorName \? ` — \$\{doctorName\}` : ""\}/g) || []).length, 2);
  assert.ok(respond.includes("${appt.doctor ? ` مع ${appt.doctor}` : \"\"}"));
});

test("both brains get the switch and the branches", () => {
  assert.ok(respond.includes("hideDoctorNames: settings.hideDoctorNames,"));
  assert.match(respond, /addressText: ctx\.addressText,\s*branchesText,\s*clinicPhone/);
  assert.ok(respond.includes("branchesText = branchesTextOf(profile.branches);"));
});

test("the name backstop runs only while hidden, and logs to ai_debug", () => {
  assert.match(respond, /if \(settings\.hideDoctorNames && profile\?\.doctors\.length && replyText\.trim\(\)\) \{/);
  assert.ok(respond.includes("doctorNameStripped: true"));
});

/* ---------------------------------------------------------------- settings UI -------------- */

const ui = readFileSync(new URL("../src/components/settings/WhatsAppSettings.tsx", import.meta.url), "utf8");

test("the settings screen reads, shows and writes both switches", () => {
  assert.ok(ui.includes("botHideDoctorNames: data?.botHideDoctorNames === true,"));
  assert.ok(ui.includes("botClosedNote: data?.botClosedNote === true,"));
  assert.ok(ui.includes("const next = { ...s, botHideDoctorNames: on };"));
  assert.ok(ui.includes("const next = { ...s, botClosedNote: on };"));
  assert.ok(ui.includes("Don't mention dentists' names: no names in booking cards, lists or AI replies; patients get the first free chair"));
  assert.ok(ui.includes("متقولش أسماء الدكاترة: مفيش أسماء في كروت الحجز ولا القوائم ولا ردود الذكاء الاصطناعي، والمريض بياخد أقرب كرسي فاضي"));
  assert.ok(ui.includes("When the clinic is shut, add the next opening time under a hand-off reply"));
  assert.ok(ui.includes("لو العيادة مقفولة، ضيف ميعاد الفتح الجاي تحت رد التحويل"));
});

console.log("botOwnerRules: ok");
