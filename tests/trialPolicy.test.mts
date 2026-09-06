// When a free trial actually stops, and who decides.
//
// The enforcement for this was written long before anything used it. `firestore.rules` refuses
// every write once `expiresAt` has passed — its own comment says "a free trial ran forever:
// nothing ever flipped status, and expiresAt was the field that was supposed to end it" — and
// `lib/clinicStatus.ts` mirrors that for the Admin SDK routes that bypass rules. Both were
// reading a field that `/api/onboarding/create-clinic` never wrote. This file guards the piece
// that closes that loop, and it guards it hard, because the failure modes are asymmetric:
//
//   * Too lenient, and a trial runs forever again — a slow commercial leak nobody notices.
//   * Too strict, and a PAYING CUSTOMER'S CLINIC STOPS ACCEPTING WRITES. Mid-appointment, with
//     a patient in the chair. That one is not recoverable by apologising.
//
// So the cases below are mostly about the second: a malformed policy document must never produce
// a short trial, a backdated backfill must never produce a date in the past, and "expiry is off"
// must mean no field at all rather than a date far enough away that it looks off.
//
// Run with tsx so the TS modules load directly: npm run test:welcome / npm run test:trial
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TRIAL_DAYS,
  DEFAULT_TRIAL_POLICY,
  DEFAULT_WARN_WITHIN_DAYS,
  MAX_TRIAL_DAYS,
  MIN_TRIAL_DAYS,
  PLATFORM_SETTINGS_COLLECTION,
  TRIAL_POLICY_DOC,
  normalizeTrialPolicy,
  trialExpiryFrom,
  trialWarning,
} from "../src/lib/trialPolicy";
import { clinicActivity, expiryDate } from "../src/lib/clinicStatus";
import { ROOT_COLLECTIONS } from "../src/lib/restorePlan";
import { TRIAL_DAYS } from "../src/lib/welcomeJourney";

const REPO = join(import.meta.dirname, "..");
const DAY = 86400000;

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. The policy document, however mangled ------------------------------------------------

eq(normalizeTrialPolicy(undefined), DEFAULT_TRIAL_POLICY, "nothing saved yet is the default policy");
eq(normalizeTrialPolicy(null), DEFAULT_TRIAL_POLICY, "a null document is the default policy");
eq(normalizeTrialPolicy("14 days"), DEFAULT_TRIAL_POLICY, "a string where an object belongs is the default");
eq(normalizeTrialPolicy({}), DEFAULT_TRIAL_POLICY, "an empty document is the default");

eq(normalizeTrialPolicy({ trialDays: 30 }).trialDays, 30, "a plain number is honoured");
eq(normalizeTrialPolicy({ trialDays: "30" }).trialDays, 30, "a numeric string is honoured — a form posts strings");
eq(normalizeTrialPolicy({ trialDays: 30.6 }).trialDays, 31, "a fraction is rounded, not truncated to a shorter trial");

// The clamp is the guard against a mistyped box becoming a commercial decision.
eq(normalizeTrialPolicy({ trialDays: 0 }).trialDays, DEFAULT_TRIAL_DAYS, "zero days is not a trial; fall back rather than expire on creation");
eq(normalizeTrialPolicy({ trialDays: -5 }).trialDays, DEFAULT_TRIAL_DAYS, "a negative trial would expire before it started");
eq(normalizeTrialPolicy({ trialDays: 99999 }).trialDays, MAX_TRIAL_DAYS, "an absurd number is clamped, not accepted");
eq(normalizeTrialPolicy({ trialDays: MIN_TRIAL_DAYS }).trialDays, MIN_TRIAL_DAYS, "the minimum is allowed");
eq(normalizeTrialPolicy({ trialDays: NaN }).trialDays, DEFAULT_TRIAL_DAYS, "NaN falls back — an Invalid Date expiresAt is the worst possible write");
eq(normalizeTrialPolicy({ trialDays: "soon" }).trialDays, DEFAULT_TRIAL_DAYS, "unparseable text falls back");

// The switch. Absent must mean ON: a partial save must not silently un-expire every future trial.
eq(normalizeTrialPolicy({ trialDays: 20 }).expireTrials, true, "a document with no switch means expiry is on");
eq(normalizeTrialPolicy({ expireTrials: false }).expireTrials, false, "off is honoured");
eq(normalizeTrialPolicy({ expireTrials: true }).expireTrials, true, "on is honoured");
eq(normalizeTrialPolicy({ expireTrials: "no" }).expireTrials, true, "only an explicit false switches it off");

