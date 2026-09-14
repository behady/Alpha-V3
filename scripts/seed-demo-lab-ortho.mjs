/**
 * Fills the demo clinic's two remaining empty boards: Lab tracking and Orthodontics.
 *
 *   node scripts/seed-demo-lab-ortho.mjs [--dry-run]
 *
 * `seed-demo-clinic.mjs` covers the diary, the ledger and the records, but writes nothing to
 * `lab_cases` or `ortho_cases` — so both screens render their empty state on a clinic that
 * otherwise looks like it has been running for two months. Same reasoning as
 * `seed-demo-chats.mjs`: a demo is only as good as its thinnest screen.
 *
 * The lab cases are spread deliberately across the board's statuses, including one that is
 * genuinely overdue, because a board where every case is healthy demonstrates nothing — the
 * amber and red states are the reason the screen exists.
 *
 * Every document carries `__demo: true`, so `delete-demo-clinic.mjs` removes it with the rest.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { DEMO_MARKER } from "./demo-clinic-data.mjs";

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

const DRY = process.argv.includes("--dry-run");

/** Firestore rejects a write containing `undefined` outright rather than skipping the field. */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const stamp = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

/** The directory the lab screen offers when raising a case. */
const LABS = [
  { id: "lab_madina", name: "Madina Dental Lab", phone: "+201001234567", whatsapp: "+201001234567", driverName: "Sayed", turnaroundDays: 5,
    prices: { zirconia: 950, emax: 1200, pfm: 600, implant_crown: 1500, pmma: 250 } },
  { id: "lab_nile",   name: "Nile Prosthetics",  phone: "+201119876543", whatsapp: "+201119876543", driverName: "Mahmoud", turnaroundDays: 7,
    prices: { full_denture: 2200, partial_denture: 1800, cobalt_chrome: 2500, night_guard: 700 } },
];

/**
 * One case per interesting state. `sentDaysAgo`/`dueInDays` are relative to the run so the board
 * stays meaningful — a fixed due date reads as months overdue a fortnight later.
 */
const CASES = [
  { code: "NSR-0141", lab: 0, workType: "zirconia",     desc: "2 × zirconia crown, 15 & 14", units: 2, teeth: [15, 14], shade: "A2", price: 1900, status: "at_lab",         sentDaysAgo: 2, dueInDays: 3,  sentVia: "driver",  tryIn: false },
  { code: "NSR-0140", lab: 0, workType: "emax",         desc: "E.max veneer, 11",            units: 1, teeth: [11],     shade: "B1", price: 1200, status: "at_lab",         sentDaysAgo: 4, dueInDays: 1,  sentVia: "digital", tryIn: false },
  { code: "NSR-0139", lab: 1, workType: "cobalt_chrome",desc: "Upper cobalt-chrome frame",   units: 1, teeth: [],       shade: "",   price: 2500, status: "tryin_back",     sentDaysAgo: 6, dueInDays: 2,  sentVia: "driver",  tryIn: true },
  // The one that is actually late — this is the state the board exists to surface.
  { code: "NSR-0138", lab: 1, workType: "full_denture", desc: "Full upper denture",          units: 1, teeth: [],       shade: "A3", price: 2200, status: "at_lab",         sentDaysAgo: 11, dueInDays: -2, sentVia: "driver",  tryIn: true },
  { code: "NSR-0137", lab: 0, workType: "pfm",          desc: "PFM bridge, 45–47",           units: 3, teeth: [45, 46, 47], shade: "A3.5", price: 1800, status: "back",     sentDaysAgo: 8, dueInDays: -1, sentVia: "driver",  tryIn: false },
  { code: "NSR-0136", lab: 0, workType: "implant_crown",desc: "Implant crown, 36",           units: 1, teeth: [36],     shade: "A2", price: 1500, status: "fitted",         sentDaysAgo: 14, dueInDays: -7, sentVia: "digital", tryIn: false },
];

const ORTHO = [
  { status: "Active",    startMonthsAgo: 8 },
  { status: "Active",    startMonthsAgo: 14 },
  { status: "Active",    startMonthsAgo: 3 },
  { status: "Retention", startMonthsAgo: 22 },
  { status: "Completed", startMonthsAgo: 30, completedMonthsAgo: 2 },
];

