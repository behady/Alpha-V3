// Firestore security rules regression tests, run against the local emulator.
//
// Usage:
//   npm run test:rules
//
// Covers the privilege-escalation fixes in firestore.rules:
//  - clinics/{id}: tier/status/pricing writes are superadmin-only
//  - users/{id}: a user can never self-grant isSuperAdmin or edit their own clinicRoles
//  - join_requests: can't file as another user; approving can only change `status`
//
// And the multi-tenant guarantee the whole product rests on:
//  - one clinic can never read or write another clinic's patients, money or records
//  - clinic_secrets (WhatsApp tokens) are unreachable from any client, including the clinic's own
//  - server-only subcollections cannot be written from a browser
//  - an unauthenticated visitor sees nothing (this is why public booking runs through API routes)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, setLogLevel } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesPath = join(__dirname, "..", "firestore.rules");

const [emulatorHost, emulatorPort] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

setLogLevel("error");

let passed = 0;
let failed = 0;

async function check(name, promise, expect) {
  try {
    if (expect === "allow") {
      await assertSucceeds(promise);
    } else {
      await assertFails(promise);
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-alpha-dental-rules-test",
    firestore: {
      rules: readFileSync(rulesPath, "utf8"),
      host: emulatorHost,
      port: Number(emulatorPort),
    },
  });

  // --- Seed data (bypassing rules) ---
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "clinics/clinicA"), {
      name: "Clinic A",
      ownerId: "owner1",
      subscriptionTier: "Free Trial",
      status: "Active",
    });
    await setDoc(doc(db, "users/admin1"), {
      clinicRoles: { clinicA: "Admin" },
    });
    await setDoc(doc(db, "users/assistant1"), {
      clinicRoles: { clinicA: "Assistant" },
    });
    await setDoc(doc(db, "users/super1"), {
      isSuperAdmin: true,
    });
    await setDoc(doc(db, "users/rando1"), {
      clinicRoles: {},
    });
    await setDoc(doc(db, "users/self1"), {
      clinicRoles: {},
    });
    await setDoc(doc(db, "join_requests/req1"), {
      clinicId: "clinicA",
      userId: "rando1",
      status: "Pending",
    });
    await setDoc(doc(db, "clinics/clinicA/system_logs/log1"), {
      action: "Patient created",
      userName: "admin1",
    });
    await setDoc(doc(db, "clinics/clinicA/staff/staffDoc1"), {
      name: "Dr. Ahmed",
      commissionPercentage: 40,
    });
    await setDoc(doc(db, "clinics/clinicA/settings/whatsapp"), {
      templates: [],
    });

    // --- A second, unrelated clinic, and the data one must never see of the other ---
    await setDoc(doc(db, "clinics/clinicB"), {
      name: "Clinic B",
      ownerId: "ownerB",
      subscriptionTier: "Pro",
      status: "Active",
    });
    await setDoc(doc(db, "users/adminB"), { clinicRoles: { clinicB: "Admin" } });
    // Belongs to both — multi-clinic access has to keep working, or the fix is too blunt.
    await setDoc(doc(db, "users/multi1"), {
      clinicRoles: { clinicA: "Assistant", clinicB: "Admin" },
    });

    await setDoc(doc(db, "clinics/clinicA/patients/patA1"), {
      name: "Mona",
      phone: "+201000000001",
      balance: 1200,
    });
    await setDoc(doc(db, "clinics/clinicA/ledger/ledA1"), {
      patientId: "patA1",
      type: "payment",
      paid: 400,
    });
    await setDoc(doc(db, "clinics/clinicA/appointments/apptA1"), {
      patientId: "patA1",
      date: "2026-08-20",
      time: "02:00 PM",
    });
    await setDoc(doc(db, "clinics/clinicA/clinical_notes/noteA1"), {
      patientId: "patA1",
      procedure: "Crown",
    });
    await setDoc(doc(db, "clinics/clinicA/attendance/attA1"), {
      userId: "assistant1",
      status: "active",
    });
    await setDoc(doc(db, "clinics/clinicA/whatsapp_logs/waA1"), {
      patientId: "patA1",
      message: "Your appointment is tomorrow",
    });
    await setDoc(doc(db, "clinics/clinicA/message_drafts/draftA1"), {
      patientId: "patA1",
      phone: "+201000000001",
      body: "We miss you",
      status: "pending_review",
    });
    await setDoc(doc(db, "clinics/clinicA/ai_pending_actions/actA1"), {
      kind: "whatsapp",
      status: "pending",
    });
    await setDoc(doc(db, "clinics/clinicA/ai_deletion_log/delA1"), {
      collection: "ledger",
      documentId: "ledA1",
    });
    await setDoc(doc(db, "clinics/clinicB/patients/patB1"), { name: "Youssef" });

    // The WhatsApp gateway credentials. Whoever holds this token can message every patient in
    // the clinic's name, so no client may read it — not staff, not the Admin, not a superadmin.
    await setDoc(doc(db, "clinic_secrets/clinicA"), {
      wapilot: { instanceId: "inst_A", apiToken: "SECRET_TOKEN_A" },
    });
  });

  const admin1 = testEnv.authenticatedContext("admin1").firestore();
  const assistant1 = testEnv.authenticatedContext("assistant1").firestore();
  const super1 = testEnv.authenticatedContext("super1").firestore();
  const rando1 = testEnv.authenticatedContext("rando1").firestore();
  const self1 = testEnv.authenticatedContext("self1").firestore();
  const newu1 = testEnv.authenticatedContext("newu1").firestore();
  const newu2 = testEnv.authenticatedContext("newu2").firestore();
  const adminB = testEnv.authenticatedContext("adminB").firestore();
  const multi1 = testEnv.authenticatedContext("multi1").firestore();
  const anon = testEnv.unauthenticatedContext().firestore();

  console.log("clinics/{clinicId}");
  await check(
    "clinic Admin cannot change own clinic's subscriptionTier",
    updateDoc(doc(admin1, "clinics/clinicA"), { subscriptionTier: "Premium" }),
    "deny"
  );
  await check(
    "superadmin can change any clinic's subscriptionTier",
    updateDoc(doc(super1, "clinics/clinicA"), { subscriptionTier: "Premium" }),
    "allow"
  );
  await check(
    "random authed user cannot create a clinic doc directly",
    setDoc(doc(rando1, "clinics/newClinic1"), {
      name: "x",
      ownerId: "rando1",
      subscriptionTier: "Free Trial",
      status: "Active",
    }),
    "deny"
  );
  await check(
    "clinic Admin can still write their own clinic profile subdoc",
    setDoc(doc(admin1, "clinics/clinicA/settings/clinicProfile"), { phone: "123" }),
    "allow"
  );

  console.log("users/{userId}");
  await check(
    "user cannot self-grant isSuperAdmin",
    updateDoc(doc(self1, "users/self1"), { isSuperAdmin: true }),
    "deny"
  );
  await check(
    "user cannot self-edit clinicRoles",
    updateDoc(doc(self1, "users/self1"), { clinicRoles: { clinicB: "Admin" } }),
    "deny"
  );
  await check(
    "user can edit unrelated fields on own doc",
    updateDoc(doc(self1, "users/self1"), { defaultClinicId: "clinicA" }),
    "allow"
  );
  await check(
    "superadmin can grant isSuperAdmin on another user",
    updateDoc(doc(super1, "users/self1"), { isSuperAdmin: true }),
    "allow"
  );
  await check(
    "new user can self-provision with empty clinicRoles",
    setDoc(doc(newu1, "users/newu1"), { uid: "newu1", clinicRoles: {} }),
    "allow"
  );
  await check(
    "new user cannot self-provision as superadmin",
    setDoc(doc(newu2, "users/newu2"), { uid: "newu2", isSuperAdmin: true }),
    "deny"
  );

  console.log("join_requests/{requestId}");
  await check(
    "user cannot file a join request impersonating another userId",
    setDoc(doc(rando1, "join_requests/spoofed1"), {
      clinicId: "clinicA",
      userId: "someoneElse",
      status: "Pending",
    }),
    "deny"
  );
  await check(
    "user can file a join request as themselves",
    setDoc(doc(rando1, "join_requests/own1"), {
      clinicId: "clinicA",
      userId: "rando1",
      status: "Pending",
    }),
    "allow"
  );
  await check(
    "clinic Admin approving a request may change only status",
    updateDoc(doc(admin1, "join_requests/req1"), { status: "Approved" }),
    "allow"
  );
  await check(
    "clinic Admin cannot rewrite a request's clinicId while approving",
    updateDoc(doc(admin1, "join_requests/req1"), { clinicId: "clinicB" }),
    "deny"
  );

  console.log("clinics/{clinicId}/system_logs/{logId}");
  await check(
    "clinic member can read the audit log",
    getDoc(doc(admin1, "clinics/clinicA/system_logs/log1")),
    "allow"
  );
  await check(
    "non-member cannot read the audit log",
    getDoc(doc(rando1, "clinics/clinicA/system_logs/log1")),
    "deny"
  );
  await check(
    "clinic member can append a new log entry",
    setDoc(doc(admin1, "clinics/clinicA/system_logs/log2"), { action: "Payment recorded", userName: "admin1" }),
    "allow"
  );
  await check(
    "non-member cannot append a log entry",
    setDoc(doc(rando1, "clinics/clinicA/system_logs/log3"), { action: "spoofed", userName: "rando1" }),
    "deny"
  );
  await check(
    "even a clinic Admin cannot edit an existing log entry",
    updateDoc(doc(admin1, "clinics/clinicA/system_logs/log1"), { action: "tampered" }),
    "deny"
  );
  await check(
    "even a clinic Admin cannot delete a log entry",
    deleteDoc(doc(admin1, "clinics/clinicA/system_logs/log1")),
    "deny"
  );
  await check(
    "superadmin can edit a log entry",
    updateDoc(doc(super1, "clinics/clinicA/system_logs/log1"), { action: "corrected by support" }),
    "allow"
  );

  console.log("clinics/{clinicId}/staff/{staffId}");
  await check(
    "clinic Admin can edit a staff record",
    updateDoc(doc(admin1, "clinics/clinicA/staff/staffDoc1"), { commissionPercentage: 45 }),
    "allow"
  );
  await check(
    "a non-Admin clinic member cannot edit a staff record (e.g. their own commission)",
    updateDoc(doc(assistant1, "clinics/clinicA/staff/staffDoc1"), { commissionPercentage: 99 }),
    "deny"
  );
  await check(
    "a non-Admin clinic member can still read staff records",
    getDoc(doc(assistant1, "clinics/clinicA/staff/staffDoc1")),
    "allow"
  );

  console.log("clinics/{clinicId}/settings/{docId}");
  await check(
    "clinic Admin can edit clinic settings",
    updateDoc(doc(admin1, "clinics/clinicA/settings/whatsapp"), { templates: ["x"] }),
    "allow"
  );
  await check(
    "a non-Admin clinic member cannot edit clinic settings",
    updateDoc(doc(assistant1, "clinics/clinicA/settings/whatsapp"), { templates: ["hijacked"] }),
    "deny"
  );

  // =====================================================================
  // The multi-tenant guarantee. If any of these fail, nothing else matters.
  // =====================================================================
  console.log("cross-clinic isolation");
  const otherClinicsData = [
    ["patients", "clinics/clinicA/patients/patA1"],
    ["ledger", "clinics/clinicA/ledger/ledA1"],
    ["appointments", "clinics/clinicA/appointments/apptA1"],
    ["clinical notes", "clinics/clinicA/clinical_notes/noteA1"],
    ["attendance", "clinics/clinicA/attendance/attA1"],
    ["WhatsApp logs", "clinics/clinicA/whatsapp_logs/waA1"],
    ["staff", "clinics/clinicA/staff/staffDoc1"],
    ["settings", "clinics/clinicA/settings/whatsapp"],
    ["audit log", "clinics/clinicA/system_logs/log1"],
  ];
  for (const [label, path] of otherClinicsData) {
    await check(`another clinic's Admin cannot read clinic A's ${label}`, getDoc(doc(adminB, path)), "deny");
  }
  await check(
    "another clinic's Admin cannot write into clinic A's ledger",
    setDoc(doc(adminB, "clinics/clinicA/ledger/injected1"), { type: "payment", paid: 999 }),
    "deny"
  );
  await check(
    "another clinic's Admin cannot delete clinic A's patient",
    deleteDoc(doc(adminB, "clinics/clinicA/patients/patA1")),
    "deny"
  );
  await check(
    "another clinic's Admin cannot edit clinic A's patient",
    updateDoc(doc(adminB, "clinics/clinicA/patients/patA1"), { phone: "+20999" }),
    "deny"
  );

  // Positive controls — isolation is worthless if it also breaks legitimate access.
  await check(
    "clinic A's own member CAN read clinic A's patients",
    getDoc(doc(assistant1, "clinics/clinicA/patients/patA1")),
    "allow"
  );
  await check(
    "a user belonging to both clinics can read clinic A",
    getDoc(doc(multi1, "clinics/clinicA/patients/patA1")),
    "allow"
  );
  await check(
    "a user belonging to both clinics can read clinic B",
    getDoc(doc(multi1, "clinics/clinicB/patients/patB1")),
    "allow"
  );

  console.log("clinic_secrets/{clinicId} — WhatsApp credentials");
  await check(
    "a clinic's own Admin cannot read its stored WhatsApp token",
    getDoc(doc(admin1, "clinic_secrets/clinicA")),
    "deny"
  );
  await check(
    "a clinic's own Admin cannot write clinic secrets",
    setDoc(doc(admin1, "clinic_secrets/clinicA"), { wapilot: { instanceId: "x", apiToken: "y" } }),
    "deny"
  );
  await check(
    "another clinic's Admin cannot read them",
    getDoc(doc(adminB, "clinic_secrets/clinicA")),
    "deny"
  );
  await check(
    "not even a superadmin can read them from a client",
    getDoc(doc(super1, "clinic_secrets/clinicA")),
    "deny"
  );
  await check(
    "an unauthenticated visitor cannot read them",
    getDoc(doc(anon, "clinic_secrets/clinicA")),
    "deny"
  );

  console.log("server-only subcollections");
  await check(
    "staff can read the AI action queue",
    getDoc(doc(admin1, "clinics/clinicA/ai_pending_actions/actA1")),
    "allow"
  );
  await check(
    "nobody can write a staged AI action from the browser (approval would be meaningless)",
    updateDoc(doc(admin1, "clinics/clinicA/ai_pending_actions/actA1"), { status: "approved" }),
    "deny"
  );
  await check(
    "staff can read the AI deletion log",
    getDoc(doc(admin1, "clinics/clinicA/ai_deletion_log/delA1")),
    "allow"
  );
  await check(
    "nobody can erase evidence from the AI deletion log",
    deleteDoc(doc(admin1, "clinics/clinicA/ai_deletion_log/delA1")),
    "deny"
  );
  await check(
    "staff can read the outbound message queue",
    getDoc(doc(admin1, "clinics/clinicA/message_drafts/draftA1")),
    "allow"
  );
  await check(
    "nobody can change a draft's recipient after it was reviewed",
    updateDoc(doc(admin1, "clinics/clinicA/message_drafts/draftA1"), { phone: "+20111" }),
    "deny"
  );

  // The public booking page reads nothing directly for exactly this reason. If someone ever
  // "fixes" that page by loosening these rules, these four fail and say so.
  console.log("unauthenticated visitors");
  await check("cannot read a clinic's patients", getDoc(doc(anon, "clinics/clinicA/patients/patA1")), "deny");
  await check("cannot read clinic settings", getDoc(doc(anon, "clinics/clinicA/settings/whatsapp")), "deny");
  await check("cannot read appointments", getDoc(doc(anon, "clinics/clinicA/appointments/apptA1")), "deny");
  await check(
    "cannot create an appointment",
    setDoc(doc(anon, "clinics/clinicA/appointments/spoofed1"), { date: "2026-08-21" }),
    "deny"
  );

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exitCode = 1;
});
