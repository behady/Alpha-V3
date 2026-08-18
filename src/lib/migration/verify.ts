import { adminDb } from "@/lib/firebaseAdmin";
import {
  DOCUMENT_REROUTES,
  MIGRATION_STAMP_FIELD,
  SKIP_COLLECTIONS,
  targetPathFor,
  type SourceCredentials,
} from "./routing";
import { sourceDb } from "./sourceApp";

/**
 * Prove the migration landed, before anyone is asked to work in v3.
 *
 * Four checks, cheapest first. The third matters most and is the one a count comparison cannot
 * catch: counts agreeing only proves the same NUMBER of rows arrived, not that an appointment
 * still finds its patient.
 */

export type CheckRow = {
  label: string;
  status: "ok" | "fail" | "warn" | "info";
  detail: string;
};

export type VerifyReport = {
  counts: CheckRow[];
  samples: CheckRow[];
  links: CheckRow[];
  staff: CheckRow[];
  failures: number;
};

/** The id links that hold the clinical record together. */
const REFERENCE_CHECKS = [
  { collection: "appointments", field: "patientId", target: "patients" },
  { collection: "clinical_notes", field: "patientId", target: "patients" },
  { collection: "ledger", field: "patientId", target: "patients" },
  { collection: "prescriptions", field: "patientId", target: "patients" },
  { collection: "ortho_cases", field: "patientId", target: "patients" },
  { collection: "ortho_sessions", field: "caseId", target: "ortho_cases" },
  { collection: "inventory_transactions", field: "itemId", target: "inventory" },
];

/**
 * Fields that are SUPPOSED to differ. `staff.uid` holds a Firebase Auth uid, which is
 * per-project — the staff step deliberately repoints it. Comparing it literally would report a
 * correctly linked clinic as corrupted. It is not skipped, only moved: check 4 validates the
 * linkage properly, which is a stronger statement than "the two strings match".
 */
const EXPECTED_REWRITTEN_FIELDS: Record<string, Set<string>> = {
  staff: new Set(["uid"]),
};

export async function verifyMigration(
  creds: SourceCredentials,
  clinicId: string,
  sampleSize: number
): Promise<VerifyReport> {
  const src = sourceDb(creds);
  const dst = adminDb();
  const report: VerifyReport = { counts: [], samples: [], links: [], staff: [], failures: 0 };

  const collections = (await src.listCollections()).map((col) => col.id).sort();
  const isRerouted = (collection: string, docId: string) =>
    Boolean(DOCUMENT_REROUTES[`${collection}/${docId}`]);

  // ---------------------------------------------------------------------------- 1. counts
  for (const name of collections) {
    if (SKIP_COLLECTIONS[name]) {
      report.counts.push({ label: name, status: "info", detail: "handled by the staff step" });
      continue;
    }

    const rawCount = (await src.collection(name).count().get()).data().count;
    const reroutedIds = Object.keys(DOCUMENT_REROUTES)
      .filter((key) => key.startsWith(`${name}/`))
      .map((key) => key.slice(name.length + 1));
    const reroutedPresent = reroutedIds.length
      ? (await src.getAll(...reroutedIds.map((id) => src.doc(`${name}/${id}`)))).filter(
          (snap) => snap.exists
        ).length
      : 0;

    const expected = rawCount - reroutedPresent;
    const actual = (
      await dst.collection(targetPathFor(clinicId, name).join("/")).count().get()
    ).data().count;

    if (expected === actual) {
      report.counts.push({
        label: name,
        status: "ok",
        detail: `${expected}${reroutedPresent ? ` (+${reroutedPresent} moved to secrets)` : ""}`,
      });
    } else if (actual > expected) {
      // More rows in v3 than v2 is normal once the clinic starts working there.
      report.counts.push({
        label: name,
        status: "warn",
        detail: `${actual} here vs ${expected} in the old system (+${actual - expected} added in v3?)`,
      });
    } else {
      report.failures += 1;
      report.counts.push({
        label: name,
        status: "fail",
        detail: `${expected - actual} missing — old system has ${expected}, this one has ${actual}`,
      });
    }
  }

  // -------------------------------------------------------------------------- 2. sampling
  for (const name of collections) {
    if (SKIP_COLLECTIONS[name]) continue;

    const page = await src.collection(name).orderBy("__name__").limit(sampleSize).get();
    if (page.empty) continue;

    let missing = 0;
    let differing = 0;
    let sampled = 0;

    for (const doc of page.docs) {
      if (isRerouted(name, doc.id)) continue;
      sampled += 1;

      const snap = await dst.doc([...targetPathFor(clinicId, name), doc.id].join("/")).get();
      if (!snap.exists) {
        missing += 1;
        continue;
      }

      const target = snap.data() || {};
      for (const [key, value] of Object.entries(doc.data())) {
        if (key === MIGRATION_STAMP_FIELD) continue;
        if (EXPECTED_REWRITTEN_FIELDS[name]?.has(key)) continue;
        if (!sameValue(value, target[key], clinicId)) {
          differing += 1;
          break;
        }
      }
    }

    if (missing || differing) {
      report.failures += 1;
      report.samples.push({
        label: name,
        status: "fail",
        detail: `${missing} missing, ${differing} different of ${sampled} checked`,
      });
    } else if (sampled) {
      report.samples.push({ label: name, status: "ok", detail: `${sampled} checked` });
    }
  }

  // ------------------------------------------------------------------------- 3. link checks
  await checkReferenceLinks(dst, clinicId, report);

  // ------------------------------------------------------------------------ 4. staff logins
  await checkStaffLinkage(dst, clinicId, report);

  return report;
}

