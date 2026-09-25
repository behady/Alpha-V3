// The notification centre: thirty alerts, one catalogue, and the ways that quietly comes apart.
//
// Every failure this guards is silent by nature. An alert that no longer resolves sends to nobody
// and nothing throws. A call site that stops naming its event goes back to firing whatever the
// clinic has switched off. A catalogue that drifts between the app and the Cloud Functions sends
// the owner's money figure to the front desk. None of that shows up in a build.
//
// The two bugs that motivated the whole thing are pinned first, because both were live for months
// and both looked exactly like nothing being wrong:
//
//   1. The one settings toggle that existed read `clinics/{id}.alertPreferences` while the screen
//      saved `clinics/{id}/settings/clinic_info.alertPreferences`. Two documents. The switch moved,
//      saved, and changed nothing.
//   2. Push targeting filtered `clinics/{id}/staff` by its `role` field, but signup writes the
//      owner's role to `users.clinicRoles` and `clinics/{id}.ownerId` and creates no staff row at
//      all — so every alert addressed to the owner reached nobody at any clinic where they had not
//      also been added by hand.
//
// Run with tsx so the TS modules load directly: npm run test:notify
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFY_EVENTS,
  NOTIFY_GROUPS,
  NOTIFY_ROLES,
  inQuietHours,
  isMutedFor,
  mutedEventsFor,
  notifyEvent,
  notifyEventsIn,
  notifyTiming,
  pushAllowedNow,
  resolveNotify,
  withMute,
  type NotifyEvent,
} from "../src/lib/notificationCatalog";
import { expectedCatalogModule, CATALOG_TARGET_PATH } from "../scripts/generate-functions-notification-catalog.mjs";

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

const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

// --- 1. The catalogue is internally coherent ---------------------------------------------------
{
  const ids = new Set<string>();
  for (const e of NOTIFY_EVENTS) {
    ok(!ids.has(e.id), `two alerts share the id "${e.id}" — ids are storage keys, so one would overwrite the other`);
    ids.add(e.id);
    ok(/^[a-z][A-Za-z]+$/.test(e.id), `"${e.id}" is not a plain camelCase id; it ends up in Firestore field names`);
    ok(e.en.trim() && e.ar.trim(), `"${e.id}" is missing a label in one language`);
    ok(e.whenEn.trim() && e.whenAr.trim(), `"${e.id}" does not say what triggers it, in one language`);
    ok(e.roles.length > 0, `"${e.id}" is addressed to nobody, so it can never be delivered`);
    ok(
      e.roles.every((r) => NOTIFY_ROLES.includes(r)),
      `"${e.id}" names a role that does not exist — it would match no staff row`
    );
    ok(
      NOTIFY_GROUPS.some((g) => g.id === e.group),
      `"${e.id}" is in group "${e.group}", which the settings page has no heading for — the row would not render`
    );
    if (e.rolesMax) {
      ok(
        e.roles.every((r) => e.rolesMax!.includes(r)),
        `"${e.id}" has a default audience wider than its own ceiling, so its default is unreachable`
      );
    }
    for (const t of e.timings || []) {
      ok(t.min <= t.fallback && t.fallback <= t.max, `"${e.id}".${t.key} has a default outside its own range`);
      ok(t.en.trim() && t.ar.trim(), `"${e.id}".${t.key} has no label in one language`);
      if (t.kind === "hourOfDay") eq([t.min, t.max], [0, 23], `"${e.id}".${t.key} is an hour but not 0–23`);
    }
  }
  ok(NOTIFY_EVENTS.length >= 25, "the catalogue has shrunk — an alert removed here still fires, it just cannot be turned off");
  for (const g of NOTIFY_GROUPS) {
    ok(notifyEventsIn(g.id).length > 0, `group "${g.id}" is empty and would render as a heading with nothing under it`);
  }
}

