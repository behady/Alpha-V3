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
import { BIN_COLLECTIONS } from "../src/lib/recycleBin";
import {
  COLLECTION_WRITE_PERMISSIONS,
  ROLE_BASELINE,
  expandPermissions,
  holdsPermission,
  sanitizePermissionList,
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
  // Everything the recycle bin owns. Their own blocks say `allow delete: if false` so deletion
  // goes through /api/records/delete and the record is photographed on the way out. That deny only
  // holds while these names are also held out of the blanket grant — otherwise the bin becomes
  // advisory, and the failure is invisible: the record is gone, Recently Deleted is empty, and the
  // feature looks broken rather than bypassed.
  "patients",
  "patient_media",
  "prescriptions",
  "treatment_plans",
  "diagnosis_chats",
  "inventory",
  "drugs",
  "marketing_content",
  "attendance",
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

// Grants from the retired catalogue — "finance.view", "settings.edit" and friends — match no check
// anywhere and must not be copied forward forever. Real accounts in production carry them; the
// backfill preview is where they surfaced. Dropping them changes nothing enforceable.
assert.deepEqual(
  expandPermissions("Bookkeeper", ["finance.view", "settings.edit", "access.finance", ""]),
  ["access.finance"],
  "retired ids must be filtered out of the stored list"
);
// ...but "settings" (the sidebar link key) is a real catalogue id and survives.
assert.ok(expandPermissions("Bookkeeper", ["settings"]).includes("settings"));

// The save-time counterpart: an admin's ticks are stored verbatim — validated, de-duplicated,
// sorted, and with NOTHING added. This is what makes unticking a baseline permission stick.
// expandPermissions would fold the Dentist floor back under the save, so a cleared box would
// clear on screen while the grant survived in the enforced map — the checkbox lying in the
// opposite direction from the bug this layer exists to fix.
assert.deepEqual(
  sanitizePermissionList(["patients.edit", "finance.view", "patients.edit", 7, "patients.add"]),
  ["patients.add", "patients.edit"],
  "verbatim: validated and deduplicated, never expanded"
);
assert.deepEqual(sanitizePermissionList(null), []);
assert.ok(
  !sanitizePermissionList(["patients.add"]).includes("clinical.edit"),
  "sanitize must never smuggle a baseline in"
);

assert.equal(holdsPermission("Admin", [], "patients.delete"), true, "Admin passes every check");
assert.equal(holdsPermission("Receptionist", [], null), true, "a null permission is open to members");
assert.equal(holdsPermission("Receptionist", ["patients.add"], "patients.delete"), false);
assert.equal(holdsPermission("Receptionist", null, "patients.add"), false, "no list means nothing granted");


// --- 7. The recycle bin's allow-list must agree with the rules ------------------------------------

// The delete route runs on the Admin SDK and bypasses firestore.rules entirely, so its allow-list
// is the only thing standing between a caller and any collection they care to name. Two ways that
// can rot: a collection the rules close ends up binnable, or a binnable collection quietly regains
// a client-side delete and starts bypassing the bin.

const binNames = Object.keys(BIN_COLLECTIONS);

for (const name of binNames) {
  assert.ok(
    rules.includes(`match /${name}/{`),
    `"${name}" is binnable but has no match block in firestore.rules`
  );
  assert.ok(
    excluded.has(name),
    `"${name}" is binnable but is not held out of the blanket member-write grant — ` +
      `the client can still delete it directly and bypass the bin entirely`
  );
}

// Nothing the rules deliberately close may be reachable through the bin. These are the audit
// trails, the credit meter and the outbound message queues; a permission-map lookup returns null
// for every one of them, and `holdsPermission` reads null as "open to any member".
const SERVER_ONLY = [
  "system_logs", "staff", "settings", "ai_deletion_log", "ai_pending_actions",
  "message_drafts", "sms_outbox", "sms_devices", "whatsapp_outbox", "ai_usage", "ai_usage_log",
  "ledger", "ledger_audit", "clinical_notes",
];
const wronglyBinnable = SERVER_ONLY.filter((name) => binNames.includes(name));
assert.deepEqual(
  wronglyBinnable,
  [],
  `these are server-only in firestore.rules but the recycle bin would accept them: ${wronglyBinnable.join(", ")}`
);

// Every gate must be real: a rule with no permission and no admin flag is reachable by any member.
for (const [name, rule] of Object.entries(BIN_COLLECTIONS)) {
  assert.ok(
    rule.permission !== null || rule.adminOnly,
    `bin rule for "${name}" has neither a permission nor an admin gate`
  );
  if (rule.permission) {
    assert.ok(
      catalogue.has(rule.permission),
      `bin rule for "${name}" names "${rule.permission}", which is not a grantable permission`
    );
  }
}

// --- the expiry gate ------------------------------------------------------------------------------
//
// firestore.rules has checked whether a clinic is still active since long before the money writes
// moved server-side. It checks it for writes the BROWSER makes. The Admin SDK bypasses rules
// entirely, so the moment payments and procedures moved into routes, they left that gate behind —
// not because anyone deleted it, but because the traffic changed doors. An expired clinic went on
// taking money through a route that never asked.
//
// These assertions exist so that cannot happen again quietly.

const authSource = readFileSync(join(REPO, "src/lib/apiStaffAuth.ts"), "utf8");

// The gate lives in the shared helper, not in each route: 37 routes reach Firestore through the
// Admin SDK, and a rule repeated 37 times is a rule already wrong in one of them.
assert.ok(
  authSource.includes("clinicActivity("),
  "apiStaffAuth no longer consults clinicActivity — every Admin-SDK route just lost its expiry check"
);
assert.ok(
  authSource.includes("options?.allowInactive"),
  "apiStaffAuth no longer honours allowInactive — read routes will refuse a lapsed clinic its own records"
);

// It must be opt-OUT. A gate you have to remember to add is a gate the next route will not have.
assert.ok(
  /if \(clinicId && !options\?\.allowInactive/.test(authSource),
  "the clinic check must default to on and be waived explicitly, not the reverse"
);

// Every route that opts out, pinned. Adding a route to this list should take an edit here, so that
// exempting a WRITE from the expiry gate is a decision somebody made on purpose and can defend —
// the failure mode being a single `allowInactive: true` pasted onto a payment route because it was
// next to a read.
const ALLOWED_INACTIVE = [
  "ai/attendance/route.ts",        // GET: today's attendance, read
  "ai/daily-briefing/route.ts",    // GET: the day's own schedule, read
  "ai/reactivation/route.ts",      // POST by name, but computes over clinic data and writes nothing
  "ai/recalls/route.ts",           // GET: who is due, read
  "ai/revenue-recovery/route.ts",  // POST by name, writes nothing
  "appointments/delete/route.ts",  // GET: the delete PREVIEW. The POST that deletes is gated.
  "appointments/free-slots/route.ts", // POST by name, a query
  "marketing/cases/route.ts",      // GET: the case library, read
  "message-drafts/route.ts",       // GET: drafts, read
  "records/bin/route.ts",          // GET: what is in the bin. Seeing what you lost must never
                                   // depend on the subscription; restoring it does.
  "sms/devices/route.ts",          // GET: paired devices, read
];

const apiDir = join(REPO, "src/app/api");
function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkRoutes(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}
const optedOut = walkRoutes(apiDir)
  .filter((file) => readFileSync(file, "utf8").includes("allowInactive"))
  .map((file) => file.slice(apiDir.length + 1))
  .sort();

assert.deepEqual(
  optedOut,
  [...ALLOWED_INACTIVE].sort(),
  "a route's expiry exemption changed. If this is a read, add it to ALLOWED_INACTIVE with the reason. If it writes, it must not be exempt."
);

// The three routes the whole migration was about must never be exempt, whatever else changes.
for (const money of ["finance/ledger", "clinical/procedures"]) {
  const text = readFileSync(join(apiDir, money, "route.ts"), "utf8");
  assert.ok(
    !text.includes("allowInactive"),
    `${money} must stay behind the expiry gate — an expired clinic taking payments is the bug this fixed`
  );
}
// appointments/delete is exempt only on its GET preview; the POST that actually deletes is not.
const deleteRoute = readFileSync(join(apiDir, "appointments/delete/route.ts"), "utf8");
assert.equal(
  (deleteRoute.match(/allowInactive/g) || []).length,
  1,
  "appointments/delete may exempt only its GET preview, never the POST that deletes"
);

// Nobody should be hand-rolling this decision again. The two local copies that existed read
// `status` alone and let a date-expired clinic delete freely, which is why they were removed.
for (const file of walkRoutes(apiDir)) {
  const text = readFileSync(file, "utf8");
  assert.ok(
    !/\.status\s*\?\?\s*["']Active["']/.test(text),
    `${file.slice(apiDir.length + 1)} tests clinic status by hand — use the shared gate, which also checks expiresAt`
  );
}

console.log(
  `✓ permissions: ${ids.length} catalogue ids, ${enforced.size} enforced in code, ` +
    `${excluded.size} collections held out of the blanket write grant, ` +
    `${readFromUserDoc.size} user-doc fields read by the rules and written by the server, ` +
    `${optedOut.length} routes exempt from the expiry gate`
);
