/**
 * Connects a Facebook Page to a clinic for Meta Lead Ads intake.
 *
 *   node scripts/connect-meta-page.mjs --app-secret=<from Meta app settings>
 *   node scripts/connect-meta-page.mjs --page-id=123 --clinic-id=abc --token=<page access token> [--page-name="..."]
 *   node scripts/connect-meta-page.mjs --list
 *
 * Run it once with --app-secret to store the app credentials (a verify token is
 * generated automatically on first run), then once per Page to map it to a clinic.
 * Prints the webhook URL and verify token to paste into the Meta developer console.
 *
 * Uses the same .env.local admin credentials and the named "default" database as
 * every other script here (see seed-demo-clinic.mjs for why the name matters).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBHOOK_URL = "https://us-central1-alpha-v2-ffc98.cloudfunctions.net/metaLeadsWebhook";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  if (process.env[key]) continue;
  process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
}

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
  .replace(/^["']|["']$/g, "")
  .replace(/\\n/g, "\n")
  .trim();
if (!projectId || !clientEmail || !privateKey) throw new Error("Missing Firebase admin env in .env.local");
if (getApps().length === 0) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
const db = getFirestore(getApps()[0], "default");

const configRef = db.doc("meta_integrations/config");

async function ensureConfig() {
  const snap = await configRef.get();
  const data = snap.exists ? snap.data() : {};
  const update = {};
  if (!data.verifyToken) update.verifyToken = crypto.randomBytes(24).toString("hex");
  if (args["app-secret"] && typeof args["app-secret"] === "string") update.appSecret = args["app-secret"];
  if (Object.keys(update).length > 0) {
    update.updatedAt = FieldValue.serverTimestamp();
    await configRef.set(update, { merge: true });
  }
  return { ...data, ...update };
}

const config = await ensureConfig();

if (args.list) {
  const pages = await db.collection("meta_pages").get();
  if (pages.empty) console.log("No pages connected yet.");
  for (const doc of pages.docs) {
    const d = doc.data();
    console.log(`Page ${doc.id} (${d.pageName || "unnamed"}) → clinic ${d.clinicId} ${d.enabled === false ? "[DISABLED]" : ""}`);
  }
} else if (args["page-id"]) {
  const pageId = String(args["page-id"]);
  const clinicId = String(args["clinic-id"] || "");
  const token = String(args.token || "");
  if (!clinicId || !token) throw new Error("Connecting a page needs --clinic-id= and --token=");

  const clinicSnap = await db.doc(`clinics/${clinicId}`).get();
  if (!clinicSnap.exists) throw new Error(`Clinic ${clinicId} does not exist`);

  const GRAPH = "https://graph.facebook.com/v23.0";

  // A system-user (or user) token can mint the page's OWN token — that is what the
  // webhook stores and uses. If the passed token already IS a page token, the lookup
  // simply returns it back.
  const pageRes = await fetch(`${GRAPH}/${pageId}?fields=name,access_token&access_token=${encodeURIComponent(token)}`);
  const pageInfo = await pageRes.json();
  if (!pageRes.ok) throw new Error(`Page lookup failed: ${JSON.stringify(pageInfo.error || pageInfo)}`);
  const pageAccessToken = pageInfo.access_token || token;
  const pageName = pageInfo.name || String(args["page-name"] || "");
  console.log(`Page: ${pageName} (${pageId}) — ${pageInfo.access_token ? "derived the page's own token" : "using the provided token as-is"}`);

  // Subscribing the app to the page is what makes Meta actually deliver leadgen pings.
  const subRes = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `subscribed_fields=leadgen&access_token=${encodeURIComponent(pageAccessToken)}`,
  });
  const subBody = await subRes.json();
  if (!subRes.ok || !subBody.success) throw new Error(`subscribed_apps failed: ${JSON.stringify(subBody.error || subBody)}`);
  console.log("App subscribed to the page for leadgen ✓");

  await db.doc(`meta_pages/${pageId}`).set(
    {
      clinicId,
      pageAccessToken,
      pageName,
      enabled: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`Connected page ${pageId} → clinic "${clinicSnap.data().name || clinicId}"`);
}

console.log("\n--- Paste into the Meta developer console (Webhooks → Page → leadgen) ---");
console.log(`Callback URL:  ${WEBHOOK_URL}`);
console.log(`Verify token:  ${config.verifyToken}`);
console.log(`App secret:    ${config.appSecret ? "stored ✓" : "NOT SET — run with --app-secret=... (webhook rejects everything until set)"}`);
