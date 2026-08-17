/**
 * Builds the demo clinic used for help-article screenshots.
 *
 *   node scripts/seed-demo-clinic.mjs --dry-run        # print the plan, write nothing
 *   node scripts/seed-demo-clinic.mjs                  # write it
 *   node scripts/seed-demo-clinic.mjs --owner-email=you@example.com
 *
 * The clinic is a normal tenant alongside the real one — the app is already multi-tenant, so
 * nothing about the live clinic is touched. Access is granted to the signed-in owner's existing
 * account rather than a new login, so no account is created and no password goes anywhere.
 *
 * Every document written carries `__demo: true`, which is what makes
 * `node scripts/delete-demo-clinic.mjs` able to remove exactly this data and nothing else.
 *
 * Re-running is safe: an existing demo clinic is emptied and rebuilt, keeping its id so any
 * screenshot showing the Clinic ID stays accurate.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  BRANCHES,
  CLINIC_INFO,
  CLINIC_NAME,
  CLINIC_PROFILE,
  DEMO_MARKER,
  INVENTORY,
  JOIN_REQUESTS,
  ONLINE_BOOKING,
  PATIENTS,
  PATIENT_SOURCES,
  SCHEDULE,
  SERVICES,
  STAFF,
  VISIT_REASONS,
} from "./demo-clinic-data.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const ownerEmailArg = process.argv.find((a) => a.startsWith("--owner-email="))?.split("=")[1];

// ---------------------------------------------------------------------------- env + admin setup

/** Minimal .env.local reader — the app itself relies on Next to load this file. */
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function adminDb() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .trim();

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  // Named "default" — see the comment in firebase.json. It is not the conventional "(default)".
  return getFirestore(getApps()[0], "default");
}

