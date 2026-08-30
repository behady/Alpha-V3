// Phase 0 of the settings rebuild: the settings registry against firestore.rules, and the
// contracts the rebuild is not allowed to break.
//
// The settings screen was four hand-maintained lists of the same facts — a `tabs` array and three
// sidebar group filters — with the permission checks scattered through the render. Nothing kept
// them in step, and the three failures below were all invisible in review:
//
//   1. Three sections (`recall`, `recently_deleted`, `ai_credits`) were in the tabs array and in
//      none of the group filters, so on a desktop they could not be reached at all. Recall
//      survived only because two AI pages deep-link to `?tab=recall`.
//
//   2. The Clinic Management group was wrapped in an admin check, so the sections meant to open
//      for a non-admin holding `access.settings` never appeared for one — while the mobile
//      dropdown and a typed `?tab=` still let them in.
//
//   3. Prices was gated on `access.settings`, which firestore.rules accepts for nothing that
//      screen writes: `services` is excluded from the blanket member-write grant and its own
//      block is Admin-only, and price lists and discounts are settings documents, also
//      Admin-only. The grant opened a screen on which every save was rejected.
//
// The registry is now the single source, and this file is what stops it drifting from the
// database. `edit` in the registry is a claim about firestore.rules; every one is re-derived from
// the rules text here, so the two cannot disagree quietly.
//
// No emulator needed — this reads the registry and the rules file as text.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
  settingsDocIds,
  type SettingsAccess,
  type SettingsSection,
} from "../src/config/settingsRegistry";
import { getAllPermissionIds } from "../src/config/permissionsCatalog";

// fileURLToPath, not .pathname: on Windows the latter yields "/C:/Users/..." and every join()
// below then builds "C:\C:\Users\...".
const REPO = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY_REL = join("src", "config", "settingsRegistry.ts");
const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}

// --- reading firestore.rules -------------------------------------------------------------------

/**
 * The body of a `match /<path> {` block, up to its closing brace.
 *
 * Brace-counted rather than regexed to the next `}`: several of these blocks contain nested
 * `match` blocks and function calls with braces in them, and a lazy match reads only the first
 * few lines — which is how a rule can look permissive in a test and be strict in production.
 */
function matchBlock(path: string): string | null {
  const needle = `match /${path} {`;
  const start = rules.indexOf(needle);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + needle.length - 1; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    else if (rules[i] === "}") {
      depth--;
      if (depth === 0) return rules.slice(start, i + 1);
    }
  }
  return null;
}

/** Comments carry the words we look for ('admin only', permission names), so strip them first. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

type RulesVerdict =
  | { kind: "admin" }
  | { kind: "member" }
  | { kind: "permission"; id: string }
  | { kind: "serverOnly" }
  | { kind: "conditional" };

/**
 * What a block's write rules actually require of a browser client.
 *
 * isSuperAdmin() is ignored throughout: it is a platform-operator escape hatch present on every
 * block, and treating it as a grant would make every rule read as "anyone".
 */
