/**
 * Marks up the dental charts of the demo clinic's patients.
 *
 *   node scripts/seed-demo-teeth.mjs [--dry-run]
 *
 * `seed-demo-clinic.mjs` writes clinical notes and ledger rows, but never `teethData` — so the
 * chart screen draws a full set of pristine teeth and reports "0 affected / no diagnoses" for a
 * patient with nineteen visits behind them. The chart is the most recognisable screen in the
 * product; showing it blank undersells it and, worse, contradicts the record beside it.
 *
 * `teethData` is a plain map on the patient document keyed by FDI number:
 *   { "16": { statuses: ["caries_moderate"], notes: "..." } }
 * The ids come from `src/lib/diagnosisCatalog.ts` and are the same strings the Android app
 * resolves, so they cannot be invented here — see the catalogue before adding to PATTERNS.
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

/**
 * A few plausible mouths, cycled across the patient list.
 *
 * Deliberately varied in severity: a chart where every patient has the same three fillings looks
 * generated, and a chart with a finding on every tooth looks like a catastrophe rather than a
 * practice. Restorations outnumber active disease, which is what a real recall list looks like.
 */
const PATTERNS = [
  {
    "16": { statuses: ["rest_composite"], notes: "حشو كومبوزيت — أوكلوزال" },
    "26": { statuses: ["caries_moderate"], notes: "تسوس متوسط، محتاج حشو" },
    "36": { statuses: ["rest_crown"], notes: "تاج PFM" },
    "11": { statuses: ["wear_attrition"] },
  },
  {
    "14": { statuses: ["rest_amalgam"] },
    "15": { statuses: ["caries_incipient"], notes: "بداية تسوس — متابعة" },
    "46": { statuses: ["rest_crown"], notes: "تاج زيركون" },
    "47": { statuses: ["pulp_reversible"], notes: "حساسية بعد الحشو" },
    "21": { statuses: ["rest_composite"] },
  },
  {
    "18": { statuses: ["dev_impaction_partial"], notes: "ضرس عقل مطمور جزئياً" },
    "28": { statuses: ["dev_impaction_full"] },
    "24": { statuses: ["rest_composite"] },
    "37": { statuses: ["caries_severe"], notes: "تسوس عميق — يحتاج علاج عصب" },
  },
  {
    "12": { statuses: ["rest_composite"], notes: "ترميم تجميلي" },
    "22": { statuses: ["rest_composite"] },
    "33": { statuses: ["perio_recession"], notes: "انحسار لثة" },
    "43": { statuses: ["perio_recession"] },
    "35": { statuses: ["rest_amalgam"] },
  },
  {
    "17": { statuses: ["rest_crown"] },
    "27": { statuses: ["caries_secondary"], notes: "تسوس حول الحشو القديم" },
    "45": { statuses: ["rest_implant"], notes: "زرعة + تاج" },
    "31": { statuses: ["wear_erosion"] },
  },
];

async function main() {
  const demo = await db.collection("clinics").where(DEMO_MARKER, "==", true).limit(1).get();
  if (demo.empty) throw new Error("No demo clinic found — run seed-demo-clinic.mjs first.");
  const clinicId = demo.docs[0].id;

  const patients = await db.collection(`clinics/${clinicId}/patients`).get();
  console.log(`Demo clinic : ${clinicId}`);
  console.log(`Patients    : ${patients.size}\n`);

  let i = 0;
  let touched = 0;
  for (const doc of patients.docs) {
    const pattern = PATTERNS[i % PATTERNS.length];
    const teeth = Object.keys(pattern).length;
    const findings = Object.values(pattern).filter((t) => !t.statuses[0].startsWith("rest_")).length;
    console.log(`  ${String(doc.data().name || doc.id).padEnd(22)} ${teeth} teeth marked, ${findings} active`);
    if (!DRY) await doc.ref.set({ teethData: pattern }, { merge: true });
    touched++;
    i++;
  }

  console.log(DRY ? "\nDry run — nothing written." : `\nDone. ${touched} charts marked up.`);
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