async function checkReferenceLinks(
  dst: FirebaseFirestore.Firestore,
  clinicId: string,
  report: VerifyReport
): Promise<void> {
  for (const check of REFERENCE_CHECKS) {
    const page = await dst
      .collection(targetPathFor(clinicId, check.collection).join("/"))
      .limit(500)
      .get();
    const label = `${check.collection} → ${check.target}`;

    if (page.empty) {
      report.links.push({ label, status: "info", detail: "nothing to check" });
      continue;
    }

    const ids = new Set<string>();
    for (const doc of page.docs) {
      const value = doc.get(check.field);
      if (typeof value === "string" && value.trim()) ids.add(value.trim());
    }
    if (!ids.size) {
      report.links.push({ label, status: "info", detail: "not used" });
      continue;
    }

    const targetCollection = targetPathFor(clinicId, check.target).join("/");
    const snaps = await dst.getAll(...[...ids].map((id) => dst.doc(`${targetCollection}/${id}`)));
    const dangling = snaps.filter((snap) => !snap.exists).length;

    if (dangling) {
      report.failures += 1;
      report.links.push({
        label,
        status: "fail",
        detail: `${dangling} of ${ids.size} point at a record that is not here`,
      });
    } else {
      report.links.push({ label, status: "ok", detail: `all ${ids.size} resolve` });
    }
  }
}

async function checkStaffLinkage(
  dst: FirebaseFirestore.Firestore,
  clinicId: string,
  report: VerifyReport
): Promise<void> {
  const staffSnap = await dst.collection(targetPathFor(clinicId, "staff").join("/")).get();
  for (const doc of staffSnap.docs) {
    const name = doc.get("name") || doc.id;
    const uid = doc.get("uid");

    if (!uid) {
      report.staff.push({ label: name, status: "warn", detail: "no email, so no login yet" });
      continue;
    }

    const user = await dst.collection("users").doc(uid).get();
    if (!user.exists) {
      report.staff.push({ label: name, status: "warn", detail: "not linked yet — run Staff logins" });
      continue;
    }

    const role = ((user.get("clinicRoles") || {}) as Record<string, string>)[clinicId];
    if (!role) {
      /**
       * The account signs in successfully and then sees no clinic at all — the most confusing
       * possible failure, and one this codebase has already had in production.
       */
      report.failures += 1;
      report.staff.push({
        label: name,
        status: "fail",
        detail: "account exists but has no access to this clinic — they would sign in and see nothing",
      });
      continue;
    }

    report.staff.push({ label: name, status: "ok", detail: role });
  }
}

/**
 * Compare across projects. Several kinds of value are EXPECTED to differ, and treating any
 * difference as a fault would fail on a perfectly good migration — so each expected
 * transformation is validated rather than ignored.
 */
function sameValue(a: unknown, b: unknown, clinicId: string): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;

  const aObj = a as { toMillis?: () => number; path?: string };
  const bObj = b as { toMillis?: () => number; path?: string };

  // Timestamps are class instances bound to their own connection; compare by instant.
  if (typeof aObj.toMillis === "function" && typeof bObj?.toMillis === "function") {
    return aObj.toMillis() === bObj.toMillis();
  }
  // A reference is expected to have gained the clinics/{id} prefix on the way over.
  if (typeof aObj.path === "string" && typeof bObj?.path === "string") {
    return bObj.path.endsWith(aObj.path);
  }
  // A storage URL is expected to have been repointed at the v3 bucket under this clinic.
  if (typeof a === "string" && typeof b === "string") {
    const sourcePath = extractObjectPath(a);
    if (!sourcePath) return false;
    if (a === b) return true;
    return b.includes(encodeURIComponent(`clinics/${clinicId}/${sourcePath}`)) ||
      b.endsWith(`clinics/${clinicId}/${sourcePath}`);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, i) => sameValue(entry, b[i], clinicId));
  }
  if (typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
    return [...keys].every((key) =>
      sameValue(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        clinicId
      )
    );
  }
  return false;
}

