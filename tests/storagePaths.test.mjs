// Where uploaded files land, and why the clinic has to be in the path.
//
// Firestore keeps patients at clinics/{clinicId}/patients/{patientId}. Their FILES used to land at
// patients/{patientId}/..., clinical_notes/... and clinicProfile/... — no clinic anywhere. The last
// two are flat folders every clinic in the system shares.
//
// That is not a rule written too loosely. It is a rule that cannot be written: given
// `clinical_notes/tooth_11_1724.jpg`, a Storage rule has a filename and no way to learn whose it
// is. The only expressible rules are deny-all and allow-any-signed-in-user, and the second one on
// an enumerable folder means a free-trial signup can list every clinic's intraoral photographs.
//
// Putting the clinic in the path is what makes the rule expressible at all.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGACY_PREFIXES,
  bookingHeroPath,
  clinicLogoPath,
  patientAvatarPath,
  patientMediaPath,
  staffProfilePath,
  toothImagePath,
} from "../src/lib/storagePaths.ts";

// .pathname on Windows yields "/C:/Users/...", which join() then turns into "C:\C:\Users\..." —
// the whole file threw before its first assertion ran. Forward slashes so the endsWith() and
// slice() below, which are written in posix, keep working on both platforms.
const REPO = fileURLToPath(new URL("..", import.meta.url)).split(sep).join("/");
const CLINIC = "clinicA";

// --- every clinic-owned path starts with the clinic ------------------------------------------

const clinicScoped = [
  patientAvatarPath(CLINIC, "p1", "jpg"),
  patientMediaPath(CLINIC, "p1", "png"),
  patientMediaPath(CLINIC, "p1", "png", "diag_"),
  toothImagePath(CLINIC, 11),
  clinicLogoPath(CLINIC, "my logo.png"),
  bookingHeroPath(CLINIC),
];
for (const path of clinicScoped) {
  assert.ok(path.startsWith(`clinics/${CLINIC}/`), `not clinic-scoped: ${path}`);
}

// The patient is in the path too, so a single patient's files can be found and erased without
// reading every document in the clinic first.
assert.match(patientAvatarPath(CLINIC, "p1", "jpg"), /^clinics\/clinicA\/patients\/p1\/avatar_\d+\.jpg$/);
assert.match(patientMediaPath(CLINIC, "p1", "png"), /^clinics\/clinicA\/patients\/p1\/media\/\d+_[a-z0-9]+\.png$/);
assert.match(patientMediaPath(CLINIC, "p1", "png", "diag_"), /\/media\/diag_\d+_/);
assert.match(toothImagePath(CLINIC, 11), /^clinics\/clinicA\/clinical_notes\/tooth_11_\d+\.jpg$/);

// One clinic's path can never be a prefix of another's.
assert.ok(!patientAvatarPath("clinicAB", "p1", "jpg").startsWith(`clinics/${CLINIC}/`));

// --- refusing beats defaulting ----------------------------------------------------------------

// A blank clinic id used to fall through to a path that still uploaded — into the shared folder,
// silently. An upload that throws is recoverable; one that lands unscoped is not, because nothing
// afterwards can work out whose it was.
for (const bad of [null, undefined, "", "   "]) {
  assert.throws(() => patientAvatarPath(bad, "p1", "jpg"), /No clinic selected/);
  assert.throws(() => toothImagePath(bad, 11), /No clinic selected/);
  assert.throws(() => clinicLogoPath(bad, "x.png"), /No clinic selected/);
  assert.throws(() => bookingHeroPath(bad), /No clinic selected/);
}
assert.throws(() => patientMediaPath(CLINIC, "", "jpg"), /Missing patient id/);
assert.throws(() => staffProfilePath(""), /Missing user id/);

// --- path escapes -------------------------------------------------------------------------------

// A slash in an id is a legal multi-segment path and would climb straight out of the clinic —
// the same escape the recycle bin refuses on document ids.
assert.throws(() => patientAvatarPath("a/b", "p1", "jpg"), /Invalid clinic id/);
assert.throws(() => patientMediaPath(CLINIC, "../../other", "jpg"), /Invalid patient id/);
assert.throws(() => staffProfilePath("a/b"), /Invalid user id/);

// Free-text that reaches a filename is scrubbed rather than trusted.
assert.ok(!clinicLogoPath(CLINIC, "../../../etc/passwd").includes(".."));
assert.match(clinicLogoPath(CLINIC, "../../x.png"), /^clinics\/clinicA\/clinic_profile\/logo_\d+_/);
assert.match(patientAvatarPath(CLINIC, "p1", "../jpg"), /\.jpg$/);
assert.match(patientAvatarPath(CLINIC, "p1", ""), /\.bin$/);
assert.match(toothImagePath(CLINIC, "11/../x"), /tooth_11x_\d+\.jpg$/);

// --- the drift check ------------------------------------------------------------------------------

// Nothing may build a storage path inline again. Six upload sites did, four of them without a
// clinic, and each was written by somebody who had no reason to think about tenancy at that moment.
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full.split(sep).join("/"));
  }
  return out;
}

