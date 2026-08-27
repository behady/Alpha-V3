// Every money and clinical write must name the clinic it belongs to.
//
// The routes fall back to `resolveUserClinicId(uid, null)` when a request names no clinic, and that
// is the caller's `defaultClinicId` — or, failing that, whichever key `Object.keys(clinicRoles)[0]`
// happens to hand back. Six of the seven write paths never sent one, so a procedure logged at a
// second clinic was priced against the FIRST clinic's price list, attributed to its staff, and
// written into its records. The only symptom on screen was "Choose the dentist who performed this
// treatment" — because the dentist in the dropdown belonged to the clinic being looked at, and the
// server was searching a different one.
//
// The fix is that the API client attaches it, not that six call sites remember to. These
// assertions are what stops it being unpicked back into a per-call-site duty.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const moneyApi = readFileSync(join(REPO, "src/lib/moneyApi.ts"), "utf8");

// --- the client attaches it, once, for everything -----------------------------------------------

assert.ok(
  /const clinicId = body\.clinicId \?\? currentClinicId\(\)/.test(moneyApi),
  "moneyApi's POST helper must default the clinic from the active one"
);
assert.ok(
  /clinicId \? \{ \.\.\.body, clinicId \} : body/.test(moneyApi),
  "the resolved clinic must actually reach the request body"
);

// An explicit clinic in the body still wins — the superadmin panel and any tool acting on another
// clinic must keep working.
assert.ok(
  moneyApi.indexOf("body.clinicId ??") < moneyApi.indexOf("currentClinicId()"),
  "an explicitly passed clinicId must take precedence over the active one"
);

// The read that decides what a delete will destroy is scoped too: a preview naming the wrong
// tenant describes an appointment that is not the one about to be deleted.
assert.ok(
  /const resolved = clinicId \?\? currentClinicId\(\)/.test(moneyApi),
  "previewAppointmentDelete must default to the clinic on screen"
);

// --- the source it reads from is the one the rest of the app writes to -----------------------------

const dbUtils = readFileSync(join(REPO, "src/lib/db-utils.ts"), "utf8");
assert.ok(
  /export function currentClinicId\(\): string \| null/.test(dbUtils),
  "currentClinicId is the non-throwing reader the API client needs"
);
// It must be the SAME global ClinicProvider sets and every Firestore path is built from. A second
// source of truth for 'which clinic am I in' is the whole bug, wearing a different hat.
assert.ok(
  /export function setGlobalClinicId/.test(dbUtils) && /return globalClinicId;/.test(dbUtils),
  "currentClinicId must read the global ClinicProvider sets, not a copy of it"
);

const clinicContext = readFileSync(join(REPO, "src/context/ClinicContext.tsx"), "utf8");
assert.ok(
  /setGlobalClinicId\(/.test(clinicContext),
  "ClinicProvider must publish the active clinic, or the API client has nothing to read"
);

// --- the route still refuses a clinic the caller has no role in -------------------------------------

// Defaulting client-side is a convenience, never an authorisation. The server must keep checking.
const adminClinicDb = readFileSync(join(REPO, "src/lib/adminClinicDb.ts"), "utf8");
assert.ok(
  /You do not have access to that clinic\./.test(adminClinicDb),
  "resolveUserClinicId must still reject a clinic the caller holds no role in"
);

console.log("✓ clinicScoping: every money write names its clinic, from one source");
