// An invite link is a credential that fits in a WhatsApp message. These are the rules that keep
// it from being more than that: what it may grant, how long it lives, when it stops working, and
// what people can paste back without it failing on a look-alike character.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INVITABLE_ROLES,
  INVITE_CODE_LENGTH,
  INVITE_TTL_DAYS,
  generateInviteCode,
  inviteExpiry,
  inviteLinkFor,
  inviteLinkPath,
  inviteShareText,
  inviteStatus,
  isInvitableRole,
  isValidInviteCode,
  normalizeInviteCode,
} from "../src/lib/inviteLinks";

const REPO = join(import.meta.dirname, "..");

// --- what a link may grant ---------------------------------------------------------------------

assert.deepEqual([...INVITABLE_ROLES].sort(), ["Assistant", "Dentist", "Receptionist"]);
assert.equal(isInvitableRole("Admin"), false, "a forwarded message must never make an Admin");
assert.equal(isInvitableRole("Owner"), false);
assert.equal(isInvitableRole("Receptionist"), true);
assert.equal(isInvitableRole(undefined), false);

// --- codes -------------------------------------------------------------------------------------

const code = generateInviteCode();
assert.equal(code.length, INVITE_CODE_LENGTH);
assert.ok(!/[01OIL]/.test(code), "no characters that read as each other");
assert.equal(isValidInviteCode(code), true);
assert.equal(normalizeInviteCode(` ${code.toLowerCase()} `), code, "pasted lower case with spaces still resolves");
assert.equal(normalizeInviteCode("abc0"), "ABCO", "a typed zero is the letter O");
assert.equal(isValidInviteCode("short"), false);
assert.equal(isValidInviteCode(null), false);
let seq = 0;
assert.equal(generateInviteCode(() => (seq++ % 7) / 7).length, INVITE_CODE_LENGTH, "any random source works");

// --- lifetime ----------------------------------------------------------------------------------

const now = new Date("2026-09-09T12:00:00Z");
const later = new Date("2026-09-10T12:00:00Z");
assert.equal(inviteExpiry(now).getTime() - now.getTime(), INVITE_TTL_DAYS * 86400000);
assert.equal(inviteStatus({ expiresAt: later }, now), "active");
assert.equal(inviteStatus({ expiresAt: now }, now), "expired", "expiry is exclusive: at the moment, it is over");
assert.equal(inviteStatus({ expiresAt: later, usedCount: 1 }, now), "used", "single use by default");
assert.equal(inviteStatus({ expiresAt: later, usedCount: 1, maxUses: 3 }, now), "active");
assert.equal(inviteStatus({ expiresAt: later, usedCount: 3, maxUses: 3 }, now), "used");
assert.equal(inviteStatus({ expiresAt: later, revokedAt: now }, now), "revoked", "revoked wins over everything");
assert.equal(inviteStatus({ expiresAt: { _seconds: later.getTime() / 1000 } }, now), "active", "Firestore's serialized timestamp shape");
assert.equal(inviteStatus({ expiresAt: { toMillis: () => later.getTime() } }, now), "active", "Admin SDK Timestamp shape");
assert.equal(inviteStatus({ expiresAt: later.toISOString() }, now), "active", "ISO string shape");

// --- the link and the message ------------------------------------------------------------------

assert.equal(inviteLinkPath("abc2 defg hj"), "/join/ABC2DEFGHJ");
assert.equal(inviteLinkFor("https://alpha-v3-live.vercel.app/", code), `https://alpha-v3-live.vercel.app/join/${code}`);
const en = inviteShareText({ clinicName: "Nour Dental", roleLabel: "Receptionist", link: "https://x/join/A" }, "en");
assert.ok(en.includes("Nour Dental") && en.includes("Receptionist") && en.includes("https://x/join/A") && en.includes(`${INVITE_TTL_DAYS} days`));
const ar = inviteShareText({ clinicName: "عيادة النور", roleLabel: "استقبال", link: "https://x/join/A" }, "ar");
assert.ok(ar.includes("عيادة النور") && ar.includes("استقبال") && ar.includes("https://x/join/A"));

// --- wiring ------------------------------------------------------------------------------------

const accept = readFileSync(join(REPO, "src/app/api/invites/accept/route.ts"), "utf8");
assert.ok(accept.includes("runTransaction"), "use count and grant move together");
assert.ok(accept.includes("clinicPermissionsPatch(") && accept.includes("clinicPermissionsSeed("), "same permission floor as approval");
assert.ok(accept.includes("isInvitableRole("), "the stored role is re-checked before granting");
const manage = readFileSync(join(REPO, "src/app/api/invites/route.ts"), "utf8");
assert.ok(manage.includes("requireAdminUser(request, clinicId"), "admin of THIS clinic");
assert.ok(!/allow .*invites/.test(readFileSync(join(REPO, "firestore.rules"), "utf8")), "the invites collection stays server-only");
const login = readFileSync(join(REPO, "src/app/login/page.tsx"), "utf8");
assert.ok(login.includes('get("invite")') && login.includes("afterAuth()"), "login returns invitees to the join page");
const users = readFileSync(join(REPO, "src/components/settings/UserManagement.tsx"), "utf8");
assert.ok(users.includes("<InviteLinks"), "the Users screen offers the link");

console.log("inviteLinks: all assertions passed");