// --- 2. Every alert the code raises exists, and every alert that exists is raised --------------
//
// The expensive half of this feature is the promise that the page lists what the clinic will
// actually be told. Both directions break it: a row for an alert nothing sends is a lie, and an
// alert with no row is the state this replaced.
{
  const SOURCES = [
    "functions/pushPhase1.js",
    "functions/handoffSla.js",
    "functions/marketingAutomations.js",
    "functions/metaLeads.js",
    "src/lib/bot/respond.ts",
    "src/lib/patientNotifications.ts",
    "src/lib/labNotify.ts",
    "src/app/api/public/book/route.ts",
    "src/app/api/public/review/route.ts",
    "src/app/api/whatsapp/send-patient-message/route.ts",
    "src/app/api/automation/reminders/route.ts",
  ];
  const raised = new Set<string>();
  for (const rel of SOURCES) {
    const text = read(rel);
    for (const m of text.matchAll(/event:\s*"([a-zA-Z]+)"/g)) raised.add(m[1]);
    // The escalation picks its event with a ternary, so both arms have to be counted.
    for (const m of text.matchAll(/\?\s*"([a-zA-Z]+)"\s*:\s*"([a-zA-Z]+)"/g)) {
      if (notifyEvent(m[1])) raised.add(m[1]);
      if (notifyEvent(m[2])) raised.add(m[2]);
    }
    // labNotify names its id through a constant.
    for (const m of text.matchAll(/LAB_READY_EVENT = "([a-zA-Z]+)"/g)) raised.add(m[1]);
  }

  for (const id of raised) {
    ok(notifyEvent(id), `something sends "${id}", which is not in the catalogue — it cannot be switched off or seen`);
  }
  for (const e of NOTIFY_EVENTS) {
    ok(raised.has(e.id), `"${e.id}" has a row on the settings page but nothing sends it — the page would be lying`);
  }
  ok(raised.size >= NOTIFY_EVENTS.length, "fewer alerts are raised than catalogued");
}

// --- 3. No send bypasses the gate --------------------------------------------------------------
//
// `roles:` at a call site means the audience is decided there, which is the arrangement this
// feature exists to end: the clinic's answer is not consulted, no bell row is written, and the
// per-person mutes do nothing. The two push helpers still accept it for an uncatalogued alert,
// and nothing in the app may use it.
{
  const CALLERS = [
    "functions/pushPhase1.js",
    "functions/handoffSla.js",
    "functions/marketingAutomations.js",
    "functions/metaLeads.js",
    "src/lib/bot/respond.ts",
    "src/app/api/public/book/route.ts",
    "src/app/api/public/review/route.ts",
  ];
  for (const rel of CALLERS) {
    ok(
      !/roles:\s*\[/.test(read(rel)),
      `${rel} still names roles at a call site — that send skips the clinic's settings, the bell and every personal mute`
    );
  }
}

// --- 4. The arrival bug: everything reads the document the page writes -------------------------
{
  const page = read("src/components/settings/hosts/ClinicInfoHost.tsx");
  ok(
    page.includes('getClinicDoc("settings", "clinic_info")'),
    "the settings host no longer saves to settings/clinic_info — every reader below is now pointed at the wrong document"
  );
  for (const rel of ["src/lib/notificationDelivery.ts", "functions/clinicPush.js"]) {
    const text = read(rel);
    ok(
      text.includes("settings/clinic_info") || text.includes('"settings", "clinic_info"'),
      `${rel} does not read settings/clinic_info — this is exactly how the arrival toggle came to do nothing`
    );
    ok(
      !/collection\("clinics"\)\s*\.doc\([^)]*\)\s*\.get\(\)[\s\S]{0,120}alertPreferences/.test(text),
      `${rel} reads alertPreferences off the clinic document again, which is the original bug`
    );
  }
}

