/**
 * Check that the AI credits screen's new month query actually runs.
 *
 *   node scripts/probe-ai-usage-log.mjs
 *
 * The screen used to fetch the newest 300 `ai_usage_log` events across all time and filter them to
 * the chosen month in the browser, which is only correct while a clinic has fewer than 300 events
 * in total. Past that, picking an older month showed an empty table while the breakdown above it
 * reported hundreds of credits.
 *
 * The replacement puts a range on `createdAt` and orders by the same field, which Firestore serves
 * from the automatic single-field index — no composite index to deploy. That is the claim this
 * script tests, against the real database, rather than trusting the documentation: a range plus an
 * orderBy on a *different* field is exactly the shape that fails with FAILED_PRECONDITION, and the
 * failure would only appear in a clinic's browser.
 *
 * It also reports what each clinic's log actually holds per month, so the fix can be seen to
 * matter (or not) for the data that exists today.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

/** The same bounds the screen computes for a "YYYY-MM" key. */
function monthBounds(key) {
  const [y, m] = key.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

async function main() {
  loadEnvLocal();
  const db = adminDb();
  const clinics = await db.collection("clinics").listDocuments();
  console.log(`${clinics.length} clinic(s)\n`);

  let probed = 0;
  let failed = 0;

  for (const clinic of clinics) {
    const usage = await clinic.collection("ai_usage").get();
    const log = await clinic.collection("ai_usage_log").count().get();
    const logCount = log.data().count;
    if (usage.empty && logCount === 0) continue;

    console.log(`clinic ${clinic.id} — ${logCount} logged event(s), ${usage.size} month doc(s)`);

    const monthKeys = usage.docs.map((d) => d.id).filter((id) => /^\d{4}-\d{2}$/.test(id)).sort().reverse();
    if (monthKeys.length === 0) monthKeys.push(new Date().toISOString().slice(0, 7));

    for (const key of monthKeys) {
      const { start, end } = monthBounds(key);
      try {
        const snap = await clinic
          .collection("ai_usage_log")
          .where("createdAt", ">=", Timestamp.fromDate(start))
          .where("createdAt", "<", Timestamp.fromDate(end))
          .orderBy("createdAt", "desc")
          .limit(300)
          .get();
        probed += 1;

        // What the old code would have shown for this month: the newest 300 overall, then filtered.
        const newest = await clinic
          .collection("ai_usage_log")
          .orderBy("createdAt", "desc")
          .limit(300)
          .get();
        const oldWouldShow = newest.docs.filter((d) => {
          const ms = d.data().createdAt?.toMillis?.() || 0;
          return ms >= start.getTime() && ms < end.getTime();
        }).length;

        const total = usage.docs.find((d) => d.id === key)?.data()?.creditsUsed ?? 0;
        const flag = oldWouldShow < snap.size ? `  <-- the old screen showed ${oldWouldShow} of these` : "";
        console.log(`  ${key}: ${snap.size} row(s) in range, ${total} credit(s) counted${flag}`);
      } catch (err) {
        failed += 1;
        console.log(`  ${key}: QUERY REFUSED — ${err.message}`);
      }
    }
    console.log("");
  }

  console.log(
    failed === 0
      ? `The month-range query ran on every month probed (${probed}). No composite index needed.`
      : `${failed} of ${probed + failed} probes were refused — the query needs an index after all.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
