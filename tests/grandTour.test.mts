// Sara's tour: every screen, every setting — and everything that can quietly make it lie.
//
// The tour describes the app in prose, and prose does not fail loudly. A stop pointing at a page
// that moved narrates over a 404; a settings section added without a narration silently drops
// out of "every setting"; a help slug that was renamed hands the model nothing and it improvises.
// None of that throws. These pin it:
//
//   1. Every stop id is unique and every stop belongs to a declared chapter, in chapter order.
//   2. Every static route is one the assistant may navigate to (the same allowlist navigate_to
//      uses) or a settings section route from the registry — so the tour and the assistant
//      agree on what screens exist.
//   3. Every settings section in the registry has a tour stop, and every settings stop names a
//      section that exists. "Every setting" is a claim this file makes true by construction.
//   4. Every help slug on a stop is a real article on disk (English is the drafting language).
//   5. Both languages are present on every line, and the model's notes are non-trivial.
//   6. Gating works the way the navigation gates: a stop on a hidden page is filtered out, an
//      admin sees everything, a receptionist with nothing sees the free stops only.
//
// Run with tsx: npm run test:tour
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TUTORIAL_IDS } from "../src/lib/tutorials";
import {
  coreStopsFor,
  MAX_WALK_POINTS,
  TOUR_CHAPTERS,
  TOUR_STOPS,
  TOUR_STOP_IDS,
  tourChaptersFor,
  tourMinutes,
  tourStopById,
  tourStopsFor,
} from "../src/lib/grandTour";
import { SETTINGS_SECTIONS } from "../src/config/settingsRegistry";
import { resolveNavigablePath } from "../src/lib/aiNavigation";

// --- 1. ids and chapters ---------------------------------------------------------------------
assert.equal(new Set(TOUR_STOP_IDS).size, TOUR_STOP_IDS.length, "tour stop ids must be unique");
const chapterOrder = TOUR_CHAPTERS.map((c) => c.id);
let lastChapterIndex = 0;
for (const stop of TOUR_STOPS) {
  const idx = chapterOrder.indexOf(stop.chapter);
  assert.ok(idx >= 0, `${stop.id}: chapter '${stop.chapter}' is not declared`);
  assert.ok(idx >= lastChapterIndex, `${stop.id}: stops must be grouped in chapter order`);
  lastChapterIndex = idx;
}
assert.ok(TOUR_STOPS.length >= 40, `a grand tour has many stops, got ${TOUR_STOPS.length}`);
assert.equal(tourStopById("finale")?.chapter, "wrapup");

