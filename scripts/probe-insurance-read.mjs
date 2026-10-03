/**
 * Live probe for the MetLife approval reader: upload a scan exactly as the browser will, then ask
 * the read route what it saw.
 *
 *   node scripts/probe-insurance-read.mjs <email> <clinicId> <payerId> <filePath> [--save]
 *   npm run probe:insurance-read -- <email> <clinicId> <payerId> <filePath> [--save]
 *
 * Signs in as a real staff member (a custom token minted with the Admin SDK, then the web SDK, as
 * `probe-xray-reports-as-user.mjs` does), so the upload goes through the deployed Storage rules and
 * the route sees the same ID token a browser would send. Talks to PROBE_BASE_URL (default
 * http://localhost:3000) — start the dev server first.
 *
 * Prints the extraction, every check and the patient match. Exits 1 on a non-200 answer or when any
 * check is hard, so it can be re-run until the prompt reads the sample cleanly three times in a row.
 *
 * Writes: one file under clinics/{clinicId}/insurance_docs/{uuid}/ and, through the route, one
 * `insurance_docs` row and one usage-log row (0 credits). Never a claim, unless --save is given.
 *
 * --save: after a clean read, posts the extraction to /api/insurance/claims exactly as the confirm card
 * will (a NEW patient named as the paper prints it, status "approved"), expects 201, then posts the
 * same thing again and expects 409 naming the same claim. Run it on the demo clinic only: it leaves a
 * claim and a patient behind (delete both through the app's recycle bin), and a second run on the same
 * paper answers 409 on the first save, which this probe reports as a failure.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp as initAdmin } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getStorage, ref, uploadBytes } from "firebase/storage";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
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

/**
 * The same path `insuranceDocPath` in src/lib/storagePaths.ts produces. Copied, because that helper
 * is TypeScript and this is a plain node script; keep the two in step.
 */
function insuranceDocPath(clinicId, docId, filename) {
  const safe =
    (filename || "file")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .slice(-80)
      .replace(/^[.]+/, "") || "file";
  return `clinics/${clinicId}/insurance_docs/${docId}/${safe}`;
}

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

loadEnvLocal();
const args = process.argv.slice(2);
const save = args.includes("--save");
const [email, clinicId, payerId, filePath] = args.filter((a) => a !== "--save");
if (!email || !clinicId || !payerId || !filePath) {
  console.error("usage: node scripts/probe-insurance-read.mjs <email> <clinicId> <payerId> <filePath> [--save]");
  process.exit(1);
}
const contentType = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
if (!contentType) {
  console.error(`Unsupported file type: ${path.extname(filePath) || "(none)"} — use .pdf, .jpg, .jpeg, .png, .webp, .heic or .heif.`);
  process.exit(1);
}
const bytes = fs.readFileSync(filePath);
const baseUrl = (process.env.PROBE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

if (getApps().length === 0) {
  initAdmin({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim(),
    }),
  });
}
const user = await getAdminAuth().getUserByEmail(email);
const customToken = await getAdminAuth().createCustomToken(user.uid);

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() ||
    `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.appspot.com`,
});
const cred = await signInWithCustomToken(getAuth(app), customToken);
const idToken = await cred.user.getIdToken();

const docId = randomUUID();
const docPath = insuranceDocPath(clinicId, docId, path.basename(filePath));
console.log(`uploading ${bytes.length} bytes (${contentType}) to ${docPath}`);
await uploadBytes(ref(getStorage(app), docPath), new Uint8Array(bytes), { contentType });

const url = `${baseUrl}/api/insurance/read`;
console.log(`POST ${url}`);
const started = Date.now();
let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ clinicId, payerId, docId, docPath }),
  });
} catch (e) {
  console.error(`request failed: ${e?.message || e}`);
  process.exit(1);
}
const raw = await res.text();
console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
let body = null;
try {
  body = JSON.parse(raw);
} catch {
  console.log(raw.slice(0, 2000));
}
if (res.status !== 200 || !body?.ok) {
  if (body) console.log(JSON.stringify(body, null, 2));
  process.exit(1);
}

const { header, lines } = body.extraction;
console.log("\n--- header");
for (const [k, v] of Object.entries(header)) {
  if (k === "confidence") continue;
  const c = header.confidence?.[k];
  console.log(`${k.padEnd(18)} ${JSON.stringify(v)}${typeof c === "number" ? `  (confidence ${c})` : ""}`);
}
console.log(`\n--- lines (${lines.length})`);
lines.forEach((l, i) => {
  console.log(
    `${String(i + 1).padStart(2)}. ${l.code.padEnd(6)} units ${l.unitsRequested}/${l.unitsApproved}  gross ${l.grossPerUnit} x = ${l.grossTotal}` +
      `  approved ${l.approvedAmount}  share ${l.patientShare}  conf ${l.confidence}  ${l.description}${l.comment ? `  [${l.comment}]` : ""}`,
  );
  const w = body.wording?.[l.code];
  if (w) console.log(`    wording: ${w}`);
});

console.log(`\n--- checks (${body.checks.length})`);
for (const c of body.checks) console.log(`[${c.severity}] ${c.id} @ ${c.field}: ${c.en}`);

console.log("\n--- match");
console.log(JSON.stringify(body.match, null, 2));
console.log("\n--- duplicate");
console.log(JSON.stringify(body.duplicate));

const hard = body.checks.filter((c) => c.severity === "hard");
if (hard.length) {
  console.log(`\nFAIL: ${hard.length} hard check(s).`);
  process.exit(1);
}
console.log("\nOK: no hard checks.");
if (!save) process.exit(0);

// --- --save: the claim, then the same claim again ----------------------------------------------------
const claimsUrl = `${baseUrl}/api/insurance/claims`;
async function postClaim() {
  const r = await fetch(claimsUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      clinicId,
      docId,
      payerId,
      docPath,
      extraction: body.extraction,
      patient: { create: { name: header.paperPatientName } },
      status: "approved",
    }),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(text.slice(0, 2000));
  }
  return { status: r.status, json };
}

console.log(`\nPOST ${claimsUrl} (first save)`);
const first = await postClaim();
console.log(`HTTP ${first.status} ${JSON.stringify(first.json)}`);
if (first.status !== 201 || !first.json?.ok || !first.json.claimId) {
  if (first.status === 409) console.log("This approval was already saved by an earlier run: delete that claim first.");
  console.log("\nFAIL: the first save did not answer 201.");
  process.exit(1);
}
console.log(`\nPOST ${claimsUrl} (the same approval again)`);
const second = await postClaim();
console.log(`HTTP ${second.status} ${JSON.stringify(second.json)}`);
if (second.status !== 409 || second.json?.duplicate?.claimId !== first.json.claimId) {
  console.log("\nFAIL: the second save must answer 409 naming the first claim.");
  process.exit(1);
}
console.log(`\nOK: saved as ${first.json.claimId} (patient ${first.json.patientId}); the second save was refused as a duplicate.`);
process.exit(0);
