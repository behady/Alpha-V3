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
    // The clinic's owner — the uid clinicA.ownerId already names. isClinicAdmin() has to answer
    // for them as well as for Admin, or introducing the role locks the person who pays for the
    // clinic out of the settings it exists to protect.
    await setDoc(doc(db, "users/owner1"), {
      clinicRoles: { clinicA: "Owner" },
    });
    await setDoc(doc(db, "users/assistant1"), {
      clinicRoles: { clinicA: "Assistant" },
      // The Assistant baseline from src/lib/permissions.ts. Every account that works in a clinic
      // now carries one of these; the routes write it and the backfill filled it in.
      clinicPermissions: {
        clinicA: [
          "access.appointments", "access.clinical", "access.inventory", "access.lab",
          "access.patients", "appointments.add", "appointments.edit", "clinical.edit",
          "dashboard.view", "inventory.add", "inventory.edit", "patients.add", "patients.edit",
        ],
      },
    });
    // Reception, given exactly one thing: add a patient. Nothing else.
    await setDoc(doc(db, "users/limited1"), {
      clinicRoles: { clinicA: "Receptionist" },
      clinicPermissions: { clinicA: ["patients.add"] },
    });
    // A member of the clinic carrying no permission map at all. Before the fallback closed, this
    // account could write anything any member could write — which was every account, because
    // nothing wrote the field.
    await setDoc(doc(db, "users/nolist1"), {
      clinicRoles: { clinicA: "Assistant" },
    });
    // An admin who has unticked every box for someone. An empty list is a decision, not a gap.
    await setDoc(doc(db, "users/empty1"), {
      clinicRoles: { clinicA: "Assistant" },
      clinicPermissions: { clinicA: [] },
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

    // The recycle bin lives at the ROOT. If it were a clinic subcollection the blanket read grant
    // would expose every deleted patient record to every clinic member — which is the whole reason
    // it is not one.
    await setDoc(doc(db, "deleted_records/entry1"), {
      clinicId: "clinicA",
      collection: "patients",
      documentId: "patA1",
      label: "Mona",
      status: "deleted",
    });
    await setDoc(doc(db, "deleted_records/entry1/payload/data"), {
      snapshot: { name: "Mona", allergies: "Penicillin", medicalHistory: "Hypertension" },
    });
    await setDoc(doc(db, "deleted_records_history/h1"), { clinicId: "clinicA", collection: "patients" });
    await setDoc(doc(db, "storage_orphans/o1"), { clinicId: "clinicA", storagePaths: ["x.jpg"] });
    await setDoc(doc(db, "clinics/clinicA/patient_media/medA1"), {
      patientId: "patA1",
      fileName: "xray.jpg",
      url: "https://example.test/o/x.jpg",
    });
    await setDoc(doc(db, "clinics/clinicA/prescriptions/rxA1"), { patientId: "patA1", drugName: "Amoxicillin" });
    await setDoc(doc(db, "clinics/clinicA/inventory/invA1"), { name: "Gloves", quantity: 10 });

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
      cost: 3000,
      sortIndex: 0,
    });
    await setDoc(doc(db, "clinics/clinicA/services/svcA1"), {
      name: "Crown",
      price: 3000,
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
    await setDoc(doc(db, "clinics/clinicA/sms_outbox/apptA1_24h"), {
      to: "+201000000001",
      text: "Reminder: your appointment is tomorrow.",
      status: "queued",
      attempts: 0,
    });
    await setDoc(doc(db, "clinics/clinicA/sms_devices/devA1"), {
      name: "Reception phone",
      platform: "android",
      lastSeenAt: "2026-08-14T05:55:00.000Z",
      enabled: true,
    });
    await setDoc(doc(db, "clinics/clinicA/leads/leadA1"), {
      name: "Mona Adel",
      phone: "+201000000900",
      source: "Meta ads",
      stage: "new",
    });
    await setDoc(doc(db, "clinics/clinicB/patients/patB1"), { name: "Youssef" });

    // The WhatsApp gateway credentials. Whoever holds this token can message every patient in
    // the clinic's name, so no client may read it — not staff, not the Admin, not a superadmin.
    await setDoc(doc(db, "clinic_secrets/clinicA"), {
      wapilot: { instanceId: "inst_A", apiToken: "SECRET_TOKEN_A" },
    });
  });

  const admin1 = testEnv.authenticatedContext("admin1").firestore();
  const owner1 = testEnv.authenticatedContext("owner1").firestore();
  const assistant1 = testEnv.authenticatedContext("assistant1").firestore();
  const super1 = testEnv.authenticatedContext("super1").firestore();
  const rando1 = testEnv.authenticatedContext("rando1").firestore();
  const self1 = testEnv.authenticatedContext("self1").firestore();
  const newu1 = testEnv.authenticatedContext("newu1").firestore();
  const newu2 = testEnv.authenticatedContext("newu2").firestore();
  const adminB = testEnv.authenticatedContext("adminB").firestore();
  const multi1 = testEnv.authenticatedContext("multi1").firestore();
  const limited1 = testEnv.authenticatedContext("limited1").firestore();
  const nolist1 = testEnv.authenticatedContext("nolist1").firestore();
  const empty1 = testEnv.authenticatedContext("empty1").firestore();
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
  // Filing goes through /api/join-requests/create on the Admin SDK, so the browser is denied
  // even when it is honest about who it is. A client write cannot check that the Clinic ID is
  // real — the rules deny reading a clinic you hold no role in, which is the very situation the
  // request exists to resolve — so a typo was accepted silently and waited on forever.
  await check(
    "user cannot file a join request from the browser, even as themselves",
    setDoc(doc(rando1, "join_requests/own1"), {
      clinicId: "clinicA",
      userId: "rando1",
      status: "pending",
    }),
    "deny"
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
    "clinic Owner can edit a staff record",
    updateDoc(doc(owner1, "clinics/clinicA/staff/staffDoc1"), { commissionPercentage: 46 }),
    "allow"
  );
  await check(
    "clinic Owner passes a permission-gated write with no stored list",
    setDoc(doc(owner1, "clinics/clinicA/patients/pOwner1"), { name: "Owner's patient" }),
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

  // The SMS queue: staff need to see what went out and what is stuck, but only the server may
  // write. If the client could, anyone could redirect a queued reminder to another number, or
  // mark an unsent one as delivered and hide that a patient was never told.
  await check(
    "staff can read the SMS queue",
    getDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h")),
    "allow"
  );
  // The clinic's own phone is the sender now, signed in as itself, so it must be able to claim a
  // message and report the outcome. What it must NOT be able to do is change who the message goes
  // to or what it says — that is the line these four checks hold.
  await check(
    "the sending phone can claim a queued message",
    updateDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h"), {
      status: "sending",
      claimedAt: "2026-08-14T06:00:00.000Z",
      claimedByDeviceId: "dev1",
      attempts: 1,
    }),
    "allow"
  );
  await check(
    "the sending phone can report a message as sent",
    updateDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h"), {
      status: "sent",
      sentAt: "2026-08-14T06:00:05.000Z",
    }),
    "allow"
  );
  await check(
    "nobody can redirect a queued text message to another number",
    updateDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h"), { to: "+20111" }),
    "deny"
  );
  await check(
    "nobody can rewrite what a queued message says",
    updateDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h"), { text: "something else" }),
    "deny"
  );
  await check(
    "nobody can smuggle a new recipient in alongside a status change",
    updateDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h"), { status: "sent", to: "+20111" }),
    "deny"
  );
  await check(
    "nobody can queue a text message from the browser",
    setDoc(doc(admin1, "clinics/clinicA/sms_outbox/forged"), { to: "+20111", text: "hi", status: "queued" }),
    "deny"
  );
  await check(
    "nobody can erase the record of a message that was sent",
    deleteDoc(doc(admin1, "clinics/clinicA/sms_outbox/apptA1_24h")),
    "deny"
  );

  // Another clinic's queue stays out of reach entirely.
  await check(
    "another clinic's Admin cannot touch this clinic's message queue",
    updateDoc(doc(adminB, "clinics/clinicA/sms_outbox/apptA1_24h"), { status: "sent" }),
    "deny"
  );

  // The phones offering to send. This is the one collection the app writes to as itself rather
  // than through the server, so the grant is deliberately wide — but "wide" needs to stop
  // somewhere, and these checks are where.
  await check(
    "the clinic's phone can post its heartbeat",
    setDoc(doc(admin1, "clinics/clinicA/sms_devices/devA1"), {
      name: "Reception phone",
      platform: "android",
      lastSeenAt: "2026-08-14T06:10:00.000Z",
      enabled: true,
    }),
    "allow"
  );
  await check(
    "staff can see which phones are collecting the queue",
    getDoc(doc(assistant1, "clinics/clinicA/sms_devices/devA1")),
    "allow"
  );
  await check(
    "another clinic's Admin cannot see this clinic's phones",
    getDoc(doc(adminB, "clinics/clinicA/sms_devices/devA1")),
    "deny"
  );
  await check(
    "another clinic's Admin cannot register a phone here",
    setDoc(doc(adminB, "clinics/clinicA/sms_devices/forged"), { name: "Not mine", enabled: true }),
    "deny"
  );
  // revokeDevice() in lib/sms/devices disables a phone rather than deleting it, on purpose: the
  // record of which phone sent this clinic's messages, and until when, is worth keeping. A rule
  // that lets the browser delete the row makes that promise unkeepable, and quietly stops every
  // reminder — hasActiveDevice() refuses to queue anything when no live heartbeat remains.
  await check(
    "a phone's record cannot be deleted from the browser, only disabled",
    deleteDoc(doc(admin1, "clinics/clinicA/sms_devices/devA1")),
    "deny"
  );

  // Leads are reception's daily work, so writing them stays open — but the marketing report is
  // only as honest as its history, and a lost lead with an awkward reason is the record most
  // worth keeping. Hence: anyone may work a lead, only an Admin may erase one.
  console.log("leads");
  await check(
    "reception can add a lead",
    setDoc(doc(assistant1, "clinics/clinicA/leads/leadA2"), {
      name: "Walk-in caller",
      phone: "+201000000901",
      source: "Phone call",
      stage: "new",
    }),
    "allow"
  );
  await check(
    "reception can move a lead along",
    updateDoc(doc(assistant1, "clinics/clinicA/leads/leadA1"), { stage: "contacted" }),
    "allow"
  );
  await check(
    "reception cannot delete a lead, only an Admin can",
    deleteDoc(doc(assistant1, "clinics/clinicA/leads/leadA1")),
    "deny"
  );
  // Deleting a lead is still Admin-only, but it now goes through /api/records/delete so the lead
  // is photographed on the way out — a lost lead with an awkward reason is the record most worth
  // keeping, and the marketing report is only as honest as its history.
  await check(
    "not even the clinic's Admin deletes a lead directly any more",
    deleteDoc(doc(admin1, "clinics/clinicA/leads/leadA1")),
    "deny"
  );
  await check(
    "another clinic's Admin cannot read this clinic's leads",
    getDoc(doc(adminB, "clinics/clinicA/leads/leadA2")),
    "deny"
  );

  // The old root-level pairing scheme is retired; anything still reaching for it gets nothing.
  await check(
    "the retired root device registry is unreachable",
    getDoc(doc(admin1, "sms_devices/devA1")),
    "deny"
  );
  await check(
    "nobody can mint themselves a pairing code from the browser",
    setDoc(doc(admin1, "sms_pairing_codes/AAAA-BBBB"), { clinicId: "clinicA" }),
    "deny"
  );

  // Money moved behind the API routes. These are the tests that prove the lock is real rather
  // than a sticker: the finance.* permissions only ever hid buttons, so until these rules landed
  // a receptionist with no finance permission could rewrite any charge through the SDK.
  console.log("money is server-only");
  await check("a member can still READ the ledger (every live screen depends on it)", getDoc(doc(assistant1, "clinics/clinicA/ledger/ledA1")), "allow");
  await check("a member cannot create a payment", setDoc(doc(assistant1, "clinics/clinicA/ledger/forged1"), { type: "payment", paid: 5000 }), "deny");
  await check("a member cannot edit a payment", updateDoc(doc(assistant1, "clinics/clinicA/ledger/ledA1"), { paid: 1 }), "deny");
  await check("a member cannot delete a payment", deleteDoc(doc(assistant1, "clinics/clinicA/ledger/ledA1")), "deny");
  // An Admin is no exception. The transaction boundaries and the arithmetic live in the routes,
  // so a direct write would bypass them whoever made it.
  await check("even a clinic Admin cannot write the ledger directly", updateDoc(doc(admin1, "clinics/clinicA/ledger/ledA1"), { paid: 1 }), "deny");
  await check("even a clinic Admin cannot delete a ledger row directly", deleteDoc(doc(admin1, "clinics/clinicA/ledger/ledA1")), "deny");

  console.log("the audit trail cannot be edited by the audited");
  await check("a member can read the audit trail", getDoc(doc(assistant1, "clinics/clinicA/ledger_audit/anything")), "allow");
  await check("a member cannot write an audit entry", setDoc(doc(assistant1, "clinics/clinicA/ledger_audit/forged1"), { action: "delete" }), "deny");
  await check("an Admin cannot erase an audit entry", deleteDoc(doc(admin1, "clinics/clinicA/ledger_audit/anything")), "deny");

  console.log("clinical notes are server-only, except the drag order");
  await check("a member can read a note", getDoc(doc(assistant1, "clinics/clinicA/clinical_notes/noteA1")), "allow");
  await check("a member cannot create a note", setDoc(doc(assistant1, "clinics/clinicA/clinical_notes/forged1"), { procedure: "Crown", cost: 9000 }), "deny");
  await check("a member cannot delete a note", deleteDoc(doc(assistant1, "clinics/clinicA/clinical_notes/noteA1")), "deny");
  await check("a member cannot change what a treatment cost", updateDoc(doc(assistant1, "clinics/clinicA/clinical_notes/noteA1"), { cost: 1 }), "deny");
  // Dragging the timeline into order moves no money and must keep working from the browser.
  await check("a member CAN reorder the timeline", updateDoc(doc(assistant1, "clinics/clinicA/clinical_notes/noteA1"), { sortIndex: 3 }), "allow");
  // ...but a drag must not be able to smuggle a price change along with the new position.
  await check(
    "a reorder cannot carry a cost change with it",
    updateDoc(doc(assistant1, "clinics/clinicA/clinical_notes/noteA1"), { sortIndex: 4, cost: 1 }),
    "deny"
  );

  console.log("the price list is admin-only");
  await check("a member can read the price list", getDoc(doc(assistant1, "clinics/clinicA/services/svcA1")), "allow");
  await check("a member cannot change a price", updateDoc(doc(assistant1, "clinics/clinicA/services/svcA1"), { price: 1 }), "deny");
  await check("a member cannot add a service", setDoc(doc(assistant1, "clinics/clinicA/services/forged1"), { name: "X", price: 1 }), "deny");
  await check("an Admin can change a price", updateDoc(doc(admin1, "clinics/clinicA/services/svcA1"), { price: 3200 }), "allow");

  // These are the checks that had no teeth. firestore.rules read `clinicPermissions[clinicId]`,
  // the app wrote a flat `permissions` array, and nothing wrote the field the rules read — so
  // `holdsPermission` fell through its "not backfilled yet" branch and returned true for every
  // permission, for every account, on every collection reached by the blanket member-write grant.
  // Unticking a box hid a button in the browser and changed nothing else.
  console.log("granular permissions are enforced, not decorative");

  await check(
    "a member with patients.add can add a patient",
    setDoc(doc(limited1, "clinics/clinicA/patients/newPat1"), { name: "Hoda" }),
    "allow"
  );
  await check(
    "the same member cannot DELETE a patient — the box is unticked",
    deleteDoc(doc(limited1, "clinics/clinicA/patients/patA1")),
    "deny"
  );
  await check(
    "...nor book an appointment they were never granted",
    setDoc(doc(limited1, "clinics/clinicA/appointments/forgedAppt1"), { date: "2026-09-01" }),
    "deny"
  );
  await check(
    "...but can still READ, because reads are not permission-gated inside a clinic",
    getDoc(doc(limited1, "clinics/clinicA/appointments/apptA1")),
    "allow"
  );

  await check(
    "an Assistant holding appointments.edit can edit one",
    updateDoc(doc(assistant1, "clinics/clinicA/appointments/apptA1"), { status: "Confirmed" }),
    "allow"
  );
  await check(
    "an Assistant cannot delete a patient — no role is granted a delete by default",
    deleteDoc(doc(assistant1, "clinics/clinicA/patients/patA1")),
    "deny"
  );

  await check(
    "a member carrying no permission map is granted nothing",
    setDoc(doc(nolist1, "clinics/clinicA/patients/forgedPat1"), { name: "Ghost" }),
    "deny"
  );
  await check(
    "an EMPTY permission map denies too — unticking every box is a decision",
    setDoc(doc(empty1, "clinics/clinicA/patients/forgedPat2"), { name: "Ghost" }),
    "deny"
  );

  await check(
    "an Admin passes without any permission map at all",
    setDoc(doc(admin1, "clinics/clinicA/patients/adminPat1"), { name: "Owner added" }),
    "allow"
  );
  // Written when the permission layer was switched on, and true then. The recycle bin changed it
  // on purpose: no client deletes a patient any more, Admin included, so that the record is always
  // recoverable. The Admin's privilege still applies — at the route, which lets them delete what
  // an unticked box would refuse.
  await check(
    "an Admin no longer deletes a patient directly — the bin owns that now",
    deleteDoc(doc(admin1, "clinics/clinicA/patients/adminPat1")),
    "deny"
  );

  // Permissions are per clinic, which is the whole reason the map is keyed by clinic id. A flat
  // array on the user document could not express this: one list applied everywhere they worked.
  await check(
    "permissions do not leak between clinics — Admin at B is not Admin at A",
    deleteDoc(doc(multi1, "clinics/clinicA/patients/patA1")),
    "deny"
  );

  // The recycle bin only means anything if the client cannot delete around it. These assertions
  // are the difference between a bin that is true and a bin that is advisory.
  console.log("deletion goes through the recycle bin, not around it");

  await check(
    "a member cannot delete a patient directly",
    deleteDoc(doc(assistant1, "clinics/clinicA/patients/patA1")),
    "deny"
  );
  await check(
    "not even a clinic Admin can delete a patient directly",
    deleteDoc(doc(admin1, "clinics/clinicA/patients/patA1")),
    "deny"
  );
  await check(
    "a member cannot delete a prescription directly",
    deleteDoc(doc(assistant1, "clinics/clinicA/prescriptions/rxA1")),
    "deny"
  );
  await check(
    "a member cannot delete a media record directly",
    deleteDoc(doc(assistant1, "clinics/clinicA/patient_media/medA1")),
    "deny"
  );
  await check(
    "a member cannot delete an inventory item directly",
    deleteDoc(doc(assistant1, "clinics/clinicA/inventory/invA1")),
    "deny"
  );

  // Everything else about those collections is unchanged — only the delete moved.
  await check(
    "a member with patients.edit can still edit a patient",
    updateDoc(doc(assistant1, "clinics/clinicA/patients/patA1"), { notes: "seen today" }),
    "allow"
  );
  await check(
    "a member can still add a patient",
    setDoc(doc(limited1, "clinics/clinicA/patients/newPat2"), { name: "Sara" }),
    "allow"
  );
  await check(
    "a member can still read a patient",
    getDoc(doc(assistant1, "clinics/clinicA/patients/patA1")),
    "allow"
  );

  console.log("the bin itself is closed to every client");

  await check("a member cannot read the bin", getDoc(doc(assistant1, "deleted_records/entry1")), "deny");
  await check("an Admin cannot read the bin", getDoc(doc(admin1, "deleted_records/entry1")), "deny");
  await check(
    "nobody can read a deleted patient's medical history from the bin payload",
    getDoc(doc(admin1, "deleted_records/entry1/payload/data")),
    "deny"
  );
  await check(
    "a member cannot forge a bin entry",
    setDoc(doc(assistant1, "deleted_records/forged1"), { clinicId: "clinicA", collection: "patients" }),
    "deny"
  );
  await check(
    "an Admin cannot erase a bin entry to hide a deletion",
    deleteDoc(doc(admin1, "deleted_records/entry1")),
    "deny"
  );
  await check(
    "the deletion history cannot be rewritten",
    setDoc(doc(admin1, "deleted_records_history/h1"), { collection: "nothing" }),
    "deny"
  );
  await check("the history cannot be read by a client", getDoc(doc(admin1, "deleted_records_history/h1")), "deny");
  await check("orphaned file paths are server-only", getDoc(doc(admin1, "storage_orphans/o1")), "deny");
  await check(
    "another clinic's Admin cannot read this clinic's bin",
    getDoc(doc(adminB, "deleted_records/entry1")),
    "deny"
  );

  console.log("money stays tenant-isolated");
  await check("another clinic's Admin cannot read this ledger", getDoc(doc(adminB, "clinics/clinicA/ledger/ledA1")), "deny");
  await check("another clinic's Admin cannot read this price list", getDoc(doc(adminB, "clinics/clinicA/services/svcA1")), "deny");

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
