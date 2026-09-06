// The welcome guide: the route a new clinic is walked through, and everything that can silently
// break it.
//
// This guide is the first thing a trialling clinic sees and the last thing anyone re-reads, so
// every one of its failures is quiet by nature — nothing throws, the page just teaches less than
// it says it does, or claims a step is finished when it is not. These pin the five ways that
// happens:
//
//   1. A mission pointing at a lesson that no longer exists. The button does nothing.
//   2. A mission nobody can ever finish — no stored proof AND no lesson — so the percentage
//      cannot reach 100 and the coach never stops asking for the same thing.
//   3. A gate that disagrees with its lesson's gate. A receptionist offered an admin mission gets
//      a ring hunting for a tab their role does not render, which is exactly the failure
//      `adminOnly` was added to `tutorials.ts` to prevent.
//   4. A signal no probe answers. `welcomeSignals.ts` and `welcomeJourney.ts` are separate files
//      and nothing but this test connects a mission's `signal` to the read that resolves it.
//   5. The trial clock. Signup stamps a real `expiresAt` from the platform policy now, and the
//      countdown must prefer it — a guide promising four more days than the rules will allow is
//      worse than no countdown. The derived fallback still runs for the clinics created before
//      that existed, and a derivation one day out lies on the last day, the only day it matters.
//
// Run with tsx so the TS modules load directly: npm run test:welcome
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COACH_SNOOZE_MS,
  JOURNEY_STAGES,
  MISSIONS,
  MISSION_IDS,
  TRIAL_DAYS,
  coachDecision,
  coachGreeting,
  isMissionDone,
  journeyProgress,
  lockedMissionsFor,
  missionById,
  missionsFor,
  trialStatus,
  type Mission,
  type MissionSignals,
} from "../src/lib/welcomeJourney";
import { TUTORIALS, tutorialsFor } from "../src/lib/tutorials";
import { getAllPermissionIds } from "../src/config/permissionsCatalog";

const REPO = join(import.meta.dirname, "..");

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. Every mission points at something that exists -------------------------------------------

ok(MISSIONS.length > 0, "the journey has missions");
eq(new Set(MISSION_IDS).size, MISSIONS.length, "mission ids are unique — two rows with one id is one row you cannot address");

const stageIds = new Set(JOURNEY_STAGES.map((s) => s.id));
const tutorialIds = new Set(TUTORIALS.map((t) => t.id));

for (const m of MISSIONS) {
  ok(stageIds.has(m.stage), `mission "${m.id}" is in stage "${m.stage}", which JOURNEY_STAGES does not declare — it would never render`);
  ok(
    !m.tutorialId || tutorialIds.has(m.tutorialId),
    `mission "${m.id}" names lesson "${m.tutorialId}", which tutorials.ts does not have. "Show me how" does nothing.`
  );
  ok(
    !!m.signal || !!m.tutorialId,
    `mission "${m.id}" has neither a signal nor a lesson, so nothing can ever mark it done. ` +
      `The progress bar can never reach 100% and the coach asks for it forever.`
  );
  ok(m.minutes > 0, `mission "${m.id}" claims ${m.minutes} minutes; the "minutes left" line is a sum of these`);
  ok(m.route.startsWith("/"), `mission "${m.id}" has route "${m.route}", which is not an app path`);
  ok(m.title.en.trim() && m.title.ar.trim(), `mission "${m.id}" is missing a title in one language`);
  ok(m.payoff.en.trim() && m.payoff.ar.trim(), `mission "${m.id}" is missing its payoff in one language`);
}

for (const stage of JOURNEY_STAGES) {
  ok(
    MISSIONS.some((m) => m.stage === stage.id),
    `stage "${stage.id}" holds no missions — it would render as an empty heading`
  );
}

ok(missionById("first-patient") !== undefined, "missionById finds a known mission");
ok(missionById("no-such-mission") === undefined, "missionById returns undefined for a stranger");

