/**
 * Audit entries the Activity Logs screen cannot show, and optionally give them a date.
 *
 *   node scripts/find-undated-logs.mjs             # look only
 *   node scripts/find-undated-logs.mjs --apply     # stamp them
 *
 * The screen orders by `timestamp`, and Firestore excludes documents that do not carry the field
 * being ordered on. So an entry written without one is not merely last in the list — it is absent,
 * with nothing on screen to say so. That is the one thing an audit trail must never do.
 *
 * Every writer in the app sets `timestamp: serverTimestamp()` (lib/logger.ts, lib/serverLogger.ts,
 * lib/server/systemLog.ts), so anything found here predates that or came in through a restore.
 *
 * `--apply` stamps a missing timestamp from the row's own `date` field where it has one, and from
 * the document's creation time otherwise. It never overwrites a timestamp that is already there,
 * and it records `timestampBackfilled: true` so a reader can tell a reconstructed time from one
 * that was recorded when the thing actually happened.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");

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

async function main() {
  loadEnvLocal();
  const db = adminDb();
  const clinics = await db.collection("clinics").listDocuments();
  console.log(`${APPLY ? "APPLYING" : "LOOKING"} — ${clinics.length} clinic(s)\n`);

  let found = 0;
  let stamped = 0;
  const empty = [];

  for (const clinic of clinics) {
    // Read ids and data without ordering, so entries missing the field are actually returned —
    // ordering by `timestamp` is precisely what hides them.
    const snap = await clinic.collection("system_logs").get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (data.timestamp) continue;

      // An entry with no action is not an audit record that lost its date — it carries nothing at
      // all. Stamping one would put a blank row in the trail, which is worse than the gap.
      if (!data.action) {
        empty.push(`${clinic.id}/${doc.id}  (created ${doc.createTime?.toDate?.().toISOString() || "unknown"})`);
        continue;
      }

      found += 1;
      const when = data.date
        ? new Date(`${String(data.date)}T12:00:00Z`)
        : doc.createTime?.toDate?.() || null;

      console.log(`${clinic.id}/${doc.id}`);
      console.log(`   action : ${data.action || "(none)"}`);
      console.log(`   user   : ${data.userName || data.user || "(none)"}`);
      console.log(`   date   : ${data.date || "(none)"}`);
      console.log(`   created: ${doc.createTime?.toDate?.().toISOString() || "(unknown)"}`);
      console.log(`   ${APPLY ? "stamping" : "would stamp"} with: ${when ? when.toISOString() : "NOTHING — no date and no creation time"}`);
      console.log("");

      if (APPLY && when) {
        await doc.ref.update({
          timestamp: Timestamp.fromDate(when),
          // So nobody later reads a reconstructed time as a recorded one.
          timestampBackfilled: true,
        });
        stamped += 1;
      }
    }
  }

  console.log(`${found} real entr(ies) with no timestamp; ${APPLY ? `${stamped} stamped` : "none changed"}.`);
  if (empty.length) {
    console.log(`\n${empty.length} document(s) carrying nothing at all — left alone:`);
    for (const line of empty) console.log(`   ${line}`);
    console.log("   Deleting from an audit collection is a superadmin decision, not this script's.");
  }
  if (!APPLY && found > 0) console.log("\nRe-run with --apply to stamp them.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
