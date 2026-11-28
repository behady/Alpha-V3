/**
 * Usage tracking: the pure half (src/lib/usage.ts), plus the wiring that must not drift.
 *
 *   npx tsx tests/usage.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_PAGES,
  RETENTION_DAYS,
  buildUsageReport,
  dayMinus,
  formatDuration,
  isEmptyBeat,
  linkTargetFor,
  pageKeyFor,
  pageLabel,
  sanitizeBeat,
  targetKey,
  usageDay,
  type UsageDoc,
} from "../src/lib/usage";

let checks = 0;
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks += 1; };
const ok = (v: unknown, msg: string) => { assert.ok(v, msg); checks += 1; };

// --- 1. A screen is its route, never somebody's id ------------------------------------------
eq(pageKeyFor("/"), "home", "the home screen with no view");
eq(pageKeyFor("/", { homeView: "owner" }), "home#owner", "the home screen names its view");
eq(pageKeyFor("/patients"), "/patients", "a plain route is itself");
eq(pageKeyFor("/patients/AbCdEf123456GhIjKl78"), "/patients/:id", "a Firestore id is cut out");
eq(pageKeyFor("/patients/aB3dE9xZ"), "/patients/:id", "a short generated id is cut out too");
eq(pageKeyFor("/chats/201000000117"), "/chats/:id", "a phone number is cut out");
eq(pageKeyFor("/finance/recovery"), "/finance/recovery", "two words stay two words");
eq(pageKeyFor("/settings/price-lists"), "/settings/price-lists", "a dashed section name is not an id");
eq(pageKeyFor("/reports?tab=clinic"), "/reports", "the query string is not part of the path");
eq(pageKeyFor("/reports", { tab: "clinic" }), "/reports#clinic", "a tab is kept beside the route");
eq(pageKeyFor("/chats", { tab: "201000000117" }), "/chats", "an id in ?tab= is dropped, not stored");
ok(!pageKeyFor("/a.b/c").includes("."), "no dots: they would split a Firestore field path");

eq(linkTargetFor("/patients/AbCdEf123456GhIjKl78"), "go:/patients/:id", "a link is named by where it goes, id removed");
eq(linkTargetFor("https://wa.me/201000000117"), null, "an outside link (a patient's WhatsApp) is not stored");
eq(linkTargetFor("//evil.example"), null, "a protocol-relative link is an outside link");
eq(targetKey("nav-patients"), "nav-patients", "a data-tour id survives");
ok(targetKey("x".repeat(200)).length <= 48, "a control name is bounded");

// --- 2. The server trusts no number the browser sends ---------------------------------------
{
  const beat = sanitizeBeat({
    pages: {
      "/patients/AbCdEf123456GhIjKl78": { sec: 40.9, opens: 2, taps: 11, phoneSec: 999 },
      "home#owner": { sec: 20, opens: 1, taps: 3 },
      "/reports#clinic": { sec: 100000, opens: -5, taps: "7" },
      "/empty": { sec: 0, opens: 0, taps: 0 },
    },
    hits: {
      "/patients/AbCdEf123456GhIjKl78": { "nav-patients": 3, "tab:overview": 2, "": 9, bad: "x" },
    },
  });
  eq(Object.keys(beat.pages).sort(), ["/patients/:id", "/reports#clinic", "home#owner"], "ids are cut out server-side too, and empty screens dropped");
  eq(beat.pages["/patients/:id"], { sec: 40, opens: 2, taps: 11, phoneSec: 40 }, "seconds are whole, and phone time cannot exceed the time");
  eq(beat.pages["/reports#clinic"].sec, 120, "one beat cannot add more than three minutes in all");
  eq(beat.pages["/reports#clinic"].opens, 0, "a negative count is nothing");
  eq(beat.pages["/reports#clinic"].taps, 7, "a numeric string is read as its number");
  eq(beat.hits["/patients/:id"], { "nav-patients": 3, "tab:overview": 2 }, "presses follow their screen; nameless and non-numeric ones are dropped");
  ok(isEmptyBeat(sanitizeBeat(null)) && isEmptyBeat(sanitizeBeat({ pages: "x" })), "garbage is an empty beat, not a crash");
  const many: Record<string, unknown> = {};
  for (let i = 0; i < 80; i++) many[`/p${i}x`] = { sec: 1, opens: 1, taps: 1 };
  ok(Object.keys(sanitizeBeat({ pages: many }).pages).length <= 30, "a beat names at most thirty screens");
}

// --- 3. Days are Cairo days, and the cut-off is two months -----------------------------------
eq(usageDay(new Date("2026-11-27T22:30:00Z")), "2026-11-28", "00:30 in Cairo is already the next day");
eq(dayMinus("2026-11-28", RETENTION_DAYS), "2026-09-27", "the cleanup's cut-off");
ok(RETENTION_DAYS >= 60 && RETENTION_DAYS <= 62, "detail is kept two months, as the owner asked");

// --- 4. The report ---------------------------------------------------------------------------
{
  const docs: UsageDoc[] = [
    { clinicId: "c1", uid: "u1", name: "Dr Ahmed", email: "a@x.com", role: "Dentist", day: "2026-11-27",
      pages: { "/patients/:id": { sec: 3600, opens: 10, taps: 200, phoneSec: 600 }, "home#chair": { sec: 600, opens: 4, taps: 30 } },
      hits: { "/patients/:id": { "tab:treatment": 40, "go:/patients": 5 } } },
    { clinicId: "c1", uid: "u1", name: "Dr Ahmed R.", email: "a@x.com", role: "Dentist", day: "2026-11-28",
      pages: { "/patients/:id": { sec: 7200, opens: 12, taps: 300 } },
      hits: { "/patients/:id": { "tab:treatment": 10 } } },
    { clinicId: "c1", uid: "u2", name: "Mona", role: "Receptionist", day: "2026-11-28",
      pages: { "home#desk": { sec: 9000, opens: 30, taps: 900 }, "/patients/:id": { sec: 60, opens: 1, taps: 4 } } },
    { clinicId: "c2", uid: "u1", name: "Dr Ahmed", role: "Admin", day: "2026-11-28", pages: { "/finance": { sec: 30, opens: 1, taps: 2 } } },
  ];
  const r = buildUsageReport(docs);
  eq(r.people.length, 3, "the same account in two clinics is two rows");
  eq(r.people.map((p) => p.name), ["Dr Ahmed R.", "Mona", "Dr Ahmed"], "most active first, and the newest name wins");
  const ahmed = r.people[0];
  eq([ahmed.sec, ahmed.taps, ahmed.opens, ahmed.daysActive, ahmed.lastDay], [11400, 530, 26, 2, "2026-11-28"], "a person's days add up");
  eq(ahmed.pages[0].key, "/patients/:id", "their most used screen leads");
  eq(ahmed.pages[0].hits[0], { target: "tab:treatment", count: 50 }, "and what they pressed there, most pressed first");
  eq(r.pages[0].key, "/patients/:id", "screens are ranked by time across everyone");
  eq([r.pages[0].sec, r.pages[0].people], [10860, 2], "a screen's time and how many people it had");

  // The monthly summary reads the same way, with its active days.
  const m = buildUsageReport([
    { clinicId: "c1", uid: "u1", name: "Dr Ahmed", month: "2026-09", days: { "3": true, "17": true, "18": true }, pages: { "/lab": { sec: 500, opens: 5, taps: 50 } } },
  ]);
  eq([m.people[0].daysActive, m.people[0].lastDay, m.people[0].sec], [3, "2026-09-18", 500], "a month document carries its days");
  eq(buildUsageReport([]).people.length, 0, "no documents, no rows");
}

eq([formatDuration(40), formatDuration(840), formatDuration(11520)], ["40s", "14m", "3h 12m"], "time reads the way a person says it");
eq(pageLabel("/patients/:id"), "Patient file", "a screen has a name");
eq(pageLabel("/reports#clinic"), "Reports · clinic", "a tab is shown beside its screen");
eq(pageLabel("/settings/price-lists"), "/settings/price-lists", "an unlisted screen shows its path");
ok(KNOWN_PAGES.every((p) => !p.key.includes(".")), "no listed screen has a dot in its key");

// --- 5. Wiring that must not drift ------------------------------------------------------------
{
  const REPO = join(import.meta.dirname, "..");
  const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
  const tracker = read("src/components/usage/UsageTracker.tsx");
  ok(!/textContent/.test(tracker.replace(/tab\.textContent/g, "")), "the tracker reads the text of a tab and of nothing else (rows carry patient names)");
  ok(tracker.includes("clinicRoles?.[clinicId]"), "a superadmin visiting a clinic is not counted as its staff");
  ok(read("src/app/(dashboard)/layout.tsx").includes("<UsageTracker />"), "the tracker is mounted in the dashboard layout");
  const beat = read("src/app/api/usage/beat/route.ts");
  ok(beat.includes("verifyIdToken") && beat.includes("sanitizeBeat(") && !/body\??\.(uid|name|email|role)/.test(beat), "who is taken from the token and profile, never the body");
  ok(beat.includes("clinicRoles") && beat.includes('status: 200'), "no role in the clinic, nothing kept; and it never fails loudly");
  const report = read("src/app/api/admin/usage/route.ts");
  ok(report.includes("requireSuperAdmin("), "the report is superadmin-only");
  const cleanup = read("src/app/api/automation/usage-cleanup/route.ts");
  ok(cleanup.includes("DAILY_COLLECTION") && !cleanup.includes("MONTHLY_COLLECTION"), "the cleanup deletes day detail and never the monthly summary");
  ok(read("vercel.json").includes("/api/automation/usage-cleanup"), "the cleanup is scheduled");
  const rules = read("firestore.rules");
  ok(!rules.includes("usage_daily") && !rules.includes("usage_monthly"), "no browser may read or write the usage collections");
}

console.log(`usage: ${checks} checks passed`);