function writeVerdict(block: string): RulesVerdict {
  const body = stripComments(block);
  const clauses = [...body.matchAll(/allow\s+([a-z,\s]*?)\s*:\s*if([\s\S]*?);/g)]
    .filter((m) => /write|create|update/.test(m[1]))
    .map((m) => m[2]);

  if (clauses.length === 0) return { kind: "conditional" };

  // Take the broadest grant across the clauses: rules OR together, so the loosest one is what a
  // client actually gets. This is the same reasoning as the blanket-write exclusion chain.
  let broadest: RulesVerdict = { kind: "serverOnly" };
  const rank = { serverOnly: 0, conditional: 1, admin: 2, permission: 3, member: 4 } as const;

  for (const clause of clauses) {
    let verdict: RulesVerdict;
    const perm = clause.match(/holdsPermission\(\s*clinicId\s*,\s*'([a-z.]+)'\s*\)/);
    if (perm) verdict = { kind: "permission", id: perm[1] };
    else if (/isClinicAdmin\(/.test(clause)) verdict = { kind: "admin" };
    else if (/^\s*false\s*$/.test(clause)) verdict = { kind: "serverOnly" };
    // A clause that narrows to one person's own row (`request.auth.uid`) plus a field allow-list
    // is not a general member grant — it is the self-edit carve-out, handled separately.
    else if (/affectedKeys\(\)|request\.auth\.uid/.test(clause)) verdict = { kind: "conditional" };
    else if (/hasClinicRole\(/.test(clause)) verdict = { kind: "member" };
    else verdict = { kind: "conditional" };

    if (rank[verdict.kind] > rank[broadest.kind]) broadest = verdict;
  }
  return broadest;
}

/** Collections held out of the "any clinic member may write" grant, read from the rules. */
const memberWriteExclusions = new Set(
  [...(stripComments(rules).match(/function memberMayWrite[\s\S]*?\n    }/)?.[0] ?? "")
    .matchAll(/sub\s*!=\s*'([a-z_]+)'/g)].map((m) => m[1])
);
ok(
  memberWriteExclusions.size > 0,
  "could not read memberMayWrite()'s exclusion chain out of firestore.rules"
);

/** The collection→permission map the blanket grant consults for updates. */
function permUpdateMap(): Record<string, string> {
  const body = rules.slice(rules.indexOf("function permUpdate(sub)"));
  const block = body.slice(0, body.indexOf("}.get(sub, null)"));
  return Object.fromEntries(
    [...block.matchAll(/'([a-z_]+)':\s*'([a-z.]+)'/g)].map((m) => [m[1], m[2]])
  );
}
const permUpdate = permUpdateMap();

/** What firestore.rules requires to write `clinics/{id}/settings/<docId>`. */
function settingsDocVerdict(docId: string): RulesVerdict {
  // A literal carve-out wins over the wildcard — `settings/counters` is the live example, widened
  // to `patients.add` because minting a patient file number is not a settings change.
  const literal = matchBlock(`settings/${docId}`);
  if (literal) return writeVerdict(literal);
  const wildcard = matchBlock("settings/{docId}");
  ok(wildcard, "firestore.rules has no match block for settings/{docId}");
  return writeVerdict(wildcard!);
}

/** What firestore.rules requires to write `clinics/{id}/<collection>/*`. */
function collectionVerdict(name: string): RulesVerdict {
  // Excluded from the blanket grant → the collection's own block is the whole story.
  if (memberWriteExclusions.has(name)) {
    const own = matchBlock(`${name}/{`) ?? findOwnBlock(name);
    ok(own, `${name} is excluded from memberMayWrite() but has no match block of its own`);
    return writeVerdict(own!);
  }
  // Not excluded → the blanket grant reaches it, and its permission map entry is what applies.
  const mapped = permUpdate[name];
  return mapped ? { kind: "permission", id: mapped } : { kind: "member" };
}

/** `match /drugs/{drugId} {` — the wildcard name varies, so find the block by its collection. */
function findOwnBlock(name: string): string | null {
  const m = rules.match(new RegExp(`match /${name}/\\{[A-Za-z]+\\} \\{`));
  if (!m) return null;
  return matchBlock(m[0].slice("match /".length, -" {".length));
}

/**
 * What firestore.rules requires to write a ROOT collection.
 *
 * `getClinicCollection("join_requests")` looks clinic-scoped at the call site and is not: three
 * names are global and quietly resolve to the root. Reading the clinic-scoped rule for one of
 * them tests a block that never governs the write — this check pointed at the blanket clinic
 * grant on its first run and reported an admin-only rule as member-writable.
 */
function rootCollectionVerdict(name: string): RulesVerdict {
  const block = findOwnBlock(name);
  ok(block, `firestore.rules has no root-level match block for ${name}`);
  return writeVerdict(block!);
}

/**
 * The global-collection list, read from db-utils. If a name joins or leaves it, the rule that
 * governs every write to it changes location, and the registry has to move with it.
 */
const globalCollections = new Set(
  [...readFileSync(join(REPO, "src/lib/db-utils.ts"), "utf8")
    .matchAll(/path === '([a-z_]+)'/g)].map((m) => m[1])
);
ok(globalCollections.size > 0, "could not read the global-collection list out of db-utils.ts");

function describe(v: RulesVerdict | SettingsAccess): string {
  return v.kind === "permission" ? `permission:${v.id}` : v.kind;
}

// --- 1. Every section's `edit` matches what the database will actually accept -------------------
//
// This is the check that would have caught the Prices section. It claimed `access.settings`; the
// rules say Admin for all three of its targets, so every save was rejected after the work was done.

for (const section of SETTINGS_SECTIONS) {
  for (const target of section.writes) {
    // A clinic-scoped name that db-utils actually resolves to the root is the trap this guards:
    // the registry would name the right collection and the test would read the wrong rule.
    if (target.kind === "collection") {
      ok(
        !globalCollections.has(target.name),
        `"${section.id}" declares ${target.name} as clinic-scoped, but db-utils.ts resolves it to ` +
          `the ROOT collection. Declare it as a rootCollection or the wrong rule is checked.`
      );
    }
    if (target.kind === "rootCollection") {
      ok(
        globalCollections.has(target.name),
        `"${section.id}" declares ${target.name} as a root collection, but db-utils.ts scopes it ` +
          `to the clinic`
      );
    }

    if (
      target.kind === "settingsDoc" ||
      target.kind === "collection" ||
      target.kind === "rootCollection"
    ) {
      const verdict =
        target.kind === "settingsDoc"
          ? settingsDocVerdict(target.docId)
          : target.kind === "rootCollection"
            ? rootCollectionVerdict(target.name)
            : collectionVerdict(target.name);
      const where =
        target.kind === "settingsDoc" ? `settings/${target.docId}` : `${target.name}/*`;

      ok(
        verdict.kind !== "serverOnly",
        `"${section.id}" declares it writes ${where}, but firestore.rules denies every client ` +
          `write there. Either it is a read-only screen, or the write goes through an API route ` +
          `and should be declared as a server target.`
      );

      assert.equal(
        describe(verdict),
        describe(section.edit),
        `"${section.id}" says edit=${describe(section.edit)}, but firestore.rules requires ` +
          `${describe(verdict)} to write ${where}. The screen and the database must agree — ` +
          `whichever is wrong, fix that one, do not loosen this assertion.`
      );
    }
  }
}

// --- 2. A grant nobody can reach is not a grant -------------------------------------------------
//
// Finding 2 above: `view` stricter than `edit` means the person who was granted the permission
// cannot open the screen the permission is for. That is exactly what the admin-wrapped sidebar
// group did to `access.settings`.

const strictness: Record<SettingsAccess["kind"], number> = {
  member: 0,
  self: 1,
  permission: 2,
  admin: 3,
};

for (const section of SETTINGS_SECTIONS) {
  ok(
    strictness[section.view.kind] <= strictness[section.edit.kind],
    `"${section.id}" is harder to open (${describe(section.view)}) than it is to save ` +
      `(${describe(section.edit)}). Whoever holds the grant can never use it.`
  );

  if (section.edit.kind === "permission") {
    assert.equal(
      section.view.kind,
      "permission",
      `"${section.id}" is saveable by a permission holder, so it must also be VISIBLE to one. ` +
        `If the sidebar puts it in an admin-only group, the permission grants nothing on desktop.`
    );
  }
}

// --- 3. Every permission named must be one an admin can actually grant --------------------------

const catalogue = new Set(getAllPermissionIds());
for (const section of SETTINGS_SECTIONS) {
  for (const access of [section.view, section.edit]) {
    if (access.kind === "permission") {
      ok(
        catalogue.has(access.id),
        `"${section.id}" names permission "${access.id}", which is not in PERMISSIONS_CATALOG — ` +
          `so no Clinic Admin has a checkbox for it and nobody can ever be granted it.`
      );
    }
  }
}

// --- 4. No section is unreachable, and no group is empty ----------------------------------------
//
// Finding 1 above. The registry is the only list now, so an orphan can only happen if a group is
// named that the sidebar does not render.

const ids = SETTINGS_SECTIONS.map((s) => s.id);
assert.deepEqual(
  ids.filter((id, i) => ids.indexOf(id) !== i),
  [],
  "duplicate section ids in the registry"
);

const routes = SETTINGS_SECTIONS.map((s) => s.route);
assert.deepEqual(
  routes.filter((r, i) => routes.indexOf(r) !== i),
  [],
  "two sections claim the same route"
);

for (const section of SETTINGS_SECTIONS) {
  ok(
    SETTINGS_GROUP_ORDER.includes(section.group),
    `"${section.id}" is in group "${section.group}", which the sidebar never renders — the ` +
      `section would exist and be unreachable, which is the bug this registry replaced.`
  );
  ok(
    section.route.startsWith("/settings/"),
    `"${section.id}" has route "${section.route}"; every section must live under /settings/`
  );
}

for (const group of SETTINGS_GROUP_ORDER) {
  ok(
    SETTINGS_SECTIONS.some((s) => s.group === group),
    `sidebar group "${group}" has no sections — it will render as an empty heading`
  );
}

// --- 5. The contracts the rebuild may not break -------------------------------------------------
//
// Five things outside the settings screen reach into it. Each breaks silently: no error, just a
// dead link or a tutorial ring pointing at nothing.

// (a) Every tab id the old screen answered to. `?tab=<id>` must still resolve after Phase 1,
//     whether by redirect or by keeping the id. Frozen here rather than read from the page,
//     because the page is what Phase 1 deletes.
const FROZEN_TAB_IDS = [
  "general", "attendance", "clinical", "locations", "labs", "recall", "prescriptions",
  "services", "users", "join_requests", "recently_deleted", "logs", "ai_credits",
  "notifications", "whatsapp", "sms", "appearance", "interface", "online_booking",
  "sources", "visit_reasons",
];

for (const tab of FROZEN_TAB_IDS) {
  ok(
    SETTINGS_SECTIONS.some((s) => s.id === tab),
    `?tab=${tab} used to open a settings screen and the registry has no section with that id. ` +
      `Either keep the id or add the redirect — dropping it is a dead link somewhere.`
  );
}

// (b) While the old page still exists, it must not grow a tab the registry has not heard of.
//     This retires itself when Phase 1 deletes the file.
const legacyPage = join(REPO, "src/app/(dashboard)/settings/page.tsx");
if (existsSync(legacyPage)) {
  const source = readFileSync(legacyPage, "utf8");
  const tabsArray = source.slice(source.indexOf("const tabs = ["));
  const live = [...tabsArray.slice(0, tabsArray.indexOf("\n  ];")).matchAll(/\{\s*id:\s*"([a-z_]+)"/g)]
    .map((m) => m[1]);
  ok(live.length > 0, "could not read the tabs array out of the legacy settings page");
  for (const tab of live) {
    ok(
      SETTINGS_SECTIONS.some((s) => s.id === tab),
      `the legacy settings page has a tab "${tab}" that is not in the registry — it will be ` +
        `dropped by the rebuild without anyone noticing`
    );
  }
}

// (c) The tutorial's pulsing ring attaches to these exact strings. Renaming one leaves the
//     walkthrough highlighting nothing, mid-lesson, with no error.
const tutorials = readFileSync(join(REPO, "src/lib/tutorials.ts"), "utf8");
for (const anchor of [...tutorials.matchAll(/anchor:\s*"(settings-[a-z-]+)"/g)].map((m) => m[1])) {
  ok(
    SETTINGS_SECTIONS.some((s) => s.tourAnchor === anchor),
    `tutorials.ts points its ring at "${anchor}", which no section in the registry claims`
  );
}

// (d) /settings/clinic is on the assistant's allowed-routes list. Move it and the assistant
//     announces it is opening the clinic profile and pushes a 404.
const aiNav = readFileSync(join(REPO, "src/lib/aiNavigation.ts"), "utf8");
for (const route of [...aiNav.matchAll(/"(\/settings\/[a-z-]+)"/g)].map((m) => m[1])) {
  ok(
    SETTINGS_SECTIONS.some((s) => s.route === route),
    `aiNavigation.ts allows "${route}", which no section in the registry serves — the assistant ` +
      `would navigate somewhere that does not exist`
  );
}

// (e) Every settings document id must still be referenced by the app. Renaming one is silent:
//     ~14 server routes and the Android app read these names directly, and neither goes through
//     this registry.
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && full !== join(REPO, REGISTRY_REL)) {
      out.push(full);
    }
  }
  return out;
}

