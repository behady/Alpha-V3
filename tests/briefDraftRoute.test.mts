/**
 * POST /api/whatsapp/brief-draft ("Interview me") — the doors that must shut before any model call,
 * against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx tests/briefDraftRoute.test.mts
 *
 * Runs the real route handler with nothing mocked but the login check (a tiny server answers the
 * one lookup verifyIdToken makes), as tests/callRemindersRoute.test.mts does. Every case here is
 * refused before the model is reached, so GEMINI_API_KEY is deliberately unset: a refusal that
 * leaked through would fail loudly as a 500 instead of quietly spending a credit.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-brief-draft-route";
const C1 = "C1"; // has the AI add-on
const C2 = "C2"; // does not
const ADMIN1 = "admin-1";
const ADMIN2 = "admin-2";
const DESK1 = "desk-1";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const authServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (!req.url?.includes("accounts:lookup")) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    const ids = (JSON.parse(body || "{}").localId as string[] | undefined) ?? [];
    res.end(JSON.stringify({ users: ids.map((localId) => ({ localId, disabled: false, validSince: "0" })) }));
  });
});
await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
const authPort = (authServer.address() as { port: number }).port;

process.env.FIREBASE_PROJECT_ID = PROJECT;
process.env.FIREBASE_CLIENT_EMAIL = `sa@${PROJECT}.iam.gserviceaccount.com`;
process.env.FIREBASE_PRIVATE_KEY = PEM;
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
delete process.env.GEMINI_API_KEY;

function idToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: "password", identities: {} },
  })}.`;
}

const { adminDb } = await import("../src/lib/firebaseAdmin");
const route = await import("../src/app/api/whatsapp/brief-draft/route");

const db = adminDb();
const monthKey = new Date().toISOString().slice(0, 7);
const usageDoc = (clinicId: string) => db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FAIL  ${label} — ${JSON.stringify(detail)}`);
  }
}

type Json = Record<string, any>;
async function post(uid: string | null, body: Json): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idToken(uid)}`;
  const res = await route.POST(
    new Request("http://localhost/api/whatsapp/brief-draft", { method: "POST", headers, body: JSON.stringify(body) }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

async function wipe() {
  for (const id of [C1, C2]) await db.recursiveDelete(db.collection("clinics").doc(id));
  for (const uid of [ADMIN1, ADMIN2, DESK1]) await db.recursiveDelete(db.collection("users").doc(uid));
}

await wipe();
await db.collection("clinics").doc(C1).set({ name: "With AI", status: "Active", ownerId: ADMIN1, features: { aiChat: true } });
await db.collection("clinics").doc(C2).set({ name: "No AI", status: "Active", ownerId: ADMIN2, features: { aiChat: false } });
await db.collection("users").doc(ADMIN1).set({ name: "Dr One", clinicRoles: { [C1]: "Admin" } });
await db.collection("users").doc(ADMIN2).set({ name: "Dr Two", clinicRoles: { [C2]: "Admin" } });
await db.collection("users").doc(DESK1).set({ name: "سارة", clinicRoles: { [C1]: "Receptionist" }, clinicPermissions: { [C1]: [] } });

const TEXT = "الكشف مجاني والتقسيط متاح على الزراعة";

{
  const { status } = await post(null, { clinicId: C1, text: TEXT });
  check("no token is 401", status === 401, status);
}
{
  const { status } = await post(DESK1, { clinicId: C1, text: TEXT });
  check("a desk user of the clinic is 403", status === 403, status);
}
{
  const { status } = await post(ADMIN1, { clinicId: C2, text: TEXT });
  check("an admin of another clinic is 403", status === 403, status);
}
{
  const { status, json } = await post(ADMIN2, { clinicId: C2, text: TEXT });
  check("an admin without the AI add-on is 403 with ok:false", status === 403 && json.ok === false, { status, json });
}
{
  const { status, json } = await post(ADMIN1, { clinicId: C1, text: "" });
  check("empty text is 400", status === 400 && json.ok === false, { status, json });
}
{
  const { status } = await post(ADMIN1, { clinicId: C1, text: "   " });
  check("blank text is 400", status === 400, status);
}
{
  const { status } = await post(ADMIN1, { clinicId: C1, text: "x".repeat(3001) });
  check("3,001 characters is 400", status === 400, status);
}
{
  const { status } = await post(ADMIN1, { text: TEXT });
  check("a missing clinicId is 400", status === 400, status);
}

for (const id of [C1, C2]) {
  check(`nothing was charged to ${id}`, !(await usageDoc(id).get()).exists);
}

await wipe();
authServer.close();
console.log(`brief draft route: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
