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
  SETUP_ROUTE,
  WEEK_DAYS,
  initialServiceChoices,
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

console.log("setupWizard: all assertions passed");
