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
import {
  COLLECTION_WRITE_PERMISSIONS,
  ROLE_BASELINE,
  expandPermissions,
  holdsPermission,
} from "../src/lib/permissions";

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
// `ledger`, `ledger_audit`, `clinical_notes` and `services` joined this list when money writes
// moved behind the API routes: their own match blocks deny the client, and that deny only holds
// while they are also held out of the blanket grant.
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
  "ledger",
  "ledger_audit",
  "clinical_notes",
  "services",
  // Its own block says `allow create, delete: if false`, and that line did nothing at all
  // until this exclusion existed: the blanket grant reached it, so any clinic member could
  // create a WhatsApp message — to any number, in the clinic's name. The browser only ever
  // marks a queued message sent, which the narrow update rule still permits.
  "whatsapp_outbox",
  // The AI credit meter and its spend log. A member who can write these can refill their own
  // clinic's credits and erase the record of what was spent.
  "ai_usage",
  "ai_usage_log",
];

const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");
// The chain has lived under two parameter names: inline as `subcollection` in the
// wildcard block, and as `sub` since it moved into the memberMayWrite() helper. Match
// both — a regex pinned to the old name would quietly find nothing and pass forever,
// which is the exact failure this check exists to prevent.
const excluded = new Set(
  [...rules.matchAll(/\b(?:sub|subcollection) != '([a-z_]+)'/g)].map((m) => m[1])
);

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


// --- 4. A field the rules READ must be a field the code WRITES ----------------------------------

// This is the check that was missing. firestore.rules looked up
// `users/{uid}.clinicPermissions[clinicId]`, the app wrote a flat `users/{uid}.permissions` array,
// and nothing anywhere wrote `clinicPermissions`. A missing map reads as null, `holdsPermission`
// treats null as "not backfilled yet, let them through", and so every permission check in the
// rules passed for everyone, always. It looked exactly like enforcement in review.
//
// Both spellings the rules use to read the caller's user document are matched: the direct chain,
// and the `let userData = get(...).data;` binding.

const USER_DOC_DIRECT = /documents\/users\/\$\(request\.auth\.uid\)\)\.data\s*((?:\.get\('[a-zA-Z]+',[^)]*\)\s*)+)/g;
const USER_DOC_BOUND = /\buserData\.get\('([a-zA-Z]+)'/g;

const readFromUserDoc = new Set<string>();
for (const match of rules.matchAll(USER_DOC_DIRECT)) {
  for (const field of match[1].matchAll(/\.get\('([a-zA-Z]+)'/g)) readFromUserDoc.add(field[1]);
}
for (const match of rules.matchAll(USER_DOC_BOUND)) readFromUserDoc.add(match[1]);

assert.ok(
  readFromUserDoc.has("clinicRoles") && readFromUserDoc.has("clinicPermissions"),
  "the user-document field scan found neither clinicRoles nor clinicPermissions — the pattern has drifted"
);

// Only the Admin SDK may write these: they decide what their holder is allowed to do, so a client
// that could set them would grant itself anything. Server routes and server-side libs only.
const SERVER_WRITE_DIRS = [join(REPO, "src/app/api"), join(REPO, "src/lib/server")];
const serverText = SERVER_WRITE_DIRS.flatMap((dir) => sourceFiles(dir))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const neverWritten = [...readFromUserDoc].filter((field) => !serverText.includes(field));
assert.deepEqual(
  neverWritten,
  [],
  `firestore.rules reads these user-document fields, but no server route or server lib ever writes ` +
    `them — so the rules that consult them decide nothing: ${neverWritten.join(", ")}`
);

// --- 5. The collection→permission maps are duplicated; they must agree ---------------------------

// The maps live in firestore.rules (permCreate/permUpdate/permDelete) and in src/lib/permissions.ts
// (COLLECTION_WRITE_PERMISSIONS). Two copies of a security decision drift silently, and only one of
// them is the one actually enforced.

function rulesMap(fn: "permCreate" | "permUpdate" | "permDelete"): Record<string, string> {
  const body = rules.slice(rules.indexOf(`function ${fn}(sub)`));
  const block = body.slice(0, body.indexOf("}.get(sub, null)"));
  return Object.fromEntries([...block.matchAll(/'([a-z_]+)':\s*'([a-z.]+)'/g)].map((m) => [m[1], m[2]]));
}

for (const verb of ["create", "update", "delete"] as const) {
  const fromRules = rulesMap(`perm${verb[0].toUpperCase()}${verb.slice(1)}` as "permCreate");
  assert.deepEqual(
    fromRules,
    COLLECTION_WRITE_PERMISSIONS[verb],
    `the ${verb} map in firestore.rules disagrees with COLLECTION_WRITE_PERMISSIONS.${verb}`
  );
}

// Every permission those maps name must be one an admin can actually grant.
for (const verb of ["create", "update", "delete"] as const) {
  for (const [collection, permission] of Object.entries(COLLECTION_WRITE_PERMISSIONS[verb])) {
    assert.ok(
      catalogue.has(permission),
      `${collection} ${verb} is guarded by "${permission}", which is not in PERMISSIONS_CATALOG`
    );
  }
}

// --- 6. Role baselines ---------------------------------------------------------------------------

for (const [role, ids] of Object.entries(ROLE_BASELINE)) {
  assert.ok(ids.length > 0, `role "${role}" has an empty baseline`);
  for (const id of ids) {
    assert.ok(catalogue.has(id), `role "${role}" baseline names "${id}", which is not a real permission`);
  }
  // Deletes are irreversible; an admin hands them out per person rather than by role.
  const deletes = ids.filter((id) => id.endsWith(".delete"));
  assert.ok(
    deletes.every((id) => id === "appointments.delete"),
    `role "${role}" is granted ${deletes.join(", ")} by default — only cancelling a booking is baseline`
  );
}

// Admin holds no stored list at all: isClinicAdmin short-circuits ahead of the lookup in both the
// rules and apiStaffAuth, and a materialised list would go stale the next time the catalogue moved.
assert.equal(ROLE_BASELINE.Admin, undefined);
assert.deepEqual(expandPermissions("Admin", ["patients.delete"]), []);

// The expansion never drops what someone was explicitly granted...
assert.ok(expandPermissions("Receptionist", ["patients.delete"]).includes("patients.delete"));
// ...and always includes the role's floor, which is what stops enforcement locking staff out of
// work the browser's role-based guards let them do today.
assert.ok(expandPermissions("Dentist", []).includes("clinical.edit"));
assert.ok(expandPermissions("Dentist", ["clinical.edit"]).filter((p) => p === "clinical.edit").length === 1);
// An unknown role gets only what was explicitly handed to it — never a guess.
assert.deepEqual(expandPermissions("Bookkeeper", ["access.finance"]), ["access.finance"]);
assert.deepEqual(expandPermissions(null, null), []);

assert.equal(holdsPermission("Admin", [], "patients.delete"), true, "Admin passes every check");
assert.equal(holdsPermission("Receptionist", [], null), true, "a null permission is open to members");
assert.equal(holdsPermission("Receptionist", ["patients.add"], "patients.delete"), false);
assert.equal(holdsPermission("Receptionist", null, "patients.add"), false, "no list means nothing granted");

console.log(
  `✓ permissions: ${ids.length} catalogue ids, ${enforced.size} enforced in code, ` +
    `${excluded.size} collections held out of the blanket write grant, ` +
    `${readFromUserDoc.size} user-doc fields read by the rules and written by the server`
);