// --- 5. The owner bug: targeting can see somebody with no staff row ---------------------------
{
  for (const rel of ["src/lib/notificationDelivery.ts", "functions/clinicPush.js"]) {
    const text = read(rel);
    ok(
      text.includes("ownerId"),
      `${rel} does not look at clinics/{id}.ownerId — an owner with no staff row is unreachable again`
    );
    ok(
      /ownerCountsAsAdmin/.test(text),
      `${rel} no longer treats the owner as an admin for addressing; an alert sent to "Admin" would skip them`
    );
  }
}

// --- 6. Resolution: the clinic's answer, then the old answer, then the default ------------------
{
  const arrival = notifyEvent("patientArrived")!;
  eq(resolveNotify("patientArrived", {})!.push, arrival.push, "an empty settings object must give the catalogue default");
  eq(
    resolveNotify("patientArrived", { inApp: { patientArrival: false } })!.push,
    false,
    "a clinic that switched arrivals off before this page existed must stay switched off"
  );
  eq(
    resolveNotify("labCaseBack", { inApp: { labReady: true } })!.bell,
    true,
    "a clinic that switched lab alerts on under the old key must stay switched on"
  );
  eq(
    resolveNotify("patientArrived", { events: { patientArrived: { push: true } }, inApp: { patientArrival: false } })!.push,
    true,
    "a new answer must win over the old one, or the page cannot undo a legacy setting"
  );
  eq(resolveNotify("nonsenseEvent", {}), null, "an unknown id must resolve to null rather than a default-shaped object");

  // A fixed audience is part of what the alert is, and a saved role list must not move it.
  eq(
    resolveNotify("patientArrived", { events: { patientArrived: { roles: ["Receptionist"] } } })!.roles,
    ["Dentist"],
    "an arrival must still go to the treating dentist however the roles are saved"
  );
  // A ceiling cannot be raised.
  eq(
    resolveNotify("eveningDigest", { events: { eveningDigest: { roles: ["Owner", "Admin", "Receptionist"] } } })!.roles,
    ["Owner", "Admin"],
    "the money digest must never be addressable to the front desk"
  );
  // "Nobody" is a real answer, not a missing one.
  eq(
    resolveNotify("slotFreed", { events: { slotFreed: { roles: [] } } })!.roles,
    [],
    "an empty saved audience must mean nobody, not fall back to the default"
  );
}

// --- 7. Timings: the clinic's number, clamped, or the number the code used before --------------
{
  eq(notifyTiming("patientWaitingReply", "afterMinutes", {}), 15, "the default wait must still be the old constant");
  eq(notifyTiming("patientWaitingReplyEscalated", "afterMinutes", {}), 45, "the default escalation must still be 45 minutes");
  eq(notifyTiming("leadWaiting", "afterMinutes", {}), 15, "the default lead alert must still be 15 minutes");
  eq(notifyTiming("leadAbandoned", "afterMinutes", {}), 120, "the default lead escalation must still be two hours");
  eq(notifyTiming("eveningDigest", "hour", {}), 21, "the digest must still default to 21:00");
  eq(notifyTiming("morningBriefClinic", "hour", {}), 7, "the morning brief must still default to the 7 o'clock hour");
  eq(notifyTiming("messagesStuck", "stuckHours", {}), 3, "a message must still count as stuck after three hours");

  eq(
    notifyTiming("patientWaitingReply", "afterMinutes", { timings: { patientWaitingReply: { afterMinutes: 9999 } } }),
    240,
    "a number past the maximum must clamp, not become a wait nobody is ever told about"
  );
  eq(
    notifyTiming("patientWaitingReply", "afterMinutes", { timings: { patientWaitingReply: { afterMinutes: 0 } } }),
    2,
    "zero must clamp to the minimum, or the alert fires on every run for every conversation"
  );
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    eq(
      notifyTiming("eveningDigest", "hour", { timings: { eveningDigest: { hour: bad } } }),
      21,
      "an unusable stored number must fall back to the default rather than propagate"
    );
  }
  eq(notifyTiming("slotFreed", "afterMinutes", {}), 0, "asking for a timing an alert does not have must be harmless");
}