// --- 2. Every route a mission opens is a real page -----------------------------------------------
//
// A mission with no lesson falls back to `router.push(mission.route)`, and a route that 404s is
// the guide sending someone to a dead end. Checked against the layout's own nav table and the
// settings registry rather than the filesystem, because those are what actually decide what
// exists.
{
  const layout = readFileSync(join(REPO, "src/app/(dashboard)/layout.tsx"), "utf8");
  const registry = readFileSync(join(REPO, "src/config/settingsRegistry.ts"), "utf8");
  for (const m of MISSIONS) {
    const inNav = layout.includes(`href: "${m.route}"`);
    const inSettings = registry.includes(`route: "${m.route}"`);
    ok(
      inNav || inSettings,
      `mission "${m.id}" opens "${m.route}", which is neither a nav destination nor a settings ` +
        `section. A mission with no lesson pushes this route directly.`
    );
  }
}

// --- 3. A mission is never offered to someone its lesson refuses ---------------------------------
//
// The drift that matters. `tutorials.ts` gates on role because a lesson whose first ring points at
// a tab the caller cannot render starts, hunts and dies; a mission that is looser than its own
// lesson re-opens that hole from the other side.

for (const m of MISSIONS) {
  if (!m.tutorialId) continue;
  const lesson = TUTORIALS.find((t) => t.id === m.tutorialId)!;
  if (lesson.adminOnly) {
    ok(
      m.adminOnly === true,
      `lesson "${lesson.id}" is adminOnly but mission "${m.id}" is not, so a receptionist is ` +
        `offered a step whose walkthrough rings a screen their role does not render`
    );
  }
  if (lesson.requires && !m.adminOnly) {
    ok(
      m.requires === lesson.requires,
      `lesson "${lesson.id}" requires "${lesson.requires}" but mission "${m.id}" requires ` +
        `"${m.requires ?? "nothing"}". The mission must not be reachable by someone the lesson refuses.`
    );
  }
}

// Permissions are storage keys, so a typo is a gate that never opens for anybody.
{
  const known = new Set(getAllPermissionIds());
  for (const m of MISSIONS) {
    if (!m.requires) continue;
    ok(
      known.has(m.requires),
      `mission "${m.id}" requires "${m.requires}", which is not a permission an admin can grant — ` +
        `the mission would be invisible to every non-admin, forever`
    );
  }
}

// --- 4. Every signal a mission names is actually read --------------------------------------------
//
// `welcomeSignals.ts` is a separate module and imports nothing from the mission list. A mission
// carrying a signal no probe answers reads as permanently unfinished, which is worse than having
// no signal at all: the fallback (finishing the lesson) still works, so nobody notices that a
// clinic which already did the thing is being asked to do it again.
{
  const signalsSource = readFileSync(join(REPO, "src/lib/welcomeSignals.ts"), "utf8");
  const probed = new Set([...signalsSource.matchAll(/key:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]));
  for (const m of MISSIONS) {
    if (!m.signal) continue;
    ok(
      probed.has(m.signal),
      `mission "${m.id}" is proved by the "${m.signal}" signal, which welcomeSignals.ts never ` +
        `reads. It would show as unfinished for a clinic that has already done it.`
    );
  }
  // And the other way: a probe nobody consults is thirteen reads becoming fourteen for nothing.
  const used = new Set(MISSIONS.map((m) => m.signal).filter(Boolean));
  for (const key of probed) {
    ok(
      used.has(key as Mission["signal"]),
      `welcomeSignals.ts probes "${key}", which no mission uses — a Firestore read per session ` +
        `for an answer nothing asks for`
    );
  }
}

// --- 5. Who sees what ----------------------------------------------------------------------------

const ADMIN = { isAdmin: true, permissions: [] as string[] };
const RECEPTION = {
  isAdmin: false,
  permissions: [
    "access.patients", "access.appointments", "patients.add", "appointments.add", "finance.add",
    "access.reports",
  ],
};
const NOBODY = { isAdmin: false, permissions: [] as string[] };