// The warning window can never exceed the trial, or a clinic is warned from the day it opens.
eq(normalizeTrialPolicy({ trialDays: 2, warnWithinDays: 7 }).warnWithinDays, 2, "the warning is clamped to the trial length");
eq(normalizeTrialPolicy({ trialDays: 2 }).warnWithinDays, 2, "…including the default, on a very short trial");
eq(normalizeTrialPolicy({ trialDays: 30 }).warnWithinDays, DEFAULT_WARN_WITHIN_DAYS, "a normal trial gets the default window");
eq(normalizeTrialPolicy({ warnWithinDays: 0 }).warnWithinDays, 0, "zero switches the warning off and is not treated as missing");
eq(normalizeTrialPolicy({ warnWithinDays: -3 }).warnWithinDays, DEFAULT_WARN_WITHIN_DAYS, "a negative window falls back");

// Normalising twice changes nothing — the dashboard normalises on save and on read.
{
  const once = normalizeTrialPolicy({ trialDays: 30.6, warnWithinDays: 99, expireTrials: "yes" });
  eq(normalizeTrialPolicy(once), once, "normalize is idempotent");
}

// --- 2. The date signup stamps ----------------------------------------------------------------

{
  const start = new Date("2026-09-01T10:00:00Z");
  const end = trialExpiryFrom(start, normalizeTrialPolicy({ trialDays: 14 }));
  eq(end!.toISOString(), "2026-09-15T10:00:00.000Z", "fourteen days is fourteen days, to the minute");
}

eq(
  trialExpiryFrom(new Date("2026-09-01T00:00:00Z"), normalizeTrialPolicy({ expireTrials: false })),
  null,
  "expiry switched off returns null — the caller must write NO field, not a far-future date"
);

eq(
  trialExpiryFrom(new Date("nonsense"), DEFAULT_TRIAL_POLICY),
  null,
  "an unreadable start date returns null rather than an Invalid Date that would deny every write"
);

// The whole point, end to end: the date signup produces is one the enforcement layers agree with.
{
  const start = new Date("2026-09-01T00:00:00Z");
  const policy = normalizeTrialPolicy({ trialDays: 14 });
  const expiresAt = trialExpiryFrom(start, policy)!;
  const clinic = { status: "Active", subscriptionTier: "Free Trial", expiresAt };

  ok(clinicActivity(clinic, new Date("2026-09-10T00:00:00Z")).active, "inside the trial, the clinic is writable");
  ok(clinicActivity(clinic, new Date("2026-09-14T23:59:00Z")).active, "on the last day, still writable");

  const after = clinicActivity(clinic, new Date("2026-09-15T00:00:01Z"));
  ok(!after.active, "one second past the date, the clinic stops accepting writes");
  eq(after.active === false ? after.reason : null, "expired", "…and says it expired rather than that it was suspended");
}

// And with expiry off, the clinic behaves exactly as every clinic did before this existed.
{
  const policy = normalizeTrialPolicy({ expireTrials: false });
  const expiresAt = trialExpiryFrom(new Date("2020-01-01T00:00:00Z"), policy);
  eq(expiresAt, null, "no date is produced");
  ok(
    clinicActivity({ status: "Active", subscriptionTier: "Free Trial" }, new Date("2099-01-01T00:00:00Z")).active,
    "a clinic with no expiresAt is writable forever — unchanged behaviour"
  );
}

// --- 3. The countdown banner --------------------------------------------------------------------

const policy3 = normalizeTrialPolicy({ trialDays: 14, warnWithinDays: 3 });
const now3 = new Date("2026-09-10T00:00:00Z");

function warnAt(daysFromNow: number, over: Partial<Parameters<typeof trialWarning>[0]> = {}) {
  return trialWarning({
    expiresAt: new Date(now3.getTime() + daysFromNow * DAY),
    isTrial: true,
    policy: policy3,
    now: now3,
    ...over,
  });
}

eq(warnAt(10).warn, false, "ten days out, say nothing");
eq(warnAt(4).warn, false, "four days out is outside a three-day window");
eq(warnAt(3).warn, true, "exactly at the window, warn");
eq(warnAt(3).daysLeft, 3, "…and say three");
eq(warnAt(1).warn, true, "one day out, warn");
eq(warnAt(1).daysLeft, 1, "…and say one, which is the day people act on");

// Part of a day still counts as a day left — never "0 days left" on a clinic that still works.
eq(warnAt(0.25).daysLeft, 1, "six hours left rounds up to one day, not zero");
eq(warnAt(0.25).warn, true, "…and still warns");

