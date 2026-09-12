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
import {
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
assert.ok(tourMinutes(0) >= 3);
assert.equal(tourMinutes(60), 20);

console.log(`grandTour: ${TOUR_STOPS.length} stops in ${TOUR_CHAPTERS.length} chapters — all checks passed.`);