{
  const forAdmin = missionsFor(ADMIN);
  eq(forAdmin.length, MISSIONS.length, "an admin on a plan with everything sees every mission");

  const forReception = missionsFor(RECEPTION);
  ok(
    forReception.every((m) => !m.adminOnly),
    "a receptionist is never offered an admin-only mission"
  );
  ok(
    forReception.some((m) => m.id === "first-patient"),
    "a receptionist with patients.add is offered the first-patient mission"
  );
  ok(
    !forReception.some((m) => m.id === "first-treatment"),
    "a receptionist without clinical.edit is not offered the treatment mission"
  );

  eq(missionsFor(NOBODY).length, 0, "someone with no permissions is offered nothing rather than a list of locked doors");
}

// The plan gate moves a mission out of the checklist entirely rather than leaving it unfinishable.
{
  const noInventory = {
    isAdmin: true,
    permissions: [] as string[],
    hasFeature: (f: string) => f !== "inventory",
  };
  const visible = missionsFor(noInventory);
  const locked = lockedMissionsFor(noInventory);

  ok(!visible.some((m) => m.id === "stock-item"), "a clinic without the inventory feature is not asked to stock it");
  ok(locked.some((m) => m.id === "stock-item"), "…it is listed as locked instead, so the reason is visible");
  ok(
    locked.every((m) => !visible.includes(m)),
    "no mission is both counted and locked — that would be a progress bar that cannot complete"
  );

  // And it must not vanish from the count denominator by accident on the way through.
  const progress = journeyProgress(visible, {}, []);
  eq(progress.total, visible.length, "the denominator is exactly the missions this person can finish");
}

// A caller with no feature probe (the clinic document has not loaded yet) is shown everything
// rather than a list that shrinks a moment later.
eq(
  missionsFor({ isAdmin: true, permissions: [] }).length,
  MISSIONS.length,
  "with no hasFeature probe, plan-gated missions stay visible instead of flickering"
);

// --- 6. Done means done --------------------------------------------------------------------------

const patientMission = missionById("first-patient")!;
const reportMission = missionById("read-reports")!;

ok(isMissionDone(patientMission, { patients: true }, []), "the stored fact ticks the mission");
ok(
  isMissionDone(patientMission, {}, ["add-patient"]),
  "finishing the lesson ticks it too, for a clinic whose data has not caught up"
);
ok(!isMissionDone(patientMission, { patients: false }, []), "an explicit false is not done");
ok(!isMissionDone(patientMission, {}, []), "no evidence either way is not done");
ok(
  !isMissionDone(patientMission, {}, ["book-appointment"]),
  "finishing a DIFFERENT lesson does not tick this mission"
);
ok(
  isMissionDone(reportMission, {}, ["explore-reports"]),
  "a mission with no stored proof is finished by its lesson — the only evidence reading a report leaves"
);

// The data wins over the lesson, which is the whole point: a clinic that has been registering
// patients for a fortnight must not be asked to register their first one.
ok(
  isMissionDone(patientMission, { patients: true }, []),
  "the clinic's own data is enough on its own, with no lesson watched"
);

// --- 7. The arithmetic on the page ----------------------------------------------------------------

