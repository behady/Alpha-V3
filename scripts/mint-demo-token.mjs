/**
 * Mints a short-lived Firebase custom sign-in token for an existing account.
 *
 *   node scripts/mint-demo-token.mjs behady2014@gmail.com
 *
 * Used to open a browser session for capturing help-article screenshots without anyone typing a
 * password. The token is valid for one hour, is exchanged for a session in the browser via
 * `signInWithCustomToken`, and grants exactly the access the account already has — it is not a
 * privilege escalation and it creates nothing.
 *
 * This only ever mints for an account that already exists; an unknown email is an error rather
 * than a new account.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

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

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/mint-demo-token.mjs <email-of-existing-account>");
  process.exit(1);
}

loadEnvLocal();

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "")
        .replace(/^["']|["']$/g, "")
        .replace(/\\n/g, "\n")
        .trim(),
    }),
  });
}

const auth = getAuth(getApps()[0]);
const user = await auth.getUserByEmail(email); // throws if the account does not exist
const token = await auth.createCustomToken(user.uid);

console.error(`account : ${user.email} (${user.uid})`);
console.error(`expires : 1 hour`);
process.stdout.write(token);
