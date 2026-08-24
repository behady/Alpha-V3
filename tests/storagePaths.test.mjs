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
import { join } from "node:path";
import {
  LEGACY_PREFIXES,
  bookingHeroPath,
  clinicLogoPath,
  patientAvatarPath,
  patientMediaPath,
  staffProfilePath,
  toothImagePath,
} from "../src/lib/storagePaths.ts";

const REPO = new URL("..", import.meta.url).pathname;
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
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
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
assert.ok(rules.includes("match /clinics/{clinicId}/{allPaths=**}"), "no clinic-scoped rule");
assert.ok(/hasClinicRole\(clinicId\)/.test(rules), "the clinic rule does not check membership");

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