const appSource = sourceFiles(join(REPO, "src"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

for (const docId of settingsDocIds()) {
  ok(
    docId.length > 0 && !docId.includes("/"),
    `settings document id "${docId}" is not a bare document name`
  );
  // Looked for as a quoted literal, and outside the registry itself — the registry naming a
  // document is not evidence that anything reads or writes it.
  ok(
    appSource.includes(`"${docId}"`) || appSource.includes(`'${docId}'`),
    `no code outside the registry mentions settings document "${docId}". Either it was renamed ` +
      `— which silently breaks the server routes and the Android app that read it directly — or ` +
      `the section that owned it is gone and this entry is stale.`
  );
}

// --- 6. Writes that firestore.rules never sees must name their guard ----------------------------
//
// A server route runs on the Admin SDK and bypasses rules entirely. That is legitimate, but it
// means the only thing standing between a receptionist and a staff deletion is a test. An
// undeclared server target is a hole with a label on it.

for (const section of SETTINGS_SECTIONS) {
  for (const target of section.writes) {
    if (target.kind === "server") {
      ok(
        target.route.startsWith("/api/"),
        `"${section.id}" declares server target "${target.route}", which is not an API route`
      );
      ok(
        existsSync(join(REPO, target.guardedBy)),
        `"${section.id}" says ${target.route} is guarded by ${target.guardedBy}, but that test ` +
          `file does not exist. This write bypasses firestore.rules and nothing checks it.`
      );
    }
    if (target.kind === "device") {
      ok(
        target.note.length > 40,
        `"${section.id}" stores settings in the browser only; the note must say which ones and ` +
          `why, because the person loses them on their next device and nothing tells them`
      );
    }
  }
}

// --- 7. The registry covers the screen ----------------------------------------------------------

const componentsDir = join(REPO, "src/components/settings");
ok(existsSync(componentsDir), "src/components/settings is missing");

ok(
  SETTINGS_SECTIONS.length >= FROZEN_TAB_IDS.length,
  `the registry has ${SETTINGS_SECTIONS.length} sections but ${FROZEN_TAB_IDS.length} tabs were ` +
    `frozen — something was dropped`
);

// Phase 2 collapses these two into one document. Until it does, both must stay declared, because
// the profile screen writes both and ~30 readers consult clinic_info.
const docIds = settingsDocIds();
if (docIds.includes("clinicProfile") && docIds.includes("clinic_info")) {
  const profile = SETTINGS_SECTIONS.find((s) => s.id === "clinic_profile") as SettingsSection;
  ok(
    profile.writes.filter((t) => t.kind === "settingsDoc").length === 2,
    "the clinic profile section must declare BOTH documents while the duplication exists — " +
      "declaring one hides the fact that a save writes the other too"
  );
}

console.log(`settingsRegistry: ${checks} checks passed across ${SETTINGS_SECTIONS.length} sections`);
console.log(`  settings documents guarded: ${docIds.join(", ")}`);
