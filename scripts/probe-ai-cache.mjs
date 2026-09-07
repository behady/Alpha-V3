/**
 * How much of our Gemini input-token bill is served from the implicit cache?
 *
 *   node scripts/probe-ai-cache.mjs
 *
 * Read-only. Reads `clinics/{id}/ai_usage/{YYYY-MM}` (the per-month counters) and
 * `ai_usage_log` (the per-charge rows, the only place tokens are split by feature),
 * and reports cached tokens as a share of billed input.
 *
 * Why it matters: Google bills cached input at a fraction of the normal rate, but only
 * caches a REPEATED PREFIX. Every price estimate for the WhatsApp receptionist depends on
 * this ratio, and guessing it from list price overstates the cost.
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
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function adminDb() {
  if (getApps().length === 0) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .trim();
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

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => n(v).toLocaleString("en-US");
const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");

async function main() {
  loadEnvLocal();
  const db = adminDb();
  const clinics = await db.collection("clinics").listDocuments();

  const grand = { input: 0, cached: 0, output: 0, thoughts: 0, apiCalls: 0 };
  const perFeature = new Map();
  const perModel = new Map();

  for (const clinic of clinics) {
    const months = await clinic.collection("ai_usage").get();
    const rows = [];

    for (const m of months.docs) {
      if (!/^\d{4}-\d{2}$/.test(m.id)) continue;
      const data = m.data() || {};
      const t = data.tokens || {};
      if (!n(t.input)) continue;
      rows.push({
        month: m.id,
        credits: n(data.creditsUsed),
        apiCalls: n(t.apiCalls),
        input: n(t.input),
        cached: n(t.cached),
        output: n(t.output),
        thoughts: n(t.thoughts),
      });
      grand.input += n(t.input);
      grand.cached += n(t.cached);
      grand.output += n(t.output);
      grand.thoughts += n(t.thoughts);
      grand.apiCalls += n(t.apiCalls);

      for (const [mk, mv] of Object.entries(data.byModel || {})) {
        const cur = perModel.get(mk) || { input: 0, cached: 0, output: 0, thoughts: 0, apiCalls: 0 };
        cur.input += n(mv.input);
        cur.cached += n(mv.cached);
        cur.output += n(mv.output);
        cur.thoughts += n(mv.thoughts);
        cur.apiCalls += n(mv.apiCalls);
        perModel.set(mk, cur);
      }
    }

    if (rows.length) {
      console.log(`\n=== clinic ${clinic.id} ===`);
      for (const r of rows) {
        console.log(
          `  ${r.month}  credits ${String(r.credits).padStart(5)}  calls ${String(r.apiCalls).padStart(5)}` +
            `  in ${fmt(r.input).padStart(11)}  cached ${fmt(r.cached).padStart(11)} (${pct(r.cached, r.input).padStart(6)})` +
            `  out ${fmt(r.output).padStart(9)}  think ${fmt(r.thoughts).padStart(8)}`
        );
      }
    }

    // Tokens are only split by feature on the log rows, never on the month doc.
    const log = await clinic.collection("ai_usage_log").get();
    for (const doc of log.docs) {
      const r = doc.data() || {};
      const f = r.feature || "unknown";
      const cur = perFeature.get(f) || { rows: 0, credits: 0, input: 0, cached: 0, output: 0, thoughts: 0, apiCalls: 0 };
      cur.rows += 1;
      cur.credits += n(r.credits);
      cur.input += n(r.inputTokens);
      cur.cached += n(r.cachedTokens);
      cur.output += n(r.outputTokens);
      cur.thoughts += n(r.thoughtTokens);
      cur.apiCalls += n(r.apiCalls);
      perFeature.set(f, cur);
    }
  }

  console.log(`\n=== ALL CLINICS ===`);
  console.log(
    `input ${fmt(grand.input)}   cached ${fmt(grand.cached)} (${pct(grand.cached, grand.input)})` +
      `   output ${fmt(grand.output)}   thoughts ${fmt(grand.thoughts)}   apiCalls ${fmt(grand.apiCalls)}`
  );

  console.log(`\n=== BY FEATURE (ai_usage_log rows) ===`);
  for (const [f, v] of [...perFeature.entries()].sort((a, b) => b[1].input - a[1].input)) {
    const perCredit = v.credits > 0 ? Math.round(v.input / v.credits) : 0;
    console.log(
      `  ${f.padEnd(18)} rows ${String(v.rows).padStart(5)}  credits ${String(v.credits).padStart(5)}` +
        `  in ${fmt(v.input).padStart(10)}  cached ${fmt(v.cached).padStart(10)} (${pct(v.cached, v.input).padStart(6)})` +
        `  out ${fmt(v.output).padStart(8)}  think ${fmt(v.thoughts).padStart(7)}  | input/credit ${fmt(perCredit)}`
    );
  }

  console.log(`\n=== BY MODEL ===`);
  for (const [m, v] of [...perModel.entries()].sort((a, b) => b[1].input - a[1].input)) {
    console.log(
      `  ${m.padEnd(26)} in ${fmt(v.input).padStart(11)}  cached ${fmt(v.cached).padStart(11)} (${pct(v.cached, v.input).padStart(6)})` +
        `  out ${fmt(v.output).padStart(9)}  think ${fmt(v.thoughts).padStart(8)}  calls ${fmt(v.apiCalls)}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
