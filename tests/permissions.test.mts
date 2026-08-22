// Permission catalogue integrity + drift checks. Run with tsx so the TS catalogue loads directly.
//
// Three failure modes this guards against, all of which have bitten this app:
//
//   1. A malformed or duplicated permission id in the catalogue. The id IS the storage key on the
//      user document, so a typo is not a cosmetic problem — it silently grants nothing.
//
//   2. A permission the code enforces but the catalogue does not offer. `dashboard.view` was
//      exactly this: three AI pages gate on it and two signup routes seed it, but it was absent
//      from PERMISSIONS_CATALOG, so no Clinic Admin could ever grant it to someone who did not
//      receive it at signup, or take it away from someone who did. The screen that manages access
//      simply had no checkbox for it.
//
//   3. firestore.rules losing an entry from the blanket-write exclusion chain. Rules OR together,
//      so a collection that drops out of that chain silently becomes writable by every clinic
//      member no matter what the narrower `match` block below it says. That is invisible in review
//      and catastrophic for `ledger`.
//
// No emulator needed — this reads the catalogue and the rules file as text.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PERMISSIONS_CATALOG, getAllPermissionIds } from "../src/config/permissionsCatalog";

const REPO = new URL("..", import.meta.url).pathname;

// --- 1. Catalogue hygiene ---------------------------------------------------------------------

const ids = getAllPermissionIds();

assert.ok(ids.length > 0, "the catalogue must not be empty");

const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.deepEqual(duplicates, [], `duplicate permission ids: ${duplicates.join(", ")}`);

// `settings` (the sidebar link key) is a bare word; everything else is group.action.
const ID_SHAPE = /^[a-z]+(\.[a-z]+)?$/;
for (const id of ids) {
  assert.match(id, ID_SHAPE, `permission id "${id}" is not a valid storage key`);
}

const groupIds = PERMISSIONS_CATALOG.map((g) => g.id);
assert.deepEqual(
  groupIds.filter((g, i) => groupIds.indexOf(g) !== i),
  [],
  "duplicate catalogue group ids"
);
for (const group of PERMISSIONS_CATALOG) {
  assert.ok(group.items.length > 0, `catalogue group "${group.id}" has no items`);
  assert.ok(group.titleEn.trim() && group.titleAr.trim(), `group "${group.id}" is missing a label`);
  for (const item of group.items) {
    assert.ok(item.labelEn.trim() && item.labelAr.trim(), `permission "${item.id}" is missing a label`);
  }
}

// --- 2. Every permission the code enforces must be grantable ----------------------------------

/** Walk src/ collecting .ts/.tsx files. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !full.includes("permissionsCatalog")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The three shapes the app uses to enforce a permission. Deliberately only matches *enforcement*
 * (a gate someone must pass), not the strings the signup routes seed — an unused seeded grant is
 * harmless clutter, whereas an unlisted enforced permission is a door with no key.
 */
const ENFORCEMENT_PATTERNS = [
  /permission=["']([a-z.]+)["']/g,                    // <PermissionGuard permission="access.finance">
  /permissions\?\.includes\(["']([a-z.]+)["']\)/g,    // user?.permissions?.includes("finance.edit")
  /perms\.includes\(["']([a-z.]+)["']\)/g,            // navAccess helpers
];

const enforced = new Map<string, string>(); // permission id → first file that enforces it
for (const file of sourceFiles(join(REPO, "src"))) {
  const text = readFileSync(file, "utf8");
  for (const pattern of ENFORCEMENT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (!enforced.has(match[1])) enforced.set(match[1], file.replace(REPO, ""));
    }
  }
}

assert.ok(enforced.size > 5, "found suspiciously few permission checks — did the patterns drift?");

const catalogue = new Set(ids);
const ungrantable = [...enforced.entries()].filter(([id]) => !catalogue.has(id));
assert.deepEqual(
  ungrantable.map(([id, file]) => `${id} (enforced in ${file})`),
  [],
  "these permissions are enforced in code but absent from PERMISSIONS_CATALOG, so no admin can grant them"
);

// --- 3. firestore.rules blanket-write exclusion chain ------------------------------------------

// Collections that MUST stay out of the "any clinic member may write" grant. Rules OR together,
// so dropping one here re-opens it to every member regardless of the narrower block below it.
//
// Phase 2 of the repair plan adds ledger, clinical_notes, services and ledger_audit to this list;
// until those land, the expectation is today's set.
const MUST_BE_EXCLUDED = [
  "system_logs",
  "staff",
  "settings",
  "ai_deletion_log",
  "ai_pending_actions",
  "message_drafts",
  "sms_outbox",
  "sms_devices",
  "leads",
];

const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");
const excluded = new Set([...rules.matchAll(/subcollection != '([a-z_]+)'/g)].map((m) => m[1]));

assert.ok(excluded.size > 0, "could not find the blanket-write exclusion chain in firestore.rules");

const missing = MUST_BE_EXCLUDED.filter((name) => !excluded.has(name));
assert.deepEqual(
  missing,
  [],
  `these collections lost their exclusion from the blanket member-write grant: ${missing.join(", ")}`
);

// Every excluded collection should also have its own match block spelling out the real rule,
// otherwise it is excluded from the general grant and then matched by nothing at all.
for (const name of MUST_BE_EXCLUDED) {
  assert.ok(
    rules.includes(`match /${name}/{`),
    `"${name}" is excluded from the blanket grant but has no match block of its own`
  );
}

console.log(
  `✓ permissions: ${ids.length} catalogue ids, ${enforced.size} enforced in code, ` +
    `${excluded.size} collections held out of the blanket write grant`
);
