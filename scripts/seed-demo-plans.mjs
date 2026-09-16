/**
 * Gives demo patients an agreed treatment plan.
 *
 *   node scripts/seed-demo-plans.mjs [--dry-run]
 *
 * `seed-demo-clinic.mjs` writes clinical notes and ledger rows — what was already DONE — but no
 * `treatment_plans`, which is what was AGREED. So the Treatment Plan tab reads "no plan yet" on a
 * patient with nineteen visits and a five-figure history, which is the one tab a dentist opens to
 * see where the money is going next.
 *
 * Plans are written `accepted`: a draft nobody approved is not a plan, it is a quote.
 *
 * Every document carries `__demo: true`, so `delete-demo-clinic.mjs` removes it with the rest.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { DEMO_MARKER } from "./demo-clinic-data.mjs";
import { STAR_PATIENT } from "./promo-chapters.mjs";

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
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** Shapes of plan, cycled over the patients that get one. */
const TEMPLATES = [
  {
    title: "خطة علاج — تركيبات وحشو",
    description: "تركيبة زيركون على الضرس المكسور، وحشو تجميلي للسن الأمامي، وتنظيف قبل البدء.",
    visits: [
      { label: "الزيارة الأولى — تنظيف وتحضير", inDays: 0, steps: [
        { serviceName: "Scaling & Polishing", teeth: "—", quantity: 1, unitPrice: 600, estimatedMinutes: 30 },
        { serviceName: "Composite Filling", teeth: "21", quantity: 1, unitPrice: 800, estimatedMinutes: 45 },
      ]},
      { label: "الزيارة التانية — تحضير التركيبة", inDays: 10, steps: [
        { serviceName: "Zirconia Crown", teeth: "36", quantity: 1, unitPrice: 4500, estimatedMinutes: 60 },
      ]},
      { label: "الزيارة التالتة — التركيب", inDays: 24, steps: [
        { serviceName: "Crown Fitting", teeth: "36", quantity: 1, unitPrice: 0, estimatedMinutes: 30 },
      ]},
    ],
  },
  {
    title: "خطة علاج — علاج عصب وتركيبة",
    description: "علاج عصب للضرس السفلي على جلستين، وبعدها تركيبة بورسلين.",
    visits: [
      { label: "الزيارة الأولى — فتح العصب", inDays: 0, steps: [
        { serviceName: "Root Canal — Molar", teeth: "46", quantity: 1, unitPrice: 2500, estimatedMinutes: 60 },
      ]},
      { label: "الزيارة التانية — حشو العصب", inDays: 7, steps: [
        { serviceName: "Root Canal — Second Visit", teeth: "46", quantity: 1, unitPrice: 0, estimatedMinutes: 60 },
      ]},
      { label: "الزيارة التالتة — التركيبة", inDays: 21, steps: [
        { serviceName: "PFM Crown", teeth: "46", quantity: 1, unitPrice: 3000, estimatedMinutes: 60 },
      ]},
    ],
  },
  {
    title: "خطة علاج — تجميل الأسنان الأمامية",
    description: "تبييض بالليزر، وبعده فينير على الأربع أسنان الأمامية العلوية.",
    visits: [
      { label: "الزيارة الأولى — تبييض", inDays: 0, steps: [
        { serviceName: "Teeth Whitening", teeth: "—", quantity: 1, unitPrice: 3500, estimatedMinutes: 60 },
      ]},
      { label: "الزيارة التانية — تحضير الفينير", inDays: 14, steps: [
        { serviceName: "E.max Veneer", teeth: "11,12,21,22", quantity: 4, unitPrice: 4000, estimatedMinutes: 90 },
      ]},
    ],
  },
];

/** How many patients get a plan. Not all of them: a clinic where everyone has one is a fiction. */
const HOW_MANY = 9;

function buildPlan(template, patient, doctorName) {
  const visits = template.visits.map((v, i) => ({
    id: `v${i + 1}`,
    label: v.label,
    date: iso(v.inDays),
    time: "",
    steps: v.steps.map((s, j) => ({
      id: `v${i + 1}s${j + 1}`,
      // No serviceId: these are written against the service NAME, which is what the tab renders.
      // A wrong id would be worse than none — it would point at a service that is not this one.
      serviceId: "",
      serviceName: s.serviceName,
      teeth: s.teeth,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      estimatedMinutes: s.estimatedMinutes,
      note: "",
    })),
  }));

  const total = visits.reduce(
    (sum, v) => sum + v.steps.reduce((a, s) => a + s.unitPrice * s.quantity, 0),
    0
  );

  return {
    patientId: patient.id,
    patientName: patient.name,
    title: template.title,
    description: template.description,
    // Accepted, not draft: a plan nobody approved is a quote, and the money screens are built on
    // what the patient agreed to.
    status: "accepted",
    source: "manual",
    currency: "EGP",
    visits,
    total,
    doctorName,
    createdAt: new Date(Date.now() - 3 * DAY),
    [DEMO_MARKER]: true,
  };
}

async function main() {
  const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
  if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
  const clinicId = demo.docs[0].id;

  const all = (await db.collection(`clinics/${clinicId}/patients`).get()).docs
    .map((d) => ({ id: d.id, name: d.data().name }));
  /**
   * The patient the record chapter opens goes first, always. Taking the first N in document order
   * left him without a plan, and the chapter then narrated "the plan you agreed" over an empty
   * tab — the failure is silent, because every OTHER patient had one.
   */
  const patients = [
    ...all.filter((p) => p.name === STAR_PATIENT.name),
    ...all.filter((p) => p.name !== STAR_PATIENT.name),
  ];
  const staff = (await db.collection(`clinics/${clinicId}/staff`).get()).docs.map((d) => d.data().name);
  const dentists = staff.filter((n) => String(n || "").startsWith("Dr"));

  // Replace any previous run's plans rather than stacking a second copy on the same patients.
  const existing = await db.collection(`clinics/${clinicId}/treatment_plans`).where(DEMO_MARKER, "==", true).get();
  if (!DRY) for (const doc of existing.docs) await doc.ref.delete();

  console.log(`Demo clinic : ${clinicId}`);
  console.log(`Cleared     : ${existing.size} previous demo plan(s)\n`);

  let n = 0;
  for (const patient of patients.slice(0, HOW_MANY)) {
    const template = TEMPLATES[n % TEMPLATES.length];
    const doctorName = dentists[n % Math.max(1, dentists.length)] || "Dr. Omar Sherif";
    const plan = buildPlan(template, patient, doctorName);
    console.log(`  ${String(patient.name).padEnd(22)} ${template.title.padEnd(32)} ${plan.visits.length} visits  EGP ${plan.total.toLocaleString()}`);
    if (!DRY) await db.collection(`clinics/${clinicId}/treatment_plans`).add(plan);
    n++;
  }

  console.log(DRY ? "\nDry run — nothing written." : `\nDone. ${n} accepted plans.`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