// Past the date, the read-only banner owns the screen and says something truer.
eq(warnAt(-1).warn, false, "already expired: the countdown stands down for the read-only notice");
eq(warnAt(0).warn, false, "exactly at the deadline is expired, not a warning");

eq(warnAt(2, { isTrial: false }).warn, false, "a paying clinic is never given a trial countdown");
eq(warnAt(2, { expiresAt: null }).warn, false, "a clinic with no end date has nothing to count down to");
eq(
  trialWarning({ expiresAt: new Date(now3.getTime() + DAY), isTrial: true, policy: normalizeTrialPolicy({ warnWithinDays: 0 }), now: now3 }).warn,
  false,
  "a zero window switches the banner off, as the setting promises"
);

// --- 4. The wiring nothing else checks ------------------------------------------------------------

// (a) Signup must actually write the field. This is the bug the whole change exists to fix, and
//     it is one deleted line away from coming back — silently, because a clinic with no expiry
//     looks completely healthy right up until it never expires.
{
  const route = readFileSync(join(REPO, "src/app/api/onboarding/create-clinic/route.ts"), "utf8");
  ok(route.includes("trialExpiryFrom"), "create-clinic must compute an expiry from the policy");
  ok(
    /expiresAt\s*\?\s*\{\s*expiresAt\s*\}/.test(route),
    "create-clinic must write `expiresAt` onto the clinic — conditionally, so 'expiry off' writes no field"
  );
  ok(
    route.includes("serverTimestamp"),
    "createdAt should stay a server timestamp; only expiresAt is a computed Date"
  );
}