const offenders = [];
for (const file of walk(join(REPO, "src"))) {
  if (file.endsWith("src/lib/storagePaths.ts")) continue;
  const text = readFileSync(file, "utf8");
  // ref(storage, `literal...`) — a template literal rather than a call into the module.
  for (const m of text.matchAll(/(?:ref|storageRef)\(\s*storage\s*,\s*`([^`]*)`/g)) {
    offenders.push(`${file.slice(REPO.length)} -> ${m[1]}`);
  }
}
assert.deepEqual(
  offenders,
  [],
  `storage paths built inline. Add a builder to src/lib/storagePaths.ts instead:\n  ${offenders.join("\n  ")}`
);

// --- the rules file exists and covers what it must -------------------------------------------------

// It did not exist until 2026-08-24; the bucket was governed from the console alone, unversioned —
// the same state firestore.rules was in when it was found to have drifted ahead of the repository.
const rules = readFileSync(join(REPO, "storage.rules"), "utf8");

// The comments in storage.rules quote the broken Firestore lookup in order to explain why it is
// gone, so every assertion about what the ruleset DOES reads the code with the comments stripped.
// Otherwise the explanation trips the check that exists to keep the explained thing out.
// Every comment line in storage.rules is a whole line, so dropping them needs no parsing.
const rulesCode = rules
  .split("\n")
  .map((line) => (line.trimStart().startsWith("//") ? "" : line))
  .join("\n");

// The shapes this file pins down, named so the assertions below read as prose.
const RX_CLINIC = /match \/clinics\/\{clinicId\}\/\{allPaths=\*\*\}\s*\{([\s\S]*?)\n    \}/;
const RX_CROSS  = /firestore\.(get|exists)\s*\(\s*\/databases\/\(default\)/;
const RX_GET    = /allow get: if isAuth\(\);/;
const RX_WRITE  = /allow create, update: if isAuth\(\) && sizeOk\(\);/;
const RX_BROAD  = /allow (read|write)\b/;
const RX_UID    = /fileName\.split\('_'\)\[0\] == request\.auth\.uid/;

// This test used to demand a membership check here, and that was wrong: it demanded something a
// Storage rule in this project cannot do. Storage rules may only read the (default) Firestore
// database, and this one is NAMED default — a different database, which (default) is not an alias
// for. A ruleset carrying that lookup denies every upload, so this assertion was holding the file
// open at exactly the shape that breaks it.
const clinicRule = rulesCode.match(RX_CLINIC);
assert.ok(clinicRule, "no clinic-scoped rule");

assert.ok(
  !RX_CROSS.test(rulesCode),
  "storage.rules reads the (default) Firestore database, which does not exist in this project — " +
    "every clinic upload would be denied. See the comment at the top of storage.rules."
);

// What the clinic rule CAN check, and must: signed in, and size-capped on the way in.
assert.match(clinicRule[1], RX_GET, "clinic reads are no longer gated on being signed in");
assert.match(clinicRule[1], RX_WRITE, "clinic uploads are no longer gated on auth + size");

// read is get + list; write is create + update + delete. Either convenience method on a clinic
// folder hands a signed-in user enumeration of every patient photograph in it, or the ability to
// erase them. Nothing in src/ lists or deletes, so nothing needs them.
assert.ok(
  !RX_BROAD.test(clinicRule[1]),
  "clinic folders grant read or write — use get and create, update so list and delete stay denied"
);

// The one prefix still fully enforced, because the identity it needs is in the path and the token
// with no Firestore lookup in between: you may write only a file named for your own uid.
assert.ok(RX_UID.test(rulesCode), "staff_profiles no longer pins the uploaded file to the uploader uid");

// Every legacy prefix must be denied by name. Frozen, not deleted: URLs already in Firestore keep
// working because a download URL's token bypasses rules. What is refused is path access — above
// all listing, which on clinical_notes/ handed any signed-in user every clinic's photographs.
for (const prefix of LEGACY_PREFIXES) {
  const name = prefix.replace(/\/$/, "");
  assert.match(
    rules,
    new RegExp(`match /${name}/\\{allPaths=\\*\\*\\}\\s*\\{\\s*allow read, write: if false;`),
    `storage.rules does not deny the legacy prefix ${prefix}`
  );
}
assert.ok(/match \/\{allPaths=\*\*\}\s*\{\s*allow read, write: if false;/.test(rules),
  "storage.rules has no catch-all deny");

// firebase.json must point at it, or the file is a document rather than a deployed ruleset.
const firebaseJson = JSON.parse(readFileSync(join(REPO, "firebase.json"), "utf8"));
assert.equal(firebaseJson.storage?.rules, "storage.rules", "firebase.json does not deploy storage.rules");

console.log(
  `✓ storagePaths: ${clinicScoped.length} clinic-scoped builders, ` +
    `${LEGACY_PREFIXES.length} legacy prefixes denied, no inline paths`
);