async function main() {
  const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
  if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
  const clinicId = demo.docs[0].id;

  const patients = (await db.collection(`clinics/${clinicId}/patients`).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }));
  const staff = (await db.collection(`clinics/${clinicId}/staff`).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }));
  const dentists = staff.filter((s) => /dent|doctor|dr/i.test(String(s.role || "")) || String(s.name || "").startsWith("Dr"));
  const branches = (await db.doc(`clinics/${clinicId}/settings/locations`).get()).data();
  const branch = (branches?.branches || branches?.locations || [])[0] || { id: "main", name: "Main Branch — Nasr City" };

  if (patients.length < CASES.length + ORTHO.length) throw new Error("Not enough seeded patients.");

  console.log(`Demo clinic : ${clinicId}`);
  console.log(`Branch      : ${branch.name}`);
  console.log(`Dentists    : ${dentists.length || "(none matched — using first staff)"}\n`);

  const pick = (i) => patients[i % patients.length];
  const dentist = (i) => dentists[i % Math.max(1, dentists.length)] || staff[0] || { id: "s1", name: "Dr. Omar" };

  // ---- Lab -------------------------------------------------------------
  console.log("Lab directory:");
  for (const l of LABS) console.log(`  ${l.name} — ${Object.keys(l.prices).length} priced work types, ${l.turnaroundDays}d turnaround`);
  if (!DRY) {
    await db.doc(`clinics/${clinicId}/settings/labs`).set({ labs: LABS, paper: "a4_two_up", [DEMO_MARKER]: true }, { merge: true });
  }

  console.log("\nLab cases:");
  let n = 0;
  for (const c of CASES) {
    const p = pick(n + 2);
    const doc = dentist(n);
    const lab = LABS[c.lab];
    const late = c.dueInDays < 0 && (c.status === "at_lab" || c.status === "returned_to_lab");
    const row = defined({
      code: c.code,
      codeNumber: Number(c.code.split("-")[1]),
      branchCode: c.code.split("-")[0],
      branchId: branch.id,
      branchName: branch.name,
      patientId: p.id,
      patientName: p.name,
      patientFirstName: String(p.name || "").split(" ")[0],
      patientPhone: p.phone,
      doctorId: doc.id,
      doctorName: doc.name,
      labId: lab.id,
      labName: lab.name,
      workType: c.workType,
      workDescription: c.desc,
      units: c.units || undefined,
      teeth: c.teeth,
      bodyShade: c.shade || undefined,
      agreedPrice: c.price,
      sentVia: c.sentVia,
      status: c.status,
      needsTryIn: c.tryIn,
      sentAt: iso(-c.sentDaysAgo),
      dueDate: iso(c.dueInDays),
      receivedAt: ["back", "fitted", "tryin_back"].includes(c.status) ? iso(c.dueInDays) : undefined,
      fittedAt: c.status === "fitted" ? iso(c.dueInDays + 1) : undefined,
      events: [
        { at: stamp(-c.sentDaysAgo), status: "at_lab", by: doc.name },
        ...(["back", "fitted", "tryin_back"].includes(c.status) ? [{ at: stamp(c.dueInDays), status: c.status, by: doc.name }] : []),
      ],
      createdAt: stamp(-c.sentDaysAgo),
      createdBy: doc.name,
      [DEMO_MARKER]: true,
    });
    console.log(`  ${c.code}  ${String(p.name).padEnd(20)} ${c.workType.padEnd(14)} ${c.status.padEnd(12)} due ${row.dueDate}${late ? "  ← LATE" : ""}`);
    if (!DRY) await db.collection(`clinics/${clinicId}/lab_cases`).doc(c.code).set(row, { merge: true });
    n++;
  }

  // The board's next-number counter, so a case raised by hand continues the series.
  if (!DRY) {
    await db.doc(`clinics/${clinicId}/lab_counters/branches`).set(
      { [branch.id]: Math.max(...CASES.map((c) => Number(c.code.split("-")[1]))) + 1, [DEMO_MARKER]: true },
      { merge: true }
    );
  }

  // ---- Ortho -----------------------------------------------------------
  console.log("\nOrtho cases:");
  let m = 0;
  for (const o of ORTHO) {
    const p = pick(m + 11);
    const row = defined({
      patientId: p.id,
      patientName: p.name,
      patientPhone: p.phone,
      startDate: iso(-o.startMonthsAgo * 30),
      status: o.status,
      completedDate: o.completedMonthsAgo ? iso(-o.completedMonthsAgo * 30) : undefined,
      createdAt: stamp(-o.startMonthsAgo * 30),
      [DEMO_MARKER]: true,
    });
    console.log(`  ${String(p.name).padEnd(20)} ${o.status.padEnd(10)} started ${row.startDate}`);
    if (!DRY) await db.collection(`clinics/${clinicId}/ortho_cases`).add(row);
    m++;
  }

  console.log(DRY ? "\nDry run — nothing written." : `\nDone. ${CASES.length} lab cases, ${ORTHO.length} ortho cases, ${LABS.length} labs.`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