// --- 8. Quiet hours silence the buzz and never the record -------------------------------------
{
  const night = { quietHours: { enabled: true, fromHour: 22, toHour: 8 } };
  ok(inQuietHours(night, 23), "22:00–08:00 must include 23:00 — the window wraps midnight");
  ok(inQuietHours(night, 3), "and must include 03:00");
  ok(!inQuietHours(night, 8), "and must end at 08:00 rather than include it");
  ok(!inQuietHours(night, 12), "and must not include the middle of the day");
  const day = { quietHours: { enabled: true, fromHour: 13, toHour: 15 } };
  ok(inQuietHours(day, 14) && !inQuietHours(day, 16), "a window inside one day must work the obvious way");
  ok(!inQuietHours({ quietHours: { enabled: false, fromHour: 22, toHour: 8 } }, 23), "switched off means never quiet");
  ok(!inQuietHours({ quietHours: { enabled: true, fromHour: 9, toHour: 9 } }, 9), "a zero-length window must be off, not always");
  ok(!inQuietHours({}, 3), "a clinic that has never set quiet hours is never quiet");

  ok(
    pushAllowedNow("patientWaitingReply", night, 3),
    "a patient waiting for a reply must buzz at 03:00 — being told late is the same as not being told"
  );
  ok(pushAllowedNow("urgentPatientMessage", night, 3), "a patient in pain must never wait for office hours");
  ok(pushAllowedNow("patientArrived", night, 3), "an arrival is useless once the patient has left");
  ok(pushAllowedNow("aiCreditsOut", night, 3), "the bot being down must not wait until morning");
  ok(!pushAllowedNow("eveningDigest", night, 23), "the money digest must respect quiet hours");
  ok(!pushAllowedNow("birthdayWishesReady", night, 3), "marketing must respect quiet hours");
  ok(
    !pushAllowedNow("eveningDigest", { ...night, events: { eveningDigest: { push: false } } }, 12),
    "an alert switched off must not push even outside quiet hours"
  );

  // Every alert that ignores quiet hours has to be one where lateness is the same as silence.
  const URGENT_BY_DESIGN = new Set([
    "patientWaitingReply",
    "patientWaitingReplyEscalated",
    "patientRepliedAfterClaim",
    "optedOutPatientNeedsReply",
    "urgentPatientMessage",
    "botHandedOff",
    "patientArrived",
    "patientRequestedChange",
    "unhappyReview",
    "aiCreditsOut",
  ]);
  for (const e of NOTIFY_EVENTS) {
    if (e.ignoresQuietHours) {
      ok(
        URGENT_BY_DESIGN.has(e.id),
        `"${e.id}" overrides quiet hours. That list is deliberately short — if this is right, add it to URGENT_BY_DESIGN here and say why`
      );
    }
  }
}

// --- 9. Personal mutes only ever subtract ------------------------------------------------------
{
  const mutes = { "clinic-a": ["eveningDigest", "birthdayWishesReady"], "clinic-b": [] };
  ok(isMutedFor("eveningDigest", mutes, "clinic-a"), "a mute must apply at the clinic it was set for");
  ok(!isMutedFor("eveningDigest", mutes, "clinic-b"), "and must not follow the person to another clinic");
  ok(!isMutedFor("eveningDigest", mutes, null), "with no clinic in hand, nothing is muted");
  eq(mutedEventsFor(undefined, "clinic-a"), [], "a person who has never muted anything must read as an empty list");
  eq(
    mutedEventsFor({ "clinic-a": ["x", 4 as unknown as string, null as unknown as string] }, "clinic-a"),
    ["x"],
    "a hand-edited mute list must be re-validated, not trusted"
  );

  eq(withMute([], "eveningDigest", true), ["eveningDigest"], "muting adds");
  eq(withMute(["eveningDigest"], "eveningDigest", false), [], "unmuting removes");
  eq(withMute(["eveningDigest"], "eveningDigest", true), ["eveningDigest"], "muting twice is one mute");
  eq(withMute(["b", "a"], "c", true), ["a", "b", "c"], "the list stays sorted, or every save looks like a change");

  // The gate must subtract, never add. Both halves check the same thing in the same order.
  for (const rel of ["src/lib/notificationDelivery.ts", "functions/clinicPush.js"]) {
    const text = read(rel);
    ok(text.includes("isMutedFor"), `${rel} does not consult personal mutes, so the switch does nothing`);
    ok(
      /only ever subtract/.test(text),
      `${rel} lost the note saying mutes only subtract — this is the invariant that makes the clinic setting worth anything`
    );
  }
}

