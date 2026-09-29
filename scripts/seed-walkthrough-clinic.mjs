/**
 * Gives a clinic created on camera enough life to be worth filming.
 *
 *   node scripts/seed-walkthrough-clinic.mjs --clinic <id> [--dry-run]
 *
 * The walkthrough's first minute creates a clinic through the real onboarding form, which is the
 * shot that matters — and it leaves a clinic with no patients, no prices and an empty day. The
 * next ten minutes are spent adding a dentist, a patient, an appointment, a payment: those beats
 * must land on a screen that already looks like a practice, not a blank one, or every "and here
 * you see" points at nothing.
 *
 * So this writes a SMALL clinic: the price list, two dentists and a receptionist, a dozen
 * patients, a week of appointments with a few today, and enough ledger rows that the dashboard
 * shows money and a couple of patients owe something. Deliberately smaller than the demo clinic —
 * a practice that opened a fortnight ago, not one that has run for two months.
 *
 * Marked `__walkthrough`, NOT `__demo`: every other seeder finds the demo clinic with a
 * `where(__demo == true).limit(1)`, and a second document carrying that marker would make those
 * scripts pick whichever Firestore returns first. Clean-up is promo-clean-clinic.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { BRANCHES, ONLINE_BOOKING, PATIENTS, PATIENT_SOURCES, SCHEDULE, SERVICES, VISIT_REASONS } from "./demo-clinic-data.mjs";

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

loadEnvLocal();
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "")
        .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim(),
    }),
  });
}
// This project's Firestore database is named "default", not "(default)".
const db = getFirestore(getApps()[0], "default");

export const MARK = "__walkthrough";
const DRY = process.argv.includes("--dry-run");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

const DAY = 24 * 60 * 60 * 1000;
/** Local calendar date, not UTC: the app stores the clinic's own day, and Cairo is ahead of UTC. */
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return new Date(d.getTime() + days * DAY);
}

/** Two dentists and a receptionist. The dentist the walkthrough adds on camera is a third. */
const STAFF = [
  { name: "Dr. Omar Sherif", email: "omar@walkthrough.example", role: "Dentist", isDentist: true,
    permissions: ["access.patients", "access.appointments", "access.reports"] },
  { name: "Dr. Hana Mostafa", email: "hana@walkthrough.example", role: "Dentist", isDentist: true,
    permissions: ["access.patients", "access.appointments", "access.reports"] },
  { name: "Mariam Adel", email: "mariam@walkthrough.example", role: "Receptionist", isDentist: false,
    permissions: ["access.patients", "access.appointments", "access.finance"] },
];

/** A fortnight of appointments: today is busy enough to look real, the week around it is spread. */
const APPOINTMENT_TIMES = ["09:00", "09:30", "10:00", "11:00", "12:00", "13:00", "16:00", "17:00", "18:00"];