{
  const missions = missionsFor(ADMIN);
  const empty = journeyProgress(missions, {}, []);
  eq(empty.done, 0, "a brand-new clinic has done nothing");
  eq(empty.percent, 0, "…and reads 0%");
  eq(empty.complete, false, "…and is not complete");
  ok(empty.next !== null, "…and has a next step");
  eq(
    empty.next!.id,
    missions[0].id,
    "the next step is the first unfinished mission in route order — the order missions are declared in"
  );
  eq(
    empty.minutesLeft,
    missions.reduce((sum, m) => sum + m.minutes, 0),
    "with nothing done, the minutes left are every mission's minutes"
  );

  // Stages with nothing in them for this person are dropped rather than rendered as empty headings.
  ok(
    empty.stages.every((s) => s.total > 0),
    "no stage is rendered with zero missions"
  );
  eq(
    empty.stages.reduce((sum, s) => sum + s.total, 0),
    missions.length,
    "every mission lands in exactly one stage"
  );

  const receptionProgress = journeyProgress(missionsFor(RECEPTION), {}, []);
  ok(
    !receptionProgress.stages.some((s) => s.stage.id === "setup"),
    "a receptionist's guide has no 'Open for business' heading — every step in it is admin-only"
  );
}

{
  const missions = missionsFor(ADMIN);
  const allSignals: MissionSignals = {};
  for (const m of missions) if (m.signal) allSignals[m.signal] = true;
  const allLessons = missions.map((m) => m.tutorialId!).filter(Boolean);

  const finished = journeyProgress(missions, allSignals, allLessons);
  eq(finished.done, missions.length, "everything proved is everything done");
  eq(finished.percent, 100, "…which is 100%");
  eq(finished.complete, true, "…and complete");
  eq(finished.next, null, "…with nothing left to point at");
  eq(finished.minutesLeft, 0, "…and no minutes left");
}

// One done: the percentage rounds rather than truncating, and `next` skips what is finished.
{
  const missions = missionsFor(ADMIN);
  const first = missions[0];
  const signals: MissionSignals = first.signal ? { [first.signal]: true } : {};
  const p = journeyProgress(missions, signals, first.signal ? [] : [first.tutorialId!]);
  eq(p.done, 1, "exactly one mission is done");
  eq(p.next!.id, missions[1].id, "next skips the finished one");
  eq(p.percent, Math.round((1 / missions.length) * 100), "the percentage is rounded, not floored");
}

// Nothing to do at all reads as finished, not as a permanent 0% with a NaN ring.
{
  const none = journeyProgress([], {}, []);
  eq(none.percent, 100, "0 of 0 is 100%, not NaN");
  eq(none.complete, true, "0 of 0 is complete");
  eq(none.next, null, "0 of 0 has no next step");
  eq(none.stages.length, 0, "0 of 0 renders no stages");
}

// --- 8. The trial clock ---------------------------------------------------------------------------

const DAY = 86400000;

{
  // An explicit expiry set in the superadmin panel wins: it is the date the clinic is held to.
  const at = new Date("2026-09-10T12:00:00Z");
  const t = trialStatus(
    {
      subscriptionTier: "Free Trial",
      createdAt: new Date("2026-09-01T12:00:00Z"),
      expiresAt: new Date("2026-09-20T12:00:00Z"),
    },
    at
  );
  eq(t.isTrial, true, "Free Trial is a trial");
  eq(t.endsAt!.toISOString(), "2026-09-20T12:00:00.000Z", "the explicit expiry is the end");
  eq(t.daysLeft, 10, "ten days from the 10th to the 20th");
  eq(t.dayNumber, 10, "the 10th is day ten of a trial that started on the 1st");
  eq(t.totalDays, 19, "the window is as long as the two dates make it, not TRIAL_DAYS");
  eq(t.ended, false, "not over yet");
}

{
  // No stored expiry: a clinic created before signup stamped the field, or a policy with expiry
  // switched off. The end is derived from signup — a coaching estimate, never an enforcement
  // claim, since nothing goes read-only on a date this function invented.
  const created = new Date("2026-09-01T00:00:00Z");
  const t = trialStatus(
    { subscriptionTier: "Free Trial", createdAt: created },
    new Date("2026-09-06T00:00:00Z")
  );
  eq(t.totalDays, TRIAL_DAYS, "with no expiry, the window is TRIAL_DAYS long");
  eq(t.endsAt!.getTime(), created.getTime() + TRIAL_DAYS * DAY, "…ending TRIAL_DAYS after signup");
  eq(t.daysLeft, TRIAL_DAYS - 5, "five days in, nine left of fourteen");
  eq(t.dayNumber, 6, "the sixth day is day six, not day five");
}