// --- the core tour: short, in order, per job, and every hands-on lesson is real -------------------
{
  const SETUP_MISSING = ["clinical", "services", "users"];
  const reception = coreStopsFor(TOUR_STOPS, SETUP_MISSING, "reception");
  const ids = reception.map((s) => s.id);
  assert.ok(reception.length >= 12 && reception.length <= 20, `core tour should be short, got ${reception.length}`);
  assert.equal(ids[0], "topbar");
  assert.equal(ids[ids.length - 1], "core-finale");
  for (const must of ["patients-add", "appointment-demo", "day-flow", "patient-payment", "demo-cleanup-patient"]) {
    assert.ok(ids.includes(must), `core tour must include ${must}`);
  }
  assert.ok(ids.indexOf("settings-services") < ids.indexOf("patients-add"), "setup comes before the first demo");
  assert.equal(
    coreStopsFor(TOUR_STOPS, [], "reception").filter((s) => s.core === "setup").length,
    0,
    "no setup stops when nothing is missing",
  );

  // Each job gets its own day, and every core run still ends on the same closing stop.
  for (const role of ["reception", "dentist", "owner"] as const) {
    const run = coreStopsFor(TOUR_STOPS, SETUP_MISSING, role);
    assert.ok(run.length >= 8, `${role}: core tour is too short (${run.length})`);
    assert.equal(run[run.length - 1].id, "core-finale", `${role}: core tour must end on the finale`);
    assert.equal(run[0].id, "topbar", `${role}: core tour must start on the navigation`);
    for (const s of run) {
      assert.ok(!s.coreRoles || s.coreRoles.includes(role), `${role}: ${s.id} does not belong in this run`);
      assert.ok(!s.handsOn?.roles || s.handsOn.roles.includes(role), `${role}: ${s.id} kept a hands-on meant for someone else`);
    }
  }
  const dentistIds = coreStopsFor(TOUR_STOPS, SETUP_MISSING, "dentist").map((s) => s.id);
  assert.ok(dentistIds.includes("patient-clinical") && dentistIds.includes("patient-rx"), "a dentist is taught the chair");
  assert.ok(!dentistIds.includes("patient-payment"), "a dentist is not taught the desk's payment");
  // The clinical stops act on Sara's test patient, so the stop that creates it has to come first.
  assert.ok(
    dentistIds.indexOf("patients-add") >= 0 && dentistIds.indexOf("patients-add") < dentistIds.indexOf("patient-clinical"),
    "the test patient must exist before the clinical stops use it",
  );
  const ownerIds = coreStopsFor(TOUR_STOPS, SETUP_MISSING, "owner").map((s) => s.id);
  assert.ok(ownerIds.includes("patient-payment"), "an owner sees the desk's day too");

  const handsOn = TOUR_STOPS.filter((s) => s.handsOn);
  assert.ok(handsOn.length >= 3, "the core tour has hands-on moments");
  for (const s of handsOn) {
    assert.ok(TUTORIAL_IDS.includes(s.handsOn!.tutorial), `${s.id}: hands-on lesson '${s.handsOn!.tutorial}' does not exist`);
    for (const key of ["say", "done", "gaveUp"] as const) {
      const line = s.handsOn![key];
      assert.ok(line, `${s.id}: hands-on needs a ${key} line`);
      assert.ok(line!.en.trim() && line!.ar.trim(), `${s.id}: hands-on ${key} must be bilingual`);
    }
    const unless = s.handsOn!.doneUnless;
    if (unless) assert.ok(unless.say.en.trim() && unless.say.ar.trim(), `${s.id}: doneUnless must be bilingual`);
  }
  for (const s of TOUR_STOPS) {
    const points = (s.walk ?? []).filter((a) => a.kind === "point").length;
    assert.ok(points <= MAX_WALK_POINTS, `${s.id}: walk points at ${points} things; the cap is ${MAX_WALK_POINTS}`);
  }
}

// --- Sara never promises a message a clinic cannot send ------------------------------------------
{
  // The whole tour, including every nested branch of a demo.
  const lines: string[] = [];
  const walk = (actions: readonly any[] | undefined) => {
    for (const a of actions ?? []) {
      for (const key of ["say", "text"] as const) {
        const v = (a as any)[key];
        if (v && typeof v === "object" && typeof v.en === "string") lines.push(v.en);
      }
      if ((a as any).then) walk((a as any).then);
    }
  };
  for (const stop of TOUR_STOPS) {
    lines.push(stop.say.en);
    walk(stop.walk);
    walk(stop.demo);
    if (stop.handsOn) lines.push(stop.handsOn.done.en, stop.handsOn.say.en);
  }
  for (const line of lines) {
    const promises = /goes out by itself|reaches your phone|check your whatsapp|on your phone already/i.test(line);
    if (!promises) continue;
    const hedged = /once your whatsapp|if that was your own number|for a real patient/i.test(line);
    assert.ok(hedged, `a line promises a message with no condition attached: "${line.slice(0, 90)}"`);
  }
}
assert.equal(tourStopById("nope"), undefined);

// --- 2. every route is a real screen ---------------------------------------------------------
const settingsRoutes = new Set(SETTINGS_SECTIONS.map((s) => s.route));
for (const stop of TOUR_STOPS) {
  if (stop.dynamic) continue; // resolved at runtime
  const ok = resolveNavigablePath(stop.route) === stop.route || settingsRoutes.has(stop.route);
  assert.ok(ok, `${stop.id}: route '${stop.route}' is neither navigable nor a settings section`);
}

// --- 3. every setting, by construction -------------------------------------------------------
const settingsStopIds = new Set(TOUR_STOPS.filter((s) => s.settingsId).map((s) => s.settingsId));
for (const section of SETTINGS_SECTIONS) {
  assert.ok(settingsStopIds.has(section.id), `settings section '${section.id}' has no tour stop — write its narration in grandTour.ts`);
}
const sectionIds = new Set(SETTINGS_SECTIONS.map((s) => s.id));
for (const stop of TOUR_STOPS) {
  if (stop.settingsId) {
    assert.ok(sectionIds.has(stop.settingsId), `${stop.id}: settings section '${stop.settingsId}' does not exist`);
    const section = SETTINGS_SECTIONS.find((s) => s.id === stop.settingsId)!;
    assert.equal(stop.route, section.route, `${stop.id}: route must be the section's route`);
  }
}