// ------------------------------------------------------------------------------------- helpers

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function dayOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Friday is the clinic's day off — normal for Egypt, and it keeps the calendar from looking
 * machine-generated. The exception is when the seed itself runs on a Friday: a demo clinic whose
 * busiest screen (today's schedule) is empty on the day you photograph it is useless, so on those
 * runs the clinic simply opens seven days and the schedule setting is written to match.
 */
const OFF_DOW = new Date().getDay() === 5 ? -1 : 5;
const OFF_DAYS = OFF_DOW === -1 ? [] : ["Friday"];

const isOffDay = (days) => dayOffset(days).getDay() === OFF_DOW;

/**
 * Deterministic pseudo-randomness. A fixed seed means re-running the script reproduces the same
 * clinic, so a screenshot re-taken next month still matches the one beside it.
 */
let seed = 20260814;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

async function deleteCollection(db, ref, label) {
  let removed = 0;
  for (;;) {
    const snap = await ref.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
  }
  if (removed) console.log(`   cleared ${removed} from ${label}`);
  return removed;
}

// ---------------------------------------------------------------------------------------- main

async function main() {
  loadEnvLocal();
  const db = adminDb();

  console.log(`\nProject : ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Mode    : ${DRY_RUN ? "DRY RUN — nothing will be written" : "WRITE"}\n`);

  // --- who owns it -----------------------------------------------------------------------
  let ownerId = null;
  let ownerLabel = "";

  if (ownerEmailArg) {
    const snap = await db.collection("users").where("email", "==", ownerEmailArg.toLowerCase()).limit(1).get();
    if (snap.empty) throw new Error(`No user document found with email ${ownerEmailArg}`);
    ownerId = snap.docs[0].id;
    ownerLabel = `${snap.docs[0].data().name || "(unnamed)"} <${ownerEmailArg}>`;
  } else {
    // Fall back to whoever owns an existing non-demo clinic — for a single-operator project
    // that is the person running this script.
    const clinics = await db.collection("clinics").get();
    const real = clinics.docs.filter((d) => !d.data()[DEMO_MARKER] && d.data().ownerId);
    if (real.length === 0) {
      throw new Error("Could not infer an owner. Pass --owner-email=you@example.com");
    }
    ownerId = real[0].data().ownerId;
    const userSnap = await db.collection("users").doc(ownerId).get();
    ownerLabel = `${userSnap.data()?.name || "(unnamed)"} <${userSnap.data()?.email || ownerId}>`;
    console.log(`Owner inferred from existing clinic "${real[0].data().name}"`);
  }
  console.log(`Owner   : ${ownerLabel}\n`);

  // --- reuse or create the clinic --------------------------------------------------------
  const existing = await db.collection("clinics").where(DEMO_MARKER, "==", true).get();
  let clinicId;

  if (!existing.empty) {
    clinicId = existing.docs[0].id;
    console.log(`Reusing existing demo clinic: ${clinicId}`);
    if (!DRY_RUN) {
      for (const sub of [
        "patients", "appointments", "ledger", "clinical_notes", "services",
        "inventory", "staff", "attendance", "notifications", "system_logs",
      ]) {
        await deleteCollection(db, db.collection(`clinics/${clinicId}/${sub}`), sub);
      }
      const oldReqs = await db.collection("join_requests").where("clinicId", "==", clinicId).get();
      if (!oldReqs.empty) {
        const b = db.batch();
        oldReqs.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
        console.log(`   cleared ${oldReqs.size} join_requests`);
      }
    }
  } else {
    clinicId = db.collection("clinics").doc().id;
    console.log(`Creating new demo clinic: ${clinicId}`);
  }

  const plan = [];
  const batchOps = [];
  const add = (ref, data) => batchOps.push({ ref, data });

  // --- clinic + owner grant ---------------------------------------------------------------
  add(db.collection("clinics").doc(clinicId), {
    name: CLINIC_NAME,
    ownerId,
    // Premium so inventory, attendance, WhatsApp and every AI page are visible — a demo clinic
    // on the Free Trial would hide most of what the articles need to show.
    subscriptionTier: "Premium",
    status: "Active",
    createdAt: FieldValue.serverTimestamp(),
    [DEMO_MARKER]: true,
  });
  plan.push("1 clinic document (Premium tier)");

  add(db.collection("users").doc(ownerId), {
    clinicRoles: { [clinicId]: "Admin" },
  });
  plan.push("1 role grant on your existing account (merge — your other clinics are untouched)");

  // --- settings ----------------------------------------------------------------------------
  const S = (id) => db.doc(`clinics/${clinicId}/settings/${id}`);
  add(S("clinic_info"), {
    ...CLINIC_INFO,
    schedule: { ...SCHEDULE, offDays: OFF_DAYS, configuredAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
    [DEMO_MARKER]: true,
  });
  add(S("clinicProfile"), { ...CLINIC_PROFILE, updatedAt: new Date().toISOString(), [DEMO_MARKER]: true });
  add(S("patient_sources"), { sources: PATIENT_SOURCES, [DEMO_MARKER]: true });
  add(S("visit_reasons"), { reasons: VISIT_REASONS, [DEMO_MARKER]: true });
  add(S("counters"), { patientId: 1000 + PATIENTS.length, [DEMO_MARKER]: true });
  add(S("locations"), { branches: BRANCHES, updatedAt: new Date().toISOString(), [DEMO_MARKER]: true });
  add(S("onlineBooking"), { ...ONLINE_BOOKING, [DEMO_MARKER]: true });
  plan.push("7 settings documents (clinic info, profile, sources, visit reasons, counters, branches & rooms, online booking)");

  // --- staff + their user documents --------------------------------------------------------
  const ownerStaffId = db.collection(`clinics/${clinicId}/staff`).doc().id;
  add(db.doc(`clinics/${clinicId}/staff/${ownerStaffId}`), {
    name: CLINIC_INFO.doctorName,
    email: CLINIC_INFO.email,
    role: "Admin",
    uid: ownerId,
    isDentist: true,
    permissions: [],
    createdAt: FieldValue.serverTimestamp(),
    [DEMO_MARKER]: true,
  });

  const dentists = [{ name: CLINIC_INFO.doctorName, id: ownerStaffId }];
  for (const member of STAFF) {
    const uid = `demo-${member.key}-${clinicId.slice(0, 6)}`;
    const staffId = db.collection(`clinics/${clinicId}/staff`).doc().id;

    add(db.doc(`clinics/${clinicId}/staff/${staffId}`), {
      name: member.name,
      email: member.email,
      role: member.role,
      uid,
      isDentist: member.isDentist,
      permissions: member.permissions,
      createdAt: FieldValue.serverTimestamp(),
      [DEMO_MARKER]: true,
    });

    // A matching user document is what makes the person appear on the Users screen. There is no
    // Firebase Auth account behind it, so these logins cannot be used — correct for a demo.
    add(db.collection("users").doc(uid), {
      uid,
      name: member.name,
      email: member.email,
      role: member.role,
      staffId,
      clinicRoles: { [clinicId]: member.role },
      isDentist: member.isDentist,
      permissions: member.permissions,
      createdAt: FieldValue.serverTimestamp(),
      [DEMO_MARKER]: true,
    });

    if (member.isDentist) dentists.push({ name: member.name, id: staffId });
  }
  plan.push(`${STAFF.length + 1} staff records + ${STAFF.length} user documents`);

  // --- join requests -------------------------------------------------------------------------
  for (const req of JOIN_REQUESTS) {
    const d = dayOffset(-req.daysAgo);
    add(db.collection("join_requests").doc(), {
      clinicId,
      userId: `demo-applicant-${req.email.split("@")[0]}`,
      name: req.name,
      email: req.email,
      userName: req.name,
      userEmail: req.email,
      status: "pending",
      createdAt: d,
      requestedAt: d,
      [DEMO_MARKER]: true,
    });
  }
  plan.push(`${JOIN_REQUESTS.length} pending join requests`);

  // --- services --------------------------------------------------------------------------------
  const serviceRefs = [];
  for (const svc of SERVICES) {
    const id = db.collection(`clinics/${clinicId}/services`).doc().id;
    serviceRefs.push({ id, ...svc });
    add(db.doc(`clinics/${clinicId}/services/${id}`), {
      name: svc.name,
      price: svc.price,
      requiresLab: svc.requiresLab === true,
      estimatedLabFee: svc.estimatedLabFee ?? 0,
      durationMinutes: svc.durationMinutes,
      createdAt: new Date().toISOString(),
      [DEMO_MARKER]: true,
    });
  }
  plan.push(`${SERVICES.length} services with prices`);

  // --- inventory -------------------------------------------------------------------------------
  for (const item of INVENTORY) {
    add(db.collection(`clinics/${clinicId}/inventory`).doc(), {
      name: item.name,
      category: item.category,
      subCategory: "",
      stock: item.stock,
      minStock: item.minStock,
      costPerUnit: item.costPerUnit,
      unit: item.unit,
      isPercentage: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      [DEMO_MARKER]: true,
    });
  }
  const lowStock = INVENTORY.filter((i) => i.stock < i.minStock).length;
  plan.push(`${INVENTORY.length} inventory items (${lowStock} below reorder threshold)`);

  // --- patients ---------------------------------------------------------------------------------
  const patientRefs = [];
  PATIENTS.forEach((p, i) => {
    const id = db.collection(`clinics/${clinicId}/patients`).doc().id;
    patientRefs.push({ id, name: p.name, phone: p.phone });
    add(db.doc(`clinics/${clinicId}/patients/${id}`), {
      fileId: `PT-${1001 + i}`,
      name: p.name,
      phone: p.phone,
      address: "Nasr City, Cairo",
      dateOfBirth: p.dob,
      gender: p.gender,
      source: PATIENT_SOURCES[p.sourceIdx],
      allergies: i % 9 === 0 ? "Penicillin" : "",
      medicalHistory: i % 7 === 0 ? "Hypertension — controlled" : "",
      status: i < 4 ? "New" : "Active",
      createdAt: dayOffset(-randInt(5, 400)),
      teethData: {},
      [DEMO_MARKER]: true,
    });
  });
  plan.push(`${PATIENTS.length} patients`);

  // --- appointments, procedures, money -----------------------------------------------------------
  const STATUS_PAST = ["Completed", "Completed", "Completed", "Completed", "No Show", "Cancelled"];
  const STATUS_TODAY = ["Completed", "Completed", "In Chair", "Checked In", "Confirmed", "Confirmed", "Scheduled"];
  const TIMES = ["09:00", "09:30", "10:00", "11:00", "12:00", "13:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

  let appts = 0;
  let ledgers = 0;
  let payments = 0;
  let notes = 0;
  let outstanding = 0;

  const makeAppointment = (dayDelta, status, timeIdx) => {
    const date = dayOffset(dayDelta);
    const patient = pick(patientRefs);
    const service = pick(serviceRefs);
    const dentist = pick(dentists);
    const apptId = db.collection(`clinics/${clinicId}/appointments`).doc().id;
    const dateStr = ymd(date);
    const time = TIMES[timeIdx % TIMES.length];

    // A dentist works one branch per day (alternating), so the same person is never booked in
    // two branches at the same hour. Rooms rotate within the day's branch.
    const dentistIdx = Math.max(0, dentists.findIndex((d) => d.id === dentist.id));
    const branch = BRANCHES[(dentistIdx + Math.abs(dayDelta)) % BRANCHES.length];
    const room = branch.rooms[randInt(0, branch.rooms.length - 1)];

    add(db.doc(`clinics/${clinicId}/appointments/${apptId}`), {
      patientId: patient.id,
      patientName: patient.name,
      treatment: service.name,
      doctor: dentist.name,
      doctorId: dentist.id,
      date: dateStr,
      time,
      duration: service.durationMinutes,
      branchId: branch.id,
      branchName: branch.name,
      roomId: room.id,
      roomName: room.name,
      type: service.name === "Consultation" ? "consult" : "treatment",
      notes: "",
      cost: service.price,
      serviceId: service.id,
      serviceName: service.name,
      listPrice: service.price,
      discountMode: "none",
      discountAmount: 0,
      status,
      statusHistory: [{ status, at: date.toISOString(), modifiedBy: CLINIC_INFO.doctorName }],
      addedBy: "Mariam Adel",
      createdAt: dayOffset(dayDelta - randInt(1, 10)),
      [DEMO_MARKER]: true,
    });
    appts++;

    // Only work that actually happened becomes a charge.
    if (status !== "Completed") return;

    // Most bills are settled at the desk; a deliberate few are left part-paid so the Collect
    // Dues screen and the outstanding-balance reports have real rows to show.
    const roll = rand();
    const paid = roll < 0.62 ? service.price : roll < 0.85 ? Math.round(service.price * 0.5) : 0;
    if (paid < service.price) outstanding += service.price - paid;

    /**
     * A charge and a payment are two separate ledger rows — that is how the app records them and
     * how it reads them back. `lib/revenueRecovery.rowAmount` measures a "procedure" row by its
     * `amount` and a "payment" row by its `paid`, and both the debtors list and the dashboard's
     * cash-basis Daily Income ignore procedure rows entirely.
     *
     * Writing a `paid` value onto the procedure row instead — the obvious-looking shortcut — is
     * invisible to every one of those screens: the clinic reads as having billed everything and
     * collected nothing, and Daily Income sits at zero on a day full of finished treatments.
     */
    const ledgerId = db.collection(`clinics/${clinicId}/ledger`).doc().id;
    add(db.doc(`clinics/${clinicId}/ledger/${ledgerId}`), {
      patientId: patient.id,
      patientName: patient.name,
      type: "procedure",
      category: "Treatment",
      amount: service.price,
      cost: service.price,
      description: service.name,
      date: dateStr,
      appointmentId: apptId,
      paid: 0,
      createdAt: date,
      createdBy: "system",
      [DEMO_MARKER]: true,
    });
    ledgers++;

    if (paid > 0) {
      add(db.collection(`clinics/${clinicId}/ledger`).doc(), {
        patientId: patient.id,
        patientName: patient.name,
        type: "payment",
        date: dateStr,
        amount: 0,
        paid,
        description: `Payment for ${service.name}`,
        procedureId: ledgerId,
        createdAt: date,
        createdBy: "system",
        addedBy: "Mariam Adel",
        receivedBy: "Mariam Adel",
        [DEMO_MARKER]: true,
      });
      payments++;
    }

    const noteId = db.collection(`clinics/${clinicId}/clinical_notes`).doc().id;
    add(db.doc(`clinics/${clinicId}/clinical_notes/${noteId}`), {
      patientId: patient.id,
      appointmentId: apptId,
      tooth: pick(["11", "16", "21", "26", "36", "37", "46", "Gen"]),
      procedure: service.name,
      procedures: [service.name],
      cost: service.price,
      unitCost: service.price,
      unitsCount: 1,
      pricingFormula: `${service.price}*1`,
      note: "",
      doctor: dentist.name,
      doctorId: dentist.id,
      date: dateStr,
      status: "Completed",
      ledgerId,
      [DEMO_MARKER]: true,
    });
    notes++;
  };

  // Eight weeks of history so the reports and revenue charts have a trend to draw.
  for (let d = -56; d < 0; d++) {
    if (isOffDay(d)) continue;
    const count = randInt(3, 8);
    for (let i = 0; i < count; i++) makeAppointment(d, pick(STATUS_PAST), i);
  }
  // Today, mid-shift: some done, one in the chair, the rest still to come. Always written, so the
  // dashboard and today's schedule have content on the day the screenshots are taken.
  STATUS_TODAY.forEach((status, i) => makeAppointment(0, status, i));
  // Two weeks ahead so the calendar is not empty when you scroll forward.
  for (let d = 1; d <= 14; d++) {
    if (isOffDay(d)) continue;
    const count = randInt(2, 6);
    for (let i = 0; i < count; i++) makeAppointment(d, pick(["Confirmed", "Scheduled", "Confirmed"]), i);
  }

  plan.push(`${appts} appointments across 8 weeks past + 2 weeks ahead, spread over ${BRANCHES.length} branches`);
  plan.push(`${ledgers} charges + ${payments} payments in the ledger, ${notes} clinical notes`);
  plan.push(`~EGP ${outstanding.toLocaleString()} left outstanding (for the Collect Dues screen)`);

  // --- report ----------------------------------------------------------------------------------
  console.log("Plan:");
  plan.forEach((p) => console.log(`  · ${p}`));
  console.log(`\nTotal documents: ${batchOps.length}`);

  if (DRY_RUN) {
    console.log("\nDry run — nothing written. Drop --dry-run to apply.\n");
    return;
  }

  console.log("\nWriting…");
  for (let i = 0; i < batchOps.length; i += 400) {
    const batch = db.batch();
    for (const op of batchOps.slice(i, i + 400)) batch.set(op.ref, op.data, { merge: true });
    await batch.commit();
    process.stdout.write(`  ${Math.min(i + 400, batchOps.length)}/${batchOps.length}\r`);
  }

  console.log(`\n\nDone.\n`);
  console.log(`Clinic ID : ${clinicId}`);
  console.log(`Sign in as ${ownerLabel.split("<")[1]?.replace(">", "") || "the owner"} and pick`);
  console.log(`"${CLINIC_NAME}" from the clinic switcher at the top of the sidebar.\n`);
  console.log(`To remove it all again: node scripts/delete-demo-clinic.mjs\n`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message, "\n");
  process.exit(1);
});
