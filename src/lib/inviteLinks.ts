/**
 * Invite links: the rules, with no Firestore in them.
 *
 * Joining a clinic used to take five steps across two people: the admin finds the Clinic ID under
 * Settings, sends it, the colleague creates an account, pastes the ID, files a request, the admin
 * finds the request and approves it, the colleague signs in again. An invite link is one message
 * on WhatsApp: the admin picks a role and shares the link, the colleague opens it, signs in or
 * signs up, and is in — with the role the admin chose, already ticked into the same permission
 * floor approval would have given them.
 *
 * Every invite lives at the ROOT collection `invites/{code}` with its clinicId inside. Root, so
 * the join page can look a code up without knowing the clinic first; and the collection is read
 * and written only through the Admin SDK — firestore.rules has no entry for it, which means
 * "denied to every browser", which is what a credential should be.
 *
 * A link is a credential. So: short-lived (seven days), single-use by default, revocable, and the
 * role it grants is never Owner or Admin from the link alone — an Admin who wants a second Admin
 * promotes them on the Users screen afterwards, where the choice is deliberate and logged.
 */

import { ASSIGNABLE_ROLES } from "./permissions";

export const INVITES_COLLECTION = "invites";
export const INVITE_TTL_DAYS = 7;
export const INVITE_CODE_LENGTH = 10;

/** Where the join page remembers a code while the person signs in. */
export const PENDING_INVITE_STORAGE = "alpha.pendingInvite";

/**
 * Roles a link may grant. Full-access roles are excluded on purpose: a forwarded WhatsApp
 * message must not be able to make someone an Admin.
 */
export const INVITABLE_ROLES = ASSIGNABLE_ROLES.filter((r) => r !== "Admin") as readonly string[];

export function isInvitableRole(value: unknown): value is string {
  return typeof value === "string" && INVITABLE_ROLES.includes(value);
}

/** No 0/O/1/I/L: the code will be read aloud over the phone and typed from a screenshot. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return out;
}

/** Accepts what people paste: lower case, surrounding spaces, the 0/O and 1/I confusions. */
export function normalizeInviteCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/0/g, "O").replace(/[1IL]/g, "I").replace(/[^A-Z2-9]/g, "");
}

export function isValidInviteCode(value: unknown): value is string {
  const code = normalizeInviteCode(value);
  return code.length === INVITE_CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c) || c === "I");
}

export type InviteStatus = "active" | "expired" | "revoked" | "used";

export interface InviteRecordLike {
  expiresAt?: unknown;
  revokedAt?: unknown;
  maxUses?: unknown;
  usedCount?: unknown;
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  const obj = value as { toMillis?: () => number; toDate?: () => Date; _seconds?: number; seconds?: number };
  if (typeof obj.toMillis === "function") return obj.toMillis();
  if (typeof obj.toDate === "function") return obj.toDate().getTime();
  const secs = obj._seconds ?? obj.seconds;
  return typeof secs === "number" ? secs * 1000 : null;
}

/**
 * Revoked beats expired beats used up: the reason shown is the one the admin acted on, then the
 * one time acted on, then the one the colleagues acted on.
 */
export function inviteStatus(record: InviteRecordLike, now: Date = new Date()): InviteStatus {
  if (record.revokedAt) return "revoked";
  const exp = toMillis(record.expiresAt);
  if (exp !== null && exp <= now.getTime()) return "expired";
  const max = typeof record.maxUses === "number" ? record.maxUses : 1;
  const used = typeof record.usedCount === "number" ? record.usedCount : 0;
  if (max > 0 && used >= max) return "used";
  return "active";
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** The path part of the link, so the page and the route agree on it. */
export function inviteLinkPath(code: string): string {
  return `/join/${normalizeInviteCode(code)}`;
}

export function inviteLinkFor(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${inviteLinkPath(code)}`;
}

/** The message the admin forwards on WhatsApp. Role names come already localised. */
export function inviteShareText(
  input: { clinicName: string; roleLabel: string; link: string; days?: number },
  language: "en" | "ar"
): string {
  const days = input.days ?? INVITE_TTL_DAYS;
  if (language === "ar") {
    return `أهلاً! ده رابط انضمامك لفريق ${input.clinicName} على نظام ألفا بصفة ${input.roleLabel}.\n\nافتح الرابط وسجّل دخول أو اعمل حساب وهتدخل على طول:\n${input.link}\n\nالرابط شغال لمدة ${days} أيام.`;
  }
  return `Hi! Here's your link to join the ${input.clinicName} team on Alpha as ${input.roleLabel}.\n\nOpen it, sign in or create an account, and you're in:\n${input.link}\n\nThe link works for ${days} days.`;
}
