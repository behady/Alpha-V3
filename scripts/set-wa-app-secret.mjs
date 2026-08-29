/**
 * Stores the Meta app secret used to verify WhatsApp webhook signatures.
 *
 *   node scripts/set-wa-app-secret.mjs --secret=<from Meta app settings → Basic>
 *
 * The secret belongs to the "Alpha Dental" Meta app (id 1920583481957068) and lands in
 * meta_integrations/config.waAppSecret — the same server-only doc the webhook already reads
 * its verify token from, so no Vercel env change or redeploy is needed for it to take effect.
 * Until this has been run, the webhook accepts payloads unsigned and warns on every call.
 *
 * Uses the same .env.local admin credentials and the named "default" database as every other
 * script here (see seed-demo-clinic.mjs for why the name matters).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const secret = typeof args.secret === "string" ? args.secret.trim() : "";
if (!secret) throw new Error("Usage: node scripts/set-wa-app-secret.mjs --secret=<app secret>");

await db.doc("meta_integrations/config").set(
  { waAppSecret: secret, updatedAt: FieldValue.serverTimestamp() },
  { merge: true }
);

console.log("waAppSecret stored in meta_integrations/config — the webhook now rejects unsigned payloads.");