// (b) The rules must keep enforcing it. `isClinicActive` is what actually stops the writes, and
//     it is the kind of thing a later edit simplifies away without realising what it was for.
{
  const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");
  // Sliced to the one function rather than matched with a windowed regex: the body carries a
  // five-line comment, so any fixed window is either too small to reach the return or big enough
  // to match `expires > request.time` sitting in some unrelated function further down.
  const activeStart = rules.indexOf("function isClinicActive(");
  ok(activeStart !== -1, "firestore.rules must still have isClinicActive — it is what stops the writes");
  const activeBody = rules.slice(activeStart, rules.indexOf("\n    function ", activeStart + 1));
  ok(
    activeBody.includes("expires > request.time"),
    "isClinicActive must still refuse writes past expiresAt — without this the stamped date is decoration"
  );
  ok(
    activeBody.includes("expires is timestamp"),
    "…and must keep the type guard, or a clinic whose expiresAt holds a string is frozen out of its own database"
  );
  ok(
    /match \/platform_settings\/\{docId\} \{[\s\S]{0,200}?allow write: if isSuperAdmin\(\);/.test(rules),
    "only a superadmin may write the trial policy — otherwise a clinic admin grants themselves an endless trial"
  );
  ok(
    /match \/platform_settings\/\{docId\} \{[\s\S]{0,200}?allow read: if isAuth\(\);/.test(rules),
    "the dashboard reads warnWithinDays, so the policy must be readable by a signed-in user"
  );
}

// (c) A per-clinic restore must never write platform settings back. One clinic's recovery
//     rewinding the trial length for every tenant is the kind of blast radius that is only ever
//     noticed weeks later.
ok(
  (ROOT_COLLECTIONS as readonly string[]).includes(PLATFORM_SETTINGS_COLLECTION),
  "platform_settings must be refused by restorePlan — it is not one clinic's data"
);

// (d) One trial length, not two. The welcome guide counts down and signup stamps; if these ever
//     disagreed, the guide would promise a date the rules do not enforce.
eq(TRIAL_DAYS, DEFAULT_TRIAL_DAYS, "the guide's fallback and the policy default are the same number");

// (e) The document address is shared by three readers — the dashboard, signup, and the backfill.
eq(PLATFORM_SETTINGS_COLLECTION, "platform_settings", "the collection name is what firestore.rules declares");
eq(TRIAL_POLICY_DOC, "trials", "the document id is stable");
{
  const backfill = readFileSync(join(REPO, "src/app/api/admin/backfill-trial-expiry/route.ts"), "utf8");
  ok(backfill.includes("requireSuperAdmin"), "the backfill is superadmin-only — it can end customers' access");
  ok(
    backfill.includes("apply === true"),
    "the backfill must default to preview: applying has to be an explicit second request"
  );
  ok(
    /if \(expiryDate\(data\.expiresAt\)\) continue;/.test(backfill),
    "the backfill must never overwrite a date a human already set"
  );
  // An absent tier reads as "Free Trial" everywhere else (hasFeature, getAiCreditLimit), so
  // filtering the tier in the QUERY here would skip exactly the oldest clinics — the ones most
  // likely to be missing the field — while reporting the job complete.
  //
  // Comments are stripped before this check: the route explains that reasoning in prose, and a
  // naive `includes` matched the explanation instead of the code. A test that a comment can
  // satisfy is a test of nothing.
  const backfillCode = backfill
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  ok(
    !backfillCode.includes('where("subscriptionTier"'),
    "the backfill must not filter tiers in the query: a clinic with no tier field is a trial too"
  );
  ok(
    backfillCode.includes('"Free Trial"'),
    "…it filters in code instead, defaulting an absent tier to Free Trial"
  );
}

// --- 5. The backfill's grace floor, as arithmetic ---------------------------------------------
//
// Re-derived here rather than imported, because the route is a Next handler this test cannot
// call. The floor is the one line standing between "backfill existing trials" and "take eleven
// working clinics read-only this afternoon", so the sums it does are worth pinning even in copy.

function backfillDate(createdAt: Date | null, trialDays: number, graceDays: number, now: number) {
  const fromSignup = createdAt ? createdAt.getTime() + trialDays * DAY : now + trialDays * DAY;
  const floor = now + graceDays * DAY;
  const flooredToGrace = fromSignup < floor;
  return { at: new Date(flooredToGrace ? floor : fromSignup), flooredToGrace };
}

{
  const now = new Date("2026-09-10T00:00:00Z").getTime();

  // Signed up yesterday: the normal case, dated from signup, no floor.
  const fresh = backfillDate(new Date("2026-09-09T00:00:00Z"), 14, 7, now);
  eq(fresh.flooredToGrace, false, "a recent signup is dated from its own start");
  eq(fresh.at.toISOString(), "2026-09-23T00:00:00.000Z", "…fourteen days after it signed up");

  // Signed up a year ago: createdAt + 14 days is long past. Without the floor this clinic would
  // go read-only the instant the backfill committed.
  const old = backfillDate(new Date("2025-09-10T00:00:00Z"), 14, 7, now);
  eq(old.flooredToGrace, true, "an old signup hits the grace floor");
  eq(old.at.toISOString(), "2026-09-17T00:00:00.000Z", "…and gets seven days' notice instead of a date in the past");
  ok(old.at.getTime() > now, "no backfilled clinic is ever given a date in the past");

  // Exactly on the boundary.
  const boundary = backfillDate(new Date("2026-09-03T00:00:00Z"), 14, 7, now);
  eq(boundary.flooredToGrace, false, "signup + trial landing exactly on the floor is not floored");
  eq(boundary.at.toISOString(), "2026-09-17T00:00:00.000Z", "…and both routes agree on the date anyway");

  // No readable signup date: start the clock now rather than guessing.
  const undated = backfillDate(null, 14, 7, now);
  eq(undated.flooredToGrace, false, "an undated clinic gets a full trial from today");
  eq(undated.at.toISOString(), "2026-09-24T00:00:00.000Z", "…fourteen days out");

  // A zero grace period is allowed, and then old clinics really do expire immediately. That is a
  // deliberate choice the operator can make, and the preview names every clinic it would hit.
  const noGrace = backfillDate(new Date("2025-09-10T00:00:00Z"), 14, 0, now);
  eq(noGrace.at.getTime(), now, "with no grace, an old clinic is dated to this moment");
}

// --- 6. expiryDate reads what the backfill and signup write --------------------------------------
//
// Signup writes a JS Date through the Admin SDK, which reads back as a Timestamp. Both shapes
// have to survive the round trip or the countdown silently reads "no expiry".
{
  const d = new Date("2026-09-15T00:00:00Z");
  eq(expiryDate(d)?.toISOString(), d.toISOString(), "a Date passes through");
  eq(expiryDate({ toDate: () => d })?.toISOString(), d.toISOString(), "a Firestore Timestamp is read");
  eq(expiryDate(d.getTime())?.toISOString(), d.toISOString(), "millis are read");
  eq(expiryDate(null), null, "absent stays absent — which every layer reads as 'never expires'");
  eq(expiryDate("2026-09-15"), null, "a hand-written string is NOT an expiry, matching the rules' type guard");
}

console.log(`trialPolicy: ${checks} checks passed`);