{
  // A Firestore Timestamp, which is what the clinic document actually holds.
  const created = new Date("2026-09-01T00:00:00Z");
  const t = trialStatus(
    { subscriptionTier: "Free Trial", createdAt: { toDate: () => created } },
    new Date("2026-09-01T06:00:00Z")
  );
  eq(t.dayNumber, 1, "signup day is day one");
  eq(t.daysLeft, TRIAL_DAYS, "a few hours in, the whole trial is still ahead");
}

{
  // Past the end. It says so; it does not go negative and it does not wrap.
  const t = trialStatus(
    { subscriptionTier: "Free Trial", createdAt: new Date("2026-08-01T00:00:00Z") },
    new Date("2026-09-06T00:00:00Z")
  );
  eq(t.ended, true, "a month after a fourteen-day trial, it has ended");
  eq(t.daysLeft, 0, "days left floors at zero rather than going negative");
  eq(t.dayNumber, TRIAL_DAYS, "the day number is clamped to the length of the trial");
}

{
  // Clock skew, or a createdAt in the future. Neither may produce day zero.
  const t = trialStatus(
    { subscriptionTier: "Free Trial", createdAt: new Date("2026-09-10T00:00:00Z") },
    new Date("2026-09-06T00:00:00Z")
  );
  eq(t.dayNumber, 1, "a clinic created 'tomorrow' is still on day one, never day zero or minus three");
}

{
  // No dates at all — a clinic document that could not be read. No invented countdown.
  const t = trialStatus({ subscriptionTier: "Free Trial" });
  eq(t.endsAt, null, "with no dates there is no end date");
  eq(t.isTrial, true, "…but the tier is still known");
}

eq(trialStatus({ subscriptionTier: "Premium", createdAt: new Date() }).isTrial, false, "a paying clinic is not on trial");
eq(trialStatus(null).isTrial, true, "an unread clinic is treated as a trial — the guide is the safe default");

// --- 9. When the coach speaks, and when it must not ------------------------------------------------

{
  const unfinished = journeyProgress(missionsFor(ADMIN), {}, []);
  const missions = missionsFor(ADMIN);
  const allSignals: MissionSignals = {};
  for (const m of missions) if (m.signal) allSignals[m.signal] = true;
  const finished = journeyProgress(missions, allSignals, missions.map((m) => m.tutorialId!).filter(Boolean));

  eq(coachDecision({ progress: unfinished }).speak, true, "with work left, the coach speaks");
  eq(coachDecision({ progress: unfinished }).reason, "next-mission", "…about the next mission");

  eq(coachDecision({ progress: finished }).speak, false, "it stops when the guide is finished");
  eq(coachDecision({ progress: finished }).reason, "complete", "…and says why");

  eq(
    coachDecision({ progress: unfinished, tutorialRunning: true }).reason,
    "tutorial-running",
    "it never talks over a lesson's ring"
  );
  eq(
    coachDecision({ progress: unfinished, dismissedForever: true }).reason,
    "dismissed",
    "switched off stays off"
  );

  const now = 1_800_000_000_000;
  eq(
    coachDecision({ progress: unfinished, snoozedUntil: now + COACH_SNOOZE_MS, now }).reason,
    "snoozed",
    "'Later' is honoured"
  );
  eq(
    coachDecision({ progress: unfinished, snoozedUntil: now - 1, now }).speak,
    true,
    "…and expires"
  );

  // Precedence: a lesson on screen outranks every other reason, because the ring owns the viewport.
  eq(
    coachDecision({ progress: finished, tutorialRunning: true, dismissedForever: true }).reason,
    "tutorial-running",
    "the running lesson is checked first"
  );
}

