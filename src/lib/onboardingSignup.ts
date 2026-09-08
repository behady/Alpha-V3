/**
 * The one decision behind the "Create clinic" button: hand back a clinic this owner already has,
 * or make a new one?
 *
 * Pure, so the rule can be tested without Firestore. The route loads every clinic the caller owns
 * (a query it already made) and asks this function which of them, if any, the press should resolve
 * to instead of a fresh document.
 *
 * Why this exists: a tester pressed Create once, the confirmation took too long to reach their
 * browser, they refreshed as the screen told them to, saw the form again, typed the name again —
 * and owned two clinics. The server had done its job both times; nothing on either side
 * remembered that the first press had already succeeded. Three rules now do:
 *
 *   1. `orphan`       — a clinic they own but hold no role in. They cannot reach it, so "another"
 *                       clinic is the last thing they need; repair the grant and hand it back.
 *   2. `same-request` — the same signup key. The browser mints one key per attempt and keeps it
 *                       in sessionStorage, so a refresh-and-retry carries the same key and lands
 *                       on the same clinic. A fresh tab, or a deliberate "add another clinic",
 *                       starts with a fresh key.
 *   3. `same-name`    — the same clinic name, spelled the same way. Two clinics with one name and
 *                       one owner is never what somebody meant.
 *
 * Deliberately nothing time-based: "created in the last five minutes" would quietly stop
 * protecting anyone who took a phone call between the two presses.
 */

export type OwnedClinicSummary = {
  id: string;
  name?: unknown;
  signupKey?: unknown;
};

export type ExistingClinicReason = "orphan" | "same-request" | "same-name";

export type ExistingClinicMatch = {
  id: string;
  reason: ExistingClinicReason;
};

/** Signup keys come from the browser: bounded, and only characters a UUID needs. */
export const SIGNUP_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function isValidSignupKey(value: unknown): value is string {
  return typeof value === "string" && SIGNUP_KEY_PATTERN.test(value);
}

/**
 * Case, surrounding and doubled whitespace, and the curly-vs-straight apostrophe are the ways one
 * person types one name twice. Anything more clever ("Nour Dental" vs "Nour Dental Clinic") is a
 * different name, and treating it as the same would block a real second branch.
 */
export function normalizeClinicName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function hasRole(roles: Record<string, unknown> | null | undefined, clinicId: string): boolean {
  const role = roles?.[clinicId];
  return typeof role === "string" && role.length > 0;
}

export function pickExistingClinic(
  owned: OwnedClinicSummary[],
  roles: Record<string, unknown> | null | undefined,
  request: { name: string; signupKey?: string | null }
): ExistingClinicMatch | null {
  const orphan = owned.find((c) => !hasRole(roles, c.id));
  if (orphan) return { id: orphan.id, reason: "orphan" };

  if (request.signupKey) {
    const same = owned.find((c) => c.signupKey === request.signupKey);
    if (same) return { id: same.id, reason: "same-request" };
  }

  const wanted = normalizeClinicName(request.name);
  if (wanted) {
    const same = owned.find((c) => normalizeClinicName(c.name) === wanted);
    if (same) return { id: same.id, reason: "same-name" };
  }

  return null;
}

/** sessionStorage slot for the signup key. Survives a refresh, dies with the tab. */
export const SIGNUP_KEY_STORAGE = "onboarding.signupKey";
/** sessionStorage slot recording which clinic this tab already hard-reloaded for. */
export const RELOADED_FOR_STORAGE = "onboarding.reloadedFor";