// --- 4. help slugs exist on disk -------------------------------------------------------------
const helpRoot = join(process.cwd(), "src", "content", "help", "en");
for (const stop of TOUR_STOPS) {
  for (const slug of stop.helpSlugs ?? []) {
    assert.ok(existsSync(join(helpRoot, `${slug}.md`)), `${stop.id}: help article '${slug}' is missing`);
  }
}

// --- 5. both languages, real notes -----------------------------------------------------------
for (const stop of TOUR_STOPS) {
  for (const key of ["title", "say"] as const) {
    assert.ok(stop[key].en.trim().length > 0, `${stop.id}: ${key}.en is empty`);
    assert.ok(stop[key].ar.trim().length > 0, `${stop.id}: ${key}.ar is empty`);
  }
  assert.ok(stop.ask.length >= 1, `${stop.id}: give at least one suggested question`);
  for (const q of stop.ask) {
    assert.ok(q.en.trim() && q.ar.trim(), `${stop.id}: a suggested question is missing a language`);
  }
  assert.ok(stop.knowledge.length >= 120, `${stop.id}: knowledge is too thin for the model to answer from`);
  // Spoken lines must fit the voice route's cap after speech cleanup; 600 is its hard limit.
  assert.ok(stop.say.en.length <= 600 && stop.say.ar.length <= 600, `${stop.id}: narration too long to read aloud`);
}
for (const chapter of TOUR_CHAPTERS) {
  assert.ok(chapter.title.en && chapter.title.ar && chapter.blurb.en && chapter.blurb.ar, `chapter ${chapter.id} is missing text`);
}

// --- 5b. demos ---------------------------------------------------------------------------------
// A demo-only stop with no demo is a stop that says nothing; a demo action without an anchor is
// a hand with nowhere to go; a click that narrows by row must carry a template the runner fills.
for (const stop of TOUR_STOPS) {
  if (stop.demoOnly) assert.ok(stop.demo && stop.demo.length > 0, `${stop.id}: demoOnly but has no demo`);
  for (const action of stop.demo ?? []) {
    if (action.kind === "click" || action.kind === "type" || action.kind === "wait") {
      assert.ok(action.anchor.trim().length > 0, `${stop.id}: a ${action.kind} action has no anchor`);
    }
    if (action.kind === "click" && action.inRowContaining) {
      assert.match(action.inRowContaining, /\{\{\w+\}\}/, `${stop.id}: inRowContaining should name a demo value`);
    }
    if (action.kind === "type") {
      assert.match(action.text, /\{\{\w+\}\}/, `${stop.id}: typed text should come from demo values, never a literal`);
    }
    if ("say" in action && action.say) {
      assert.ok(action.say.en && action.say.ar, `${stop.id}: a demo line is missing a language`);
    }
  }
  if (stop.dynamic === "demoPatient") assert.ok(stop.demoOnly, `${stop.id}: a demo-patient stop must be demo-only`);
}
assert.ok(TOUR_STOPS.some((s) => s.id === "patients-add" && s.demo), "the add-patient stop demonstrates");
assert.ok(TOUR_STOPS.some((s) => s.id === "demo-cleanup-patient"), "what Sara adds, Sara deletes");
assert.ok(TOUR_STOPS.some((s) => s.id === "demo-cleanup-rest"), "what Sara adds, Sara deletes");
assert.ok(TOUR_STOPS.some((s) => s.id === "demo-restore"), "and shows how to restore");
// The setup chapter comes before the day: hours, prices and team exist before a booking is demonstrated.
const idx = (id: string) => TOUR_STOPS.findIndex((s) => s.id === id);
assert.ok(idx("settings-services") < idx("appointment-demo"), "prices are set up before the booking demo");
assert.ok(idx("settings-users") < idx("appointment-demo"), "the team is set up before the booking demo");
assert.ok(idx("appointment-demo") < idx("day-flow") && idx("day-flow") < idx("demo-cleanup-day"), "book, run the day, then clean up");
// The release walks sit past the end of the tour proper: they are opened by name, never reached
// by pressing Next. So the LAST TOURED stop is the finale, and everything after it is a release.
{
  const toured = TOUR_STOPS.filter((s) => s.chapter !== "whatsnew");
  assert.equal(toured[toured.length - 1].id, "finale", "the tour ends on questions");
  const firstRelease = TOUR_STOPS.findIndex((s) => s.chapter === "whatsnew");
  if (firstRelease >= 0) {
    assert.ok(
      TOUR_STOPS.slice(firstRelease).every((s) => s.chapter === "whatsnew"),
      "release stops must all sit after the finale, or Next would walk into one",
    );
    for (const s of TOUR_STOPS.slice(firstRelease)) {
      assert.ok(!s.core, `${s.id}: a release stop is never part of a core tour`);
    }
  }
}
{
  const toured = TOUR_STOPS.filter((s) => s.chapter !== "whatsnew");
  assert.equal(toured[toured.length - 2].id, "settings-ai_credits", "credits are explained right before the end");
}