ok(COACH_SNOOZE_MS >= 60 * 60 * 1000, "'Later' means at least an hour — a token snooze is a button pressed eight times");

// --- 10. What the coach actually says ---------------------------------------------------------------

{
  const progress = journeyProgress(missionsFor(ADMIN), {}, []);
  const trial = trialStatus(
    { subscriptionTier: "Free Trial", createdAt: new Date("2026-09-01T00:00:00Z") },
    new Date("2026-09-05T00:00:00Z")
  );

  const en = coachGreeting({ progress, trial, isAr: false, firstName: "Nour" });
  ok(en.includes("Nour"), "the greeting uses the person's first name when it has one");
  ok(en.includes(progress.next!.title.en), "…and names the next step");
  ok(en.includes(progress.next!.payoff.en), "…and says what it is worth");
  ok(en.includes("Step 1 of"), "…and where they are in the route");
  ok(en.includes(`${trial.daysLeft} days left`), "…and how much trial is left");

  const ar = coachGreeting({ progress, trial, isAr: true, firstName: "نور" });
  ok(ar.includes(progress.next!.title.ar), "the Arabic greeting is Arabic throughout");
  ok(!ar.includes(progress.next!.title.en), "…with no English leaking into it");

  const anonymous = coachGreeting({ progress, trial, isAr: false });
  ok(!anonymous.startsWith("Hi "), "no name means no empty greeting");
  ok(anonymous.includes(progress.next!.title.en), "…but still the next step");

  // A single day is a day, not "1 days" — the line people read on the last day of the trial.
  const lastDay = trialStatus(
    { subscriptionTier: "Free Trial", createdAt: new Date("2026-09-01T00:00:00Z") },
    new Date("2026-09-14T12:00:00Z")
  );
  eq(lastDay.daysLeft, 1, "the 14th of a trial started on the 1st has one day left");
  ok(coachGreeting({ progress, trial: lastDay, isAr: false }).includes("1 day left"), "…said as '1 day left'");

  // A paying clinic still gets the guide, without a countdown that would make no sense.
  const paid = trialStatus({ subscriptionTier: "Premium", createdAt: new Date("2026-01-01T00:00:00Z") }, new Date("2026-09-05T00:00:00Z"));
  ok(!coachGreeting({ progress, trial: paid, isAr: false }).includes("left in your trial"), "a paying clinic is told nothing about a trial");

  // And there is a graceful ending rather than a bubble that lingers with nothing to say.
  const missions = missionsFor(ADMIN);
  const allSignals: MissionSignals = {};
  for (const m of missions) if (m.signal) allSignals[m.signal] = true;
  const done = journeyProgress(missions, allSignals, missions.map((m) => m.tutorialId!).filter(Boolean));
  ok(coachGreeting({ progress: done, trial, isAr: false }).length > 0, "a finished guide still has a sentence");
}

// --- 11. Nothing the guide teaches is unreachable ---------------------------------------------------
//
// Not an equality: a lesson with no mission is legitimate and the guide's "More lessons" section
// renders it. What must never happen is a lesson that NO surface offers — which is the state the
// whole feature exists to end.
{
  const claimed = new Set(MISSIONS.map((m) => m.tutorialId).filter(Boolean));
  const adminSees = new Set([
    ...missionsFor(ADMIN).map((m) => m.tutorialId).filter(Boolean),
    ...tutorialsFor(true, []).map((t) => t.id),
  ]);
  for (const t of TUTORIALS) {
    ok(
      adminSees.has(t.id),
      `lesson "${t.id}" is offered by no mission and by no menu an admin can see — it is unreachable`
    );
  }
  ok(claimed.size > 0, "the journey claims at least some lessons");
}

console.log(`welcomeJourney: ${checks} checks passed across ${MISSIONS.length} missions and ${JOURNEY_STAGES.length} stages`);
