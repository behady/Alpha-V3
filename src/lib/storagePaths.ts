/**
 * Where a file goes in Cloud Storage.
 *
 * Every one of these used to be written inline at its upload site, and four of the six had no
 * clinic in them at all:
 *
 *     patients/{patientId}/avatar_...        patients/{patientId}/media/...
 *     clinical_notes/tooth_{n}_{ts}.jpg      clinicProfile/logo_{ts}_{name}
 *
 * Firestore keeps patients at `clinics/{clinicId}/patients/{patientId}`, so the records were
 * tenant-scoped and their files were not. The last two are worse than unscoped: they are flat
 * folders that every clinic in the system shares, holding intraoral photographs and clinic logos
 * with nothing in the path to say whose they are.
 *
 * That is not a rule that was written too loosely — it is a rule that cannot be written. A Storage
 * rule for `clinical_notes/{file}` sees a filename and nothing else. It cannot ask which clinic
 * owns the file, because the path does not say, and it cannot look it up without a clinic id to
 * look up by. Any rule covering that prefix is therefore either "deny everyone" or "allow every
 * signed-in user" — and the second one, on a folder anybody can enumerate, means a free-trial
 * signup can list every clinic's tooth photographs.
 *
 * Putting the clinic in the path is what makes the rule expressible. Keeping the paths here, in
 * one module, is what stops the seventh upload site from quietly forgetting again —
 * `tests/storagePaths.test.mjs` fails if any of them loses its clinic segment.
 */

/** Legacy prefixes: nothing writes here any more. storage.rules denies them by name. */
export const LEGACY_PREFIXES = ["patients/", "clinical_notes/", "clinicProfile/"] as const;

/**
 * A nullish value that has already been through a template literal.
 *
 * `` `clinics/${clinicId}/…` `` with a null `clinicId` does not produce an empty segment — it
 * produces the four characters `null`, and every check below would wave that through as a
 * perfectly ordinary id. That is not hypothetical: it is exactly how bot media came to be
 * uploadable to `clinics/null/bot_media/`, a folder shared by every clinic that hit the same
 * state, with storage.rules accepting it because to a rule "null" is just a clinic id.
 *
 * Safe to refuse outright. Every clinic id in this system is a Firestore auto-id — twenty
 * characters from `db.collection("clinics").doc()` — and no patient or user id is these words
 * either, so the only way one of them reaches here is a nullish that was stringified upstream.
 */
const STRINGIFIED_NULLISH = new Set(["null", "undefined", "NaN", "[object Object]"]);

function requireClinic(clinicId: string | null | undefined): string {
  const id = (clinicId ?? "").trim();
  // Refusing beats defaulting. A blank clinic id used to fall through to a path that still
  // uploaded — into the shared folder, silently, with no clinic attached. An upload that fails
  // loudly is recoverable; one that lands somewhere unscoped is not, because nothing afterwards
  // can tell whose it was.
  if (!id) throw new Error("No clinic selected — refusing to upload outside a clinic.");
  if (id.includes("/")) throw new Error("Invalid clinic id.");
  if (STRINGIFIED_NULLISH.has(id)) throw new Error("Invalid clinic id.");
  return id;
}

function requireSegment(value: string | null | undefined, what: string): string {
  const v = (value ?? "").trim();
  if (!v) throw new Error(`Missing ${what} — refusing to upload.`);
  if (v.includes("/")) throw new Error(`Invalid ${what}.`);
  if (STRINGIFIED_NULLISH.has(v)) throw new Error(`Invalid ${what}.`);
  return v;
}

/** A patient's profile photo. */
export function patientAvatarPath(clinicId: string | null | undefined, patientId: string, ext: string): string {
  return `clinics/${requireClinic(clinicId)}/patients/${requireSegment(patientId, "patient id")}/avatar_${Date.now()}.${sanitizeExt(ext)}`;
}

/** Anything in a patient's media gallery — photos, scans, uploaded documents. */
export function patientMediaPath(
  clinicId: string | null | undefined,
  patientId: string,
  ext: string,
  prefix = ""
): string {
  const name = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${sanitizeExt(ext)}`;
  return `clinics/${requireClinic(clinicId)}/patients/${requireSegment(patientId, "patient id")}/media/${name}`;
}

/** An intraoral photograph attached to one tooth on the chart. */
export function toothImagePath(clinicId: string | null | undefined, tooth: number | string): string {
  const t = String(tooth).replace(/[^0-9A-Za-z]/g, "");
  if (!t) throw new Error("Missing tooth number — refusing to upload.");
  return `clinics/${requireClinic(clinicId)}/clinical_notes/tooth_${t}_${Date.now()}.jpg`;
}

/** The clinic's own logo. */
export function clinicLogoPath(clinicId: string | null | undefined, filename: string): string {
  // Slashes alone cannot escape once they are stripped, but a run of dots has no legitimate use in
  // a filename and `.._.._etc_passwd` is a thing somebody will one day have to read in a bucket
  // listing and reason about. Collapsed here so it never gets written.
  const safe = (filename || "logo")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.]+/, "")
    .slice(0, 60) || "logo";
  return `clinics/${requireClinic(clinicId)}/clinic_profile/logo_${Date.now()}_${safe}`;
}

/** The hero image on the public booking page. */
export function bookingHeroPath(clinicId: string | null | undefined): string {
  return `clinics/${requireClinic(clinicId)}/booking_hero_${Date.now()}`;
}

/**
 * A picture or document the WhatsApp assistant can send to a patient.
 *
 * The seventh upload site, and the one this module's closing note predicted: written inline at
 * `clinics/${clinicId}/bot_media/...` by somebody with no reason to be thinking about tenancy at
 * that moment. Its shape was right — the clinic was in the path, and storage.rules already covered
 * it — but it read the clinic with `currentClinicId()`, which returns `string | null` rather than
 * throwing, and a null interpolated into a template literal is the STRING "null". That produces
 * `clinics/null/bot_media/...`: a path the rules happily accept (clinicId is just "null" to them),
 * shared by every clinic that ever hits the same state.
 *
 * It would never have surfaced as an error either. The app stores the `getDownloadURL()` result in
 * Firestore and renders from that, and a download URL carries its own token and bypasses rules —
 * so the bot would have gone on sending the image to patients perfectly normally, out of a folder
 * belonging to nobody. `requireClinic` refuses instead.
 *
 * `slice(-60)` keeps the TAIL, unlike `clinicLogoPath` above: these are images AND PDFs, and the
 * extension is the half worth keeping when a long name has to be cut.
 */
export function botMediaPath(clinicId: string | null | undefined, filename: string): string {
  const safe = (filename || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(-60)
    // After the slice, not before: cutting a long name can land the window on a dot.
    .replace(/^[.]+/, "") || "file";
  return `clinics/${requireClinic(clinicId)}/bot_media/${Date.now()}_${safe}`;
}

/**
 * A staff member's own profile picture.
 *
 * Deliberately NOT under a clinic: one person can work at several, the picture is theirs rather
 * than any clinic's, and the uid in the path is what the rule matches on. This is the one prefix
 * outside `clinics/` that a rule can still enforce properly.
 */
export function staffProfilePath(uid: string): string {
  return `staff_profiles/${requireSegment(uid, "user id")}_${Date.now()}`;
}

function sanitizeExt(ext: string): string {
  const e = (ext || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  return e || "bin";
}
