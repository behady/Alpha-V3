/**
 * End-to-end test of /api/stock against the Firestore emulator.
 *
 *   PATH=<jdk21>/bin:$PATH npx firebase-tools@13 emulators:exec --only firestore --project demo-stock \
 *     "npx tsx tests/stockRoute.test.mts"
 *
 * Runs the real route handler with nothing mocked but the login check (the Auth emulator is
 * replaced by a tiny server that answers verifyIdToken's one lookup). The story: a one-chair
 * clinic sets up its cupboard, counts, a delivery arrives by barcode and posts a Supplies
 * expense, the next count shows usage, an implant is used on a patient, and the variance report
 * sees the one that was not.
 */
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";

const PROJECT = process.env.GCLOUD_PROJECT || "demo-stock";
const CLINIC = "clinic-stock";
const ADMIN = "admin-1";
const ASSISTANT = "assistant-1";

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
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;

function idToken(uid: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: "password", identities: {} } })}.`;
}

const { adminDb } = await import("../src/lib/firebaseAdmin");
const route = await import("../src/app/api/stock/route");
const { usageByItem, paceByItem, variance } = await import("../src/lib/stock/math");

const db = adminDb();
const clinic = db.collection("clinics").doc(CLINIC);
let as = idToken(ADMIN);
let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}
type Json = Record<string, any>;
async function post(body: Json): Promise<{ status: number; json: Json }> {
  const res = await route.POST(new Request("http://localhost/api/stock", { method: "POST", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: JSON.stringify({ clinicId: CLINIC, ...body }) }));
  return { status: res.status, json: (await res.json()) as Json };
}

await db.recursiveDelete(clinic);
await db.recursiveDelete(db.collection("users").doc(ADMIN));
await db.recursiveDelete(db.collection("users").doc(ASSISTANT));
for (const d of (await db.collection("stock_library").get()).docs) await d.ref.delete();
await clinic.set({ name: "Stock Test", status: "Active", subscriptionTier: "Premium" });
await db.collection("users").doc(ADMIN).set({ name: "Owner", clinicRoles: { [CLINIC]: "Admin" } });
await db.collection("users").doc(ASSISTANT).set({ name: "Desk", clinicRoles: { [CLINIC]: "Assistant" }, clinicPermissions: { [CLINIC]: ["access.inventory", "inventory.edit"] } });

console.log("\n1. setup");
let r = await post({ action: "setup", chairs: 1, itemKeys: ["anes-art", "comp", "flow", "gloves", "pouches-s", "implant"] });
check("setup ok", r.status === 200, r.json);
let snap = r.json.snapshot as Json;
const codes = (snap.drawers as Json[]).map((d) => d.code).sort();
check("chair 1 got A1, A2, B1; sterilisation; store; and a per-patient drawer", JSON.stringify(codes) === JSON.stringify(["C1-A1", "C1-A2", "C1-B1", "C1-B4", "SR-A1", "SR-A2", "ST-A1"]), codes);
check("six items, six generic brands", snap.items.length === 6 && snap.variants.length === 6 && (snap.variants as Json[]).every((v) => v.isGeneric));
const implantDrawer = (snap.drawers as Json[]).find((d) => d.code === "C1-B4");
check("surgery drawer is per-patient", implantDrawer?.tracked === true);
const line = (code: string, catalogKey: string): Json => {
  const d = (snap.drawers as Json[]).find((x) => x.code === code);
  const it = (snap.items as Json[]).find((x) => x.catalogKey === catalogKey);
  return (snap.lines as Json[]).find((l) => l.drawerId === d?.id && l.itemId === it?.id) ?? { id: "missing", qty: -1, variantId: "", drawerId: "", itemId: "" };
};
check("articaine sits in C1-A1 and the store", line("C1-A1", "anes-art").id !== "missing" && line("SR-A1", "anes-art").id !== "missing");
check("gloves sit in C1-B1 and the store, not in A1", line("C1-B1", "gloves").id !== "missing" && line("SR-A2", "gloves").id !== "missing" && line("C1-A1", "gloves").id === "missing");

r = await post({ action: "setup", chairs: 1, itemKeys: ["anes-art", "comp", "flow", "gloves", "pouches-s", "implant", "etch"] });
check("second setup adds only the new item", r.status === 200 && r.json.snapshot.items.length === 7 && r.json.snapshot.drawers.length === 7, r.json.snapshot?.drawers?.length);
snap = r.json.snapshot;

console.log("\n2. the assistant counts (first Thursday)");
as = idToken(ASSISTANT);
const values1: Record<string, number> = {};
values1[line("C1-A1", "anes-art").id] = 3;
values1[line("SR-A1", "anes-art").id] = 5;
values1[line("C1-A2", "flow").id] = 2;
values1[line("C1-B4", "implant").id] = 6;
r = await post({ action: "save-count", date: "2026-11-05", values: values1 });
check("assistant may count", r.status === 200, r.json);
snap = r.json.snapshot;
check("snapshot holds every line, uncounted ones at zero", Object.keys(snap.counts[0].snapshot).length === snap.lines.length && snap.counts[0].snapshot[line("C1-B1", "gloves").id] === 0);
check("line quantities updated", line("C1-A1", "anes-art").qty === 3 && line("C1-B4", "implant").qty === 6);

console.log("\n3. a delivery by barcode");
r = await post({ action: "lookup-barcode", barcode: "3760054020016" });
check("unknown barcode: no variant, no library", r.status === 200 && r.json.variant === null && r.json.library === null);
const artItem = (snap.items as Json[]).find((i) => i.catalogKey === "anes-art")!;
const storeA1 = (snap.drawers as Json[]).find((d) => d.code === "SR-A1")!;
r = await post({
  action: "receive-delivery",
  date: "2026-11-09",
  supplier: "DentaCarts",
  lines: [
    { newVariant: { itemId: artItem.id, brand: "Septodont", product: "Septanest", spec: "1:100,000", barcode: "3760054020016" }, drawerId: storeA1.id, qty: 4, price: 620 },
    { variantId: line("C1-A2", "flow").variantId, drawerId: line("C1-A2", "flow").drawerId, qty: 2, price: 500 },
  ],
});
check("delivery received", r.status === 200, r.json);
check("total is 4×620 + 2×500", r.json.total === 3480, r.json.total);
snap = r.json.snapshot;
const sept = (snap.variants as Json[]).find((v) => v.brand === "Septodont");
check("new brand created with barcode and supplier", !!sept && sept.barcode === "3760054020016" && sept.supplier === "DentaCarts" && sept.lastPrice === 620, sept);
check("new brand has its own line in the store with 4", (snap.lines as Json[]).find((l) => l.variantId === sept!.id && l.drawerId === storeA1.id)?.qty === 4);
check("flow line went 2 → 4", line("C1-A2", "flow").qty === 4);
const ledger = await clinic.collection("ledger").where("stockDeliveryId", "==", r.json.deliveryId).get();
check("one Supplies expense posted to the ledger", ledger.size === 1 && ledger.docs[0].data().type === "expense" && ledger.docs[0].data().category === "Supplies" && ledger.docs[0].data().cost === 3480, ledger.docs[0]?.data());
const lib = await db.collection("stock_library").doc("3760054020016").get();
check("barcode written to the shared library", lib.exists && lib.data()?.brand === "Septodont" && lib.data()?.catalogKey === "anes-art");
r = await post({ action: "lookup-barcode", barcode: "3760054020016" });
check("lookup now finds the clinic's own brand", r.json.variant?.id === sept!.id);

console.log("\n4. an implant goes into a patient");
const impLine = line("C1-B4", "implant");
r = await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "Mariam Hassan", lot: "DSL-2409-17", date: "2026-11-10" });
check("recorded", r.status === 200, r.json);
snap = r.json.snapshot;
check("implants 6 → 5", line("C1-B4", "implant").qty === 5);
check("use is on the record with the lot", snap.uses.length === 1 && snap.uses[0].lot === "DSL-2409-17" && snap.uses[0].patientName === "Mariam Hassan");

console.log("\n5. second count, then the arithmetic");
const values2: Record<string, number> = {};
values2[line("C1-A1", "anes-art").id] = 1; // 3 → 1: used 2
values2[line("SR-A1", "anes-art").id] = 5; // unchanged
values2[(snap.lines as Json[]).find((l) => l.variantId === sept!.id)!.id] = 3; // 0 + 4 delivered → 3: used 1
values2[line("C1-A2", "flow").id] = 3; // 2 + 2 delivered → 3: used 1
values2[line("C1-B4", "implant").id] = 3; // 5 after the patient; one more is gone with no record
r = await post({ action: "save-count", date: "2026-11-12", values: values2 });
check("second count saved", r.status === 200 && r.json.changed === 4, r.json.changed);
snap = r.json.snapshot;
const usage = usageByItem({ items: snap.items, variants: snap.variants, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries, weeks: 4 });
const artUsage = usage.find((u) => u.itemId === artItem.id);
check("articaine used 3 boxes this week (2 generic + 1 Septodont)", artUsage?.used === 3, artUsage);
check("articaine cost uses the delivered price for the brand and 0 for the brandless", artUsage?.cost === 1 * 620, artUsage?.cost);
const flowUsage = usage.find((u) => u.itemId === line("C1-A2", "flow").itemId);
check("flow used 1 at 500", flowUsage?.used === 1 && flowUsage?.cost === 500, flowUsage);
const pace = paceByItem({ items: snap.items, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries });
const artPace = pace.find((p) => p.itemId === artItem.id);
check("articaine: 9 on hand, pace 3/week → 21 days", artPace?.onHand === 9 && artPace?.pace === 3 && Math.round(artPace?.daysLeft ?? 0) === 21, artPace);
const vr = variance({ lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries, uses: snap.uses, trackedItemIds: new Set([impLine.itemId]) });
check("variance: 3 gone, 1 on a patient, gap 2", vr[0]?.gone === 3 && vr[0]?.usedOnPatients === 1 && vr[0]?.gap === 2, vr);

console.log("\n6. doors");
r = await post({ action: "setup", chairs: 2, itemKeys: ["bond"] });
check("assistant may not change the structure", r.status === 403, r.status);
r = await post({ action: "remove-line", lineId: line("C1-A1", "anes-art").id });
check("assistant may not remove lines", r.status === 403);
as = idToken(ADMIN);
r = await post({ action: "remove-line", lineId: line("C1-A1", "anes-art").id });
check("a line with stock cannot be removed", r.status === 400 && /zero/.test(r.json.error), r.json);
r = await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "X", lot: "", date: "2026-11-12" });
check("use works while stock remains", r.status === 200);
for (let i = 0; i < 3; i++) await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "X", lot: "", date: "2026-11-12" });
r = await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "X", lot: "", date: "2026-11-12" });
check("cannot use what the drawer says is not there", r.status === 409, r.status);
r = await post({ action: "nonsense" });
check("unknown action refused", r.status === 400);

console.log(`\n${passed} passed, ${failed} failed`);
authServer.close();
process.exit(failed ? 1 : 0);
