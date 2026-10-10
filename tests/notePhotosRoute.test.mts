/**
 * Photos on a treatment, through the real procedures route, against the Firestore emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:note-photos-route
 *
 * Same harness as recycleBinCascade.test.mts: only the login check is stood in for.
 */

import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = "demo-note-photos";
const CLINIC = "C1";
const UID = "admin-1";
const VIEWER = "viewer-1";

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
const { clinicalNotePhotoPath } = await import("../src/lib/storagePaths");
const { MAX_NOTE_PHOTOS } = await import("../src/lib/notePhotos");
const route = await import("../src/app/api/clinical/procedures/route");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
const note = clinic.collection("clinical_notes").doc("N1");
let as = idToken(UID);

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail: unknown = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

type Json = Record<string, any>;
async function photos(body: Json): Promise<{ status: number; json: Json }> {
  const res = await route.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "photos", clinicId: CLINIC, noteId: "N1", ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const url = (path: string) =>
  `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=t`;
const photo = (clinicId = CLINIC, noteId = "N1") => {
  const path = clinicalNotePhotoPath(clinicId, noteId);
  return { url: url(path), path };
};
const stored = async () => ((await note.get()).data()?.photos ?? []) as Json[];

await db.recursiveDelete(clinic);
await clinic.set({ name: "Photo Test", status: "Active", subscriptionTier: "Premium" });
await db.collection("users").doc(UID).set({ name: "Dr Tester", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc(VIEWER).set({ name: "Desk", clinicRoles: { [CLINIC]: "Assistant" }, clinicPermissions: { [CLINIC]: ["patients.edit"] } });
await note.set({ patientId: "P1", procedure: "Crown", cost: 500 });

console.log("attaching photos");
{
  const a = photo();
  const b = photo();
  const { status, json } = await photos({ add: [a, b] });
  check("two photos attach", status === 200 && json.photos?.length === 2, json);
  const s = await stored();
  check("they are on the note, stamped with who added them", s.length === 2 && s[0].addedBy === "Dr Tester" && !!s[0].addedAt, s);
  check("nothing else on the note changed", (await note.get()).data()?.cost === 500);
  const again = await photos({ add: [a] });
  check("the same photo twice is stored once", again.status === 200 && (await stored()).length === 2, again.json);
}

console.log("refusing what does not belong");
{
  const other = await photos({ add: [photo("C2")] });
  check("another clinic's file is refused", other.status === 400, other.json);
  const otherNote = await photos({ add: [photo(CLINIC, "N2")] });
  check("another note's file is refused", otherNote.status === 400, otherNote.json);
  const p = photo();
  const web = await photos({ add: [{ url: "https://example.com/x.jpg", path: p.path }] });
  check("a web address that is not the file's download link is refused", web.status === 400, web.json);
  check("none of them reached the note", (await stored()).length === 2);
  const missing = await route.POST(
    new Request("http://localhost/api/clinical/procedures", {
      method: "POST",
      headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "photos", clinicId: CLINIC, noteId: "NOPE", add: [photo(CLINIC, "NOPE")] }),
    }),
  );
  check("a treatment that does not exist is a 404", missing.status === 404);
}

console.log("permission");
{
  as = idToken(VIEWER);
  const { status } = await photos({ add: [photo()] });
  check("someone without clinical.edit cannot attach", status === 403, status);
  as = idToken(UID);
}

console.log("removing");
{
  const first = (await stored())[0];
  const { status, json } = await photos({ removePath: first.path });
  check("one photo comes off", status === 200 && json.photos?.length === 1 && !json.photos.some((p: Json) => p.path === first.path), json);
}

console.log("the limit");
{
  const room = MAX_NOTE_PHOTOS - (await stored()).length;
  const fill = await photos({ add: Array.from({ length: room }, () => photo()) });
  check(`fills up to ${MAX_NOTE_PHOTOS}`, fill.status === 200 && fill.json.photos?.length === MAX_NOTE_PHOTOS, fill.json.error);
  const over = await photos({ add: [photo()] });
  check("one more is refused with a reason", over.status === 400 && /up to/.test(over.json.error), over.json);
}

await db.recursiveDelete(clinic);
authServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