// --- 10. The bell is a per-person feed --------------------------------------------------------
{
  const bell = read("src/components/NotificationBell.tsx");
  ok(
    bell.includes('where("audience", "array-contains"'),
    "the bell no longer filters by audience — everyone at the clinic would see the owner's money figure again"
  );
  ok(
    bell.includes("readBy") && bell.includes("arrayUnion"),
    "read state must be per person and written with arrayUnion, or opening the bell hides the badge for the whole clinic"
  );
  ok(
    !/\bread:\s*true\b/.test(bell),
    "the bell writes the old shared `read` boolean again — that was the bug where one reader marked everyone's"
  );
  ok(
    bell.includes("dismissedBy"),
    "dismissing must hide a row for one person; deleting it would take it from everyone it was addressed to"
  );
  ok(!/batch\.delete\(/.test(bell), "the bell deletes rows again — a shared row is not one reader's to destroy");

  for (const rel of ["src/lib/notificationDelivery.ts", "functions/clinicPush.js"]) {
    const text = read(rel);
    ok(text.includes("audience"), `${rel} writes bell rows with no audience, so the bell cannot show them to anybody`);
    ok(text.includes("readBy"), `${rel} writes bell rows with no per-person read list`);
  }

  // Quiet hours must not take the record with them.
  ok(
    /bell row above is already written/.test(read("functions/clinicPush.js")),
    "functions/clinicPush.js lost the note that quiet hours are checked AFTER the bell row — the order is the guarantee"
  );
}

// --- 11. The rules let a person mark their own, and nothing else ------------------------------
{
  const rules = read("firestore.rules");
  ok(
    /sub != 'notifications'/.test(rules),
    "notifications is back inside the blanket write grant — rules OR together, so the narrow block below grants nothing"
  );
  const block = rules.slice(rules.indexOf("match /notifications/{notificationId}"));
  ok(block.length > 0, "there is no notifications rule block at all");
  ok(
    /request\.auth\.uid in resource\.data\.get\('audience'/.test(block),
    "a member may update a row that was never addressed to them"
  );
  ok(
    /hasOnly\(\['readBy', 'dismissedBy'\]\)/.test(block),
    "the update is not limited to the two read/hidden lists — a member could re-address or rewrite an alert"
  );
  ok(/allow create: if isSuperAdmin\(\);/.test(block), "a browser can create notifications — it could forge an alert");
  ok(/allow delete: if isSuperAdmin\(\);/.test(block), "a browser can delete notifications — it could clear a colleague's");
}

// --- 12. The scheduled jobs ask the clinic what hour it wanted --------------------------------
{
  const push = read("functions/pushPhase1.js");
  for (const [name, minute] of [
    ["stuckMessagesAlert", "0"],
    ["morningBrief", "30"],
    ["leadsDueToday", "0"],
    ["eveningDigest", "0"],
  ] as const) {
    const at = push.indexOf(`exports.${name} = onSchedule`);
    ok(at > 0, `${name} has gone from pushPhase1.js`);
    const header = push.slice(at, at + 220);
    ok(
      header.includes(`schedule: "${minute} * * * *"`),
      `${name} is on a fixed daily cron again, so its hour cannot be a setting — expected "${minute} * * * *"`
    );
  }
  ok(
    push.includes("wantsThisHour") && push.includes("notifyTiming"),
    "pushPhase1.js no longer checks the clinic's chosen hour, so every clinic gets every hour"
  );
  ok(
    /morningBriefClinic", "hour"/.test(push) && /morningBriefDentist", "hour"/.test(push),
    "the clinic brief and the dentists' brief must each be able to have their own hour"
  );
  ok(push.includes("notificationsSweep"), "nothing sweeps the feed, so it grows for ever");
  ok(
    read("functions/index.js").includes("exports.notificationsSweep"),
    "the sweeper exists but is not exported, so it is never deployed and never runs"
  );

  const sla = read("functions/handoffSla.js");
  ok(
    !/const STAFF_AFTER_MS/.test(sla) && sla.includes("slaWindows"),
    "the unanswered-patient windows are hard-coded constants again"
  );
  const marketing = read("functions/marketingAutomations.js");
  ok(
    !/const LEAD_ALERT_AFTER_MINUTES\s*=/.test(marketing) && marketing.includes('notifyTiming("leadWaiting"'),
    "the lead windows are hard-coded constants again"
  );
}

// --- 13. Raising an alert from a browser is an allowlist, not a filter ------------------------
{
  const route = read("src/app/api/notifications/raise/route.ts");
  ok(route.includes("CLIENT_RAISABLE"), "the raise route lost its allowlist — any member could send any alert");
  ok(
    /uids: \[staff\.uid\]/.test(route),
    "a test alert must go only to the person who asked for it; a fake 'patient waiting' to the whole team teaches them to ignore the real one"
  );
  ok(route.includes("requireStaffUser"), "the raise route does not prove clinic membership");
  ok(
    /notifyEvent\(eventId\)/.test(route),
    "the raise route does not check the event is real, so it would push arbitrary text"
  );
  // The call, not the word: the file's own comment explains what it used to do with `addDoc`.
  ok(
    !/addDoc\(/.test(read("src/lib/labNotify.ts")),
    "labNotify writes to the notifications collection directly again — that row has no audience and the bell cannot show it"
  );
}

// --- 14. The Cloud Functions copy of the catalogue is the current output ----------------------
//
// The two runtimes cannot share a module, so one is generated from the other. A stale copy is the
// worst possible state: both sides work, and they disagree about who gets told what.
{
  const onDisk = readFileSync(CATALOG_TARGET_PATH, "utf8");
  eq(
    onDisk,
    expectedCatalogModule(),
    "functions/notificationCatalog.js is not the current output of src/lib/notificationCatalog.ts — run: npm run gen:notify-catalog"
  );
  ok(/DO NOT EDIT/.test(onDisk), "the generated copy lost its do-not-edit header, which is the only thing stopping hand edits");
}

// --- 15. Sanity: every group heading is reachable from the page -------------------------------
{
  const page = read("src/components/settings/NotificationSettings.tsx");
  ok(page.includes("NOTIFY_GROUPS.map"), "the settings page no longer renders from the catalogue's groups");
  ok(page.includes("NOTIFY_EVENTS"), "the settings page no longer renders from the catalogue");
  ok(
    !/eventPatientArrival|eventLabReady/.test(page.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the page still hand-lists the two original alerts; it must render every one of them from the catalogue"
  );
  ok(page.includes("notificationMutes"), "the page has no personal-mute section, which was half the point");
  ok(page.includes("quietHours"), "the page has no quiet-hours control");
}

const grouped = NOTIFY_GROUPS.map((g) => `${g.id}:${notifyEventsIn(g.id).length}`).join(" ");
console.log(`notifications: ${checks} checks passed across ${NOTIFY_EVENTS.length} alerts (${grouped})`);

// Keeps the NotifyEvent import honest for readers of this file.
export type { NotifyEvent };