async function main() {
  const clinicId = arg("clinic");
  if (!clinicId) throw new Error("Pass --clinic <id> — the clinic created on camera.");

  const clinicRef = db.collection("clinics").doc(clinicId);
  const clinicSnap = await clinicRef.get();
  if (!clinicSnap.exists) throw new Error(`No clinic ${clinicId}`);
  const clinic = clinicSnap.data();
  if (clinic.__demo) throw new Error("That is the demo clinic — it has its own seeders.");

  const ownerId = clinic.ownerId;
  const ownerSnap = await db.collection("users").doc(ownerId).get();
  const ownerName = ownerSnap.data()?.name || "Owner";

  console.log(`Clinic : ${clinic.name} (${clinicId})`);
  console.log(`Owner  : ${ownerName}`);
  console.log(`Mode   : ${DRY ? "DRY RUN" : "WRITE"}\n`);

  const writes = [];
  const add = (ref, data) => writes.push({ ref, data });

  // ---- settings -------------------------------------------------------------------------
  const S = (id) => db.doc(`clinics/${clinicId}/settings/${id}`);
  // Merged, not replaced: the onboarding form and the setup wizard already wrote clinic_info,
  // and the name the user typed on camera must survive.
  add(S("clinic_info"), { schedule: { ...SCHEDULE, offDays: ["Friday"], configuredAt: new Date().toISOString() }, updatedAt: new Date().toISOString(), [MARK]: true });
  add(S("patient_sources"), { sources: PATIENT_SOURCES, [MARK]: true });
  add(S("visit_reasons"), { reasons: VISIT_REASONS, [MARK]: true });
  add(S("locations"), { branches: [BRANCHES[0]], updatedAt: new Date().toISOString(), [MARK]: true });
  // Online booking on from the start: part 5 of the walkthrough books through the public page.
  add(S("onlineBooking"), { ...ONLINE_BOOKING, [MARK]: true });
  const branch = BRANCHES[0];

  // ---- staff ----------------------------------------------------------------------------
  const ownerStaffId = db.collection(`clinics/${clinicId}/staff`).doc().id;
  add(db.doc(`clinics/${clinicId}/staff/${ownerStaffId}`), {
    name: ownerName, email: ownerSnap.data()?.email || "", role: "Admin", uid: ownerId, isDentist: true,
    permissions: [], createdAt: FieldValue.serverTimestamp(), [MARK]: true,
  });
  const dentists = [{ id: ownerStaffId, name: ownerName }];
  for (const m of STAFF) {
    const uid = `walk-${m.name.split(" ").pop().toLowerCase()}-${clinicId.slice(0, 6)}`;
    const staffId = db.collection(`clinics/${clinicId}/staff`).doc().id;
    add(db.doc(`clinics/${clinicId}/staff/${staffId}`), {
      name: m.name, email: m.email, role: m.role, uid, isDentist: m.isDentist,
      permissions: m.permissions, createdAt: FieldValue.serverTimestamp(), [MARK]: true,
    });
    // The user document is what puts the person on the Users screen. No Auth account behind it.
    add(db.collection("users").doc(uid), {
      uid, name: m.name, email: m.email, role: m.role, clinicRoles: { [clinicId]: m.role },
      defaultClinicId: clinicId, createdAt: FieldValue.serverTimestamp(), [MARK]: true,
    });
    if (m.isDentist) dentists.push({ id: staffId, name: m.name });
  }

  // ---- services -------------------------------------------------------------------------
  const services = [];
  for (const svc of SERVICES) {
    const id = db.collection(`clinics/${clinicId}/services`).doc().id;
    services.push({ id, ...svc });
    add(db.doc(`clinics/${clinicId}/services/${id}`), {
      name: svc.name, price: svc.price, requiresLab: svc.requiresLab === true,
      estimatedLabFee: svc.estimatedLabFee ?? 0, durationMinutes: svc.durationMinutes,
      createdAt: new Date().toISOString(), [MARK]: true,
    });
  }

  // ---- patients -------------------------------------------------------------------------
  const patients = [];
  PATIENTS.slice(0, 12).forEach((p, i) => {
    const id = db.collection(`clinics/${clinicId}/patients`).doc().id;
    patients.push({ id, name: p.name, phone: p.phone });
    add(db.doc(`clinics/${clinicId}/patients/${id}`), {
      fileId: `PT-${1001 + i}`, name: p.name, phone: p.phone, address: "Nasr City, Cairo",
      dateOfBirth: p.dob, gender: p.gender, source: PATIENT_SOURCES[p.sourceIdx],
      allergies: "", medicalHistory: "", status: i < 3 ? "New" : "Active",
      createdAt: dayOffset(-(2 + i)), teethData: {}, [MARK]: true,
    });
  });
  add(S("counters"), { patientId: 1000 + patients.length, [MARK]: true });

  // ---- appointments + ledger -------------------------------------------------------------
  let appts = 0, charges = 0, payments = 0, outstanding = 0;
  const todayIso = localIso(dayOffset(0));
  for (let day = -10; day <= 4; day++) {
    const date = dayOffset(day);
    if (date.getDay() === 5) continue; // Friday off
    const count = day === 0 ? 5 : day < 0 ? 3 : 2;
    for (let k = 0; k < count; k++) {
      const patient = patients[(appts * 7 + k) % patients.length];
      const svc = services[(appts + k) % services.length];
      const dentist = dentists[(appts + k) % dentists.length];
      const time = APPOINTMENT_TIMES[(k * 2 + (day + 10)) % APPOINTMENT_TIMES.length];
      const dateStr = localIso(date);
      const past = day < 0 || (day === 0 && k < 2);
      const status = past ? "Completed" : day === 0 ? (k === 2 ? "Confirmed" : "Scheduled") : "Scheduled";
      const apptId = db.collection(`clinics/${clinicId}/appointments`).doc().id;
      add(db.doc(`clinics/${clinicId}/appointments/${apptId}`), {
        patientId: patient.id, patientName: patient.name, treatment: svc.name,
        doctor: dentist.name, doctorId: dentist.id, date: dateStr, time,
        duration: svc.durationMinutes, branchId: branch.id, branchName: branch.name,
        roomId: branch.rooms[k % branch.rooms.length].id, roomName: branch.rooms[k % branch.rooms.length].name,
        type: svc.name === "Consultation" ? "consult" : "treatment", notes: "", status,
        createdAt: date, [MARK]: true,
      });
      appts++;

      if (!past) continue;
      // A charge and a payment are two ledger rows; the money screens read them separately.
      const ledgerId = db.collection(`clinics/${clinicId}/ledger`).doc().id;
      add(db.doc(`clinics/${clinicId}/ledger/${ledgerId}`), {
        patientId: patient.id, patientName: patient.name, type: "procedure", category: "Treatment",
        amount: svc.price, cost: svc.price, description: svc.name, date: dateStr, appointmentId: apptId,
        paid: 0, createdAt: date, createdBy: "system", [MARK]: true,
      });
      charges++;
      // Most pay in full, some pay half, one in five pays nothing yet — so Collect Dues has rows.
      const paidShare = k % 5 === 4 ? 0 : k % 3 === 2 ? 0.5 : 1;
      const paid = Math.round(svc.price * paidShare);
      outstanding += svc.price - paid;
      if (paid > 0) {
        add(db.collection(`clinics/${clinicId}/ledger`).doc(), {
          patientId: patient.id, patientName: patient.name, type: "payment", date: dateStr, amount: 0, paid,
          description: `Payment for ${svc.name}`, procedureId: ledgerId, createdAt: date, createdBy: "system",
          addedBy: "Mariam Adel", receivedBy: "Mariam Adel", [MARK]: true,
        });
        payments++;
      }
    }
  }

  console.log(`  ${STAFF.length + 1} staff, ${services.length} services, ${patients.length} patients`);
  console.log(`  ${appts} appointments (${todayIso} has 5), ${charges} charges, ${payments} payments, EGP ${outstanding.toLocaleString()} outstanding`);
  console.log(`  ${writes.length} documents`);

  if (DRY) { console.log("\nDry run — nothing written."); return; }

  let batch = db.batch(), n = 0;
  for (const w of writes) {
    batch.set(w.ref, w.data, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log("\nDone.");
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
