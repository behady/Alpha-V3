/**
 * Read-only: are AI x-ray reports being saved, and were credits charged for them?
 *
 *   node scripts/probe-xray-reports.mjs
 *
 * Written when the user reported that reports "do not get saved". The route writes the report
 * BEFORE it charges credits, so the two collections together say which half failed: a report
 * with no log row means the charge failed, a log row with no report means the write did.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey,
      }),
    });
  }
  // This project's Firestore database is NAMED "default", not the unnamed "(default)" one.
  return getFirestore(getApps()[0], "default");
}

loadEnvLocal();
const db = adminDb();

const reports = await db.collectionGroup("xray_reports").get();
console.log("xray_reports docs:", reports.size);
for (const d of reports.docs) {
  const x = d.data();
  console.log(
    " -", d.ref.path,
    "| patient:", x.patientId,
    "| created:", x.createdAt?.toDate?.()?.toISOString(),
    "| teeth:", x.report?.teeth?.length,
    "| boxes:", (x.report?.teeth || []).filter((t) => t.box).length,
    "| by:", x.createdByName
  );
}

const logs = await db.collectionGroup("ai_usage_log").where("feature", "==", "xray_report").get();
console.log("ai_usage_log xray_report rows:", logs.size);
for (const d of logs.docs) {
  const x = d.data();
  console.log(
    " -", d.ref.parent.parent?.id, x.createdAt?.toDate?.()?.toISOString(),
    x.credits, "cr |", x.detail, "| model", x.model,
    "| in", x.inputTokens, "out", x.outputTokens, "thoughts", x.thoughtTokens
  );
}