/**
 * Object path from a Firebase download URL or gs:// reference, whatever bucket it names.
 *
 * Matched against no expected bucket, for the same reason the copier does not: the bucket a
 * backup records is a guess from the old project's env, and Firebase's modern default
 * (`<project>.firebasestorage.app`) does not match the older `<project>.appspot.com` form. A
 * name-based check reported correctly migrated images as corrupted.
 */
function extractObjectPath(url: string): string | null {
  const download = url.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/);
  if (download) return decodeURIComponent(download[2]);
  const gs = url.match(/^gs:\/\/[^/]+\/(.+)$/);
  if (gs) return gs[1];
  return null;
}

// ------------------------------------------------------------------- verify from a backup file

/**
 * The same four checks, driven by an uploaded v2 backup file instead of live source credentials.
 *
 * The browser holds the file, so it sends what the checks need: per-collection counts, a sample
 * of documents to compare field by field, and which re-routed documents (the WhatsApp secret)
 * the backup contained. Everything target-side — the link checks and the staff-login check —
 * is the shared code the credentials path uses, so both paths hold the migration to the same
 * standard.
 */
export async function verifyFromBackup(
  clinicId: string,
  counts: { path: string; count: number }[],
  samples: { path: string; data: unknown }[],
  reroutesPresent: string[]
): Promise<VerifyReport> {
  const { decodeValue } = await import("./backup");
  const dst = adminDb();
  const report: VerifyReport = { counts: [], samples: [], links: [], staff: [], failures: 0 };

  // ---------------------------------------------------------------------------- 1. counts
  for (const { path, count } of counts) {
    const segments = path.split("/");
    const rootName = segments[0];
    if (SKIP_COLLECTIONS[rootName]) {
      report.counts.push({ label: path, status: "info", detail: "handled by the staff step" });
      continue;
    }

    const targetPath = [...targetPathFor(clinicId, rootName), ...segments.slice(1)].join("/");
    const actual = (await dst.collection(targetPath).count().get()).data().count;

    if (count === actual) {
      report.counts.push({ label: path, status: "ok", detail: `${count}` });
    } else if (actual > count) {
      report.counts.push({
        label: path,
        status: "warn",
        detail: `${actual} here vs ${count} in the backup (+${actual - count} added in v3?)`,
      });
    } else {
      report.failures += 1;
      report.counts.push({
        label: path,
        status: "fail",
        detail: `${count - actual} missing — backup has ${count}, this system has ${actual}`,
      });
    }
  }

  for (const key of reroutesPresent) {
    const reroute = DOCUMENT_REROUTES[key];
    if (!reroute) continue;
    const spec = reroute.target(clinicId);
    const snap = await dst.doc(spec.path.join("/")).get();
    if (snap.exists && snap.get(spec.field) !== undefined) {
      report.counts.push({ label: key, status: "ok", detail: "moved to server-only secrets" });
    } else {
      report.failures += 1;
      report.counts.push({ label: key, status: "fail", detail: "secret did not arrive" });
    }
  }

  // -------------------------------------------------------------------------- 2. sampling
  const byCollection = new Map<string, { missing: number; differing: number; sampled: number }>();
  for (const sample of samples) {
    const segments = sample.path.split("/");
    const rootName = segments[0];
    if (SKIP_COLLECTIONS[rootName] || DOCUMENT_REROUTES[sample.path]) continue;

    const bucket = byCollection.get(rootName) || { missing: 0, differing: 0, sampled: 0 };
    bucket.sampled += 1;

    const targetRef = dst.doc([...targetPathFor(clinicId, rootName), ...segments.slice(1)].join("/"));
    const snap = await targetRef.get();
    if (!snap.exists) {
      bucket.missing += 1;
    } else {
      const expected = decodeValue(sample.data, clinicId, dst) as Record<string, unknown>;
      const target = snap.data() || {};
      for (const [key, value] of Object.entries(expected)) {
        if (key === MIGRATION_STAMP_FIELD) continue;
        if (EXPECTED_REWRITTEN_FIELDS[rootName]?.has(key)) continue;
        if (!sameValue(value, target[key], clinicId)) {
          bucket.differing += 1;
          break;
        }
      }
    }
    byCollection.set(rootName, bucket);
  }

  for (const [name, bucket] of [...byCollection.entries()].sort()) {
    if (bucket.missing || bucket.differing) {
      report.failures += 1;
      report.samples.push({
        label: name,
        status: "fail",
        detail: `${bucket.missing} missing, ${bucket.differing} different of ${bucket.sampled} checked`,
      });
    } else {
      report.samples.push({ label: name, status: "ok", detail: `${bucket.sampled} checked` });
    }
  }

  // ------------------------------------------------------------------- 3 + 4. links, staff
  await checkReferenceLinks(dst, clinicId, report);
  await checkStaffLinkage(dst, clinicId, report);

  return report;
}
