import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { targetPathFor, type SourceCredentials } from "./routing";
import { sourceDb } from "./sourceApp";

/**
 * Rebuild the clinic's staff logins in v3.
 *
 * A Firebase Auth uid belongs to one project. v2 gave each clinic its own project, so every
 * staff member's uid is meaningless here — and `users/{uid}` is keyed by exactly that uid.
 * Copying v2 user documents across would key them to uids that will never sign in, while the
 * accounts people actually use would hold no roles at all.
 *
 * Identity is therefore rebuilt from the one thing stable across projects: the email address.
 *
 * Passwords do not come across. Firebase will not reveal them and the hashes are bound to the
 * source project's keys, so each person gets a reset link instead. That is a real cutover cost
 * and belongs on the checklist, not in a surprise on the first morning.
 */

export type StaffPerson = {
  staffDocId: string;
  email: string;
  name: string;
  role: string;
  isDentist: boolean;
  permissions: string[];
  hadLogin: boolean;
};

export type StaffResult = {
  email: string;
  name: string;
  role: string;
  uid: string;
  created: boolean;
  resetLink?: string;
};

export type StaffNoEmail = { staffDocId: string; name: string };

const normaliseEmail = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * Merge the two v2 documents that describe one person: `staff/{id}` (the clinic-facing record —
 * name, role) and `users/{uid}` (the login — permissions). Email is the only field both carry
 * reliably, so it is the join key.
 */
export async function collectStaff(
  creds: SourceCredentials,
  forcedAdminEmail?: string
): Promise<{ people: StaffPerson[]; noEmail: StaffNoEmail[] }> {
  const src = sourceDb(creds);
  const [staffSnap, usersSnap] = await Promise.all([
    src.collection("staff").get(),
    src.collection("users").get(),
  ]);

  return mergeStaff(
    staffSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> })),
    usersSnap.docs.map((doc) => doc.data() as Record<string, unknown>),
    forcedAdminEmail
  );
}

/**
 * The merge itself, separated from where the documents come from: the live path reads them from
 * the old project, the backup path pulls them out of the uploaded file. Both must produce the
 * same people, so there is exactly one implementation.
 */
export function mergeStaff(
  staffDocs: { id: string; data: Record<string, unknown> }[],
  userDocs: Record<string, unknown>[],
  forcedAdminEmail?: string
): { people: StaffPerson[]; noEmail: StaffNoEmail[] } {
  const usersByEmail = new Map<string, Record<string, unknown>>();
  for (const data of userDocs) {
    const email = normaliseEmail(data.email);
    if (email) usersByEmail.set(email, data);
  }

  const forced = normaliseEmail(forcedAdminEmail);
  const people: StaffPerson[] = [];
  const noEmail: StaffNoEmail[] = [];

  for (const { id, data } of staffDocs) {
    const email = normaliseEmail(data.email);
    if (!email) {
      noEmail.push({ staffDocId: id, name: (data.name as string) || "(unnamed)" });
      continue;
    }

    const user = usersByEmail.get(email) || {};
    const role =
      forced === email
        ? "Admin"
        : (data.role as string | undefined) || (user.role as string | undefined) || "Assistant";

    people.push({
      staffDocId: id,
      email,
      name: (data.name as string | undefined) || (user.name as string | undefined) || email,
      role,
      isDentist: Boolean(data.isDentist ?? user.isDentist ?? false),
      permissions: (data.permissions || user.permissions || []) as string[],
      hadLogin: usersByEmail.has(email),
    });
  }

  return { people, noEmail };
}

/** Create or reuse each account, grant the clinic, and repoint the migrated staff document. */
export async function linkStaff(
  sourceProject: string,
  clinicId: string,
  people: StaffPerson[],
  withResetLinks: boolean
): Promise<StaffResult[]> {
  const auth = adminAuth();
  const dst = adminDb();
  const results: StaffResult[] = [];

  for (const person of people) {
    let uid: string;
    let created = false;

    try {
      uid = (await auth.getUserByEmail(person.email)).uid;
    } catch {
      /**
       * A random password nobody ever learns, including us. The account is reachable only
       * through the reset link, so there is no window where a guessable password is live on an
       * account that can read patient records.
       */
      const user = await auth.createUser({
        email: person.email,
        password: `${randomPassword()}`,
        displayName: person.name,
      });
      uid = user.uid;
      created = true;
    }

    /**
     * Nested map, not a dotted key. In set() a dot is part of the field NAME, so
     * `{"clinicRoles.abc": "Admin"}` creates a top-level field literally called
     * "clinicRoles.abc" and leaves clinicRoles empty — the account then signs in fine and sees
     * no clinics at all. merge:true preserves roles the person holds at other clinics.
     */
    await dst.collection("users").doc(uid).set(
      {
        uid,
        name: person.name,
        email: person.email,
        role: person.role,
        isDentist: person.isDentist,
        permissions: person.permissions,
        staffId: person.staffDocId,
        clinicRoles: { [clinicId]: person.role },
        defaultClinicId: clinicId,
        migratedFrom: sourceProject,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // The migrated staff document still carries the source project's uid, which matches nothing
    // here. Anything keyed on staff.uid (summons, attendance) needs the new one.
    await dst
      .doc([...targetPathFor(clinicId, "staff"), person.staffDocId].join("/"))
      .set({ uid }, { merge: true });

    results.push({
      email: person.email,
      name: person.name,
      role: person.role,
      uid,
      created,
      resetLink: withResetLinks
        ? await auth.generatePasswordResetLink(person.email)
        : undefined,
    });
  }

  return results;
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