// --- 5c. walkthroughs ------------------------------------------------------------------------
// Every page stop walks its elements; every point has a target and a line in both languages.
const walked = TOUR_STOPS.filter((s) => s.walk && s.walk.length > 0);
assert.ok(walked.length >= 30, `expected most stops to have a walkthrough, got ${walked.length}`);
for (const stop of walked) {
  for (const action of stop.walk!) {
    if (action.kind === "point") {
      assert.ok(action.anchor || action.text, `${stop.id}: a point has neither anchor nor text`);
      if (action.text) assert.ok(action.text.en && action.text.ar, `${stop.id}: point text needs both languages`);
      assert.ok(action.say.en && action.say.ar, `${stop.id}: a point line is missing a language`);
    }
  }
}
for (const id of ["topbar", "account-menu", "dashboard", "patients", "patient-file", "appointments", "finance", "intelligence", "reports", "settings-services", "settings-users"]) {
  assert.ok(TOUR_STOPS.find((s) => s.id === id)?.walk?.length, `${id} must walk its screen`);
}

// --- 6. gating -------------------------------------------------------------------------------
const everything = tourStopsFor({
  isAdmin: true,
  visibleNavKeys: ["chats", "patients", "appointments", "leads", "finance", "inventory", "store", "lab", "attendance", "intelligence", "marketing", "reports"],
  showSettings: true,
  visibleSettingsIds: SETTINGS_SECTIONS.map((s) => s.id),
});
assert.equal(everything.length, TOUR_STOPS.length, "an admin with every page sees every stop");

const bare = tourStopsFor({ isAdmin: false, visibleNavKeys: [], showSettings: false, visibleSettingsIds: [] });
assert.ok(bare.length > 0, "someone with no pages still gets the welcome and wrap-up");
assert.ok(bare.every((s) => !s.navKey && !s.settingsId && !s.requiresSettingsLink && !s.adminOnly));
assert.ok(bare.some((s) => s.id === "topbar") && bare.some((s) => s.id === "finale"));

const receptionist = tourStopsFor({
  isAdmin: false,
  visibleNavKeys: ["chats", "patients", "appointments", "leads"],
  showSettings: false,
  visibleSettingsIds: ["general", "interface", "recently_deleted"],
});
assert.ok(receptionist.some((s) => s.id === "patients"));
assert.ok(!receptionist.some((s) => s.id === "finance"), "a hidden page is not toured");
assert.ok(!receptionist.some((s) => s.id === "settings"), "no gear, no settings chapter intro");
assert.ok(!receptionist.some((s) => s.id === "settings-users"), "a section they cannot open is not toured");
assert.ok(receptionist.some((s) => s.id === "settings-general"), "a section they can open is");

// Chapters follow the stops: no gear → no settings chapter.
const chaptersForReceptionist = tourChaptersFor(receptionist);
assert.ok(chaptersForReceptionist.some((c) => c.id === "frontdesk"));
assert.ok(!chaptersForReceptionist.some((c) => c.id === "settings") || receptionist.some((s) => s.chapter === "settings"));

// Minutes: never a silly number.
assert.ok(tourMinutes([]) >= 3);
{
  const plain = TOUR_STOPS.filter((s) => !s.handsOn);
  assert.equal(tourMinutes(plain), Math.max(3, Math.round((plain.length * 20) / 60)));
  const withHands = TOUR_STOPS.filter((s) => s.handsOn);
  assert.ok(tourMinutes(withHands) >= withHands.length * 2, "a hands-on moment counts for about two minutes");
}

console.log(`grandTour: ${TOUR_STOPS.length} stops in ${TOUR_CHAPTERS.length} chapters — all checks passed.`);
