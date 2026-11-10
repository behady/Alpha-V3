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
const pace = paceByItem({ items: snap.items, variants: snap.variants, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries });
const artPace = pace.find((p) => p.itemId === artItem.id);
check("articaine: 9 on hand, pace 3/week → 21 days", artPace?.onHand === 9 && artPace?.pace === 3 && Math.round(artPace?.daysLeft ?? 0) === 21, artPace);
const vr = variance({ lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries, uses: snap.uses, trackedItemIds: new Set([impLine.itemId]) });
check("variance: 3 gone, 1 on a patient, gap 2", vr[0]?.gone === 3 && vr[0]?.usedOnPatients === 1 && vr[0]?.gap === 2, vr);

console.log("\n5b. one count per day, and a delivery after it");
r = await post({ action: "save-count", date: "2026-11-12", values: { [line("C1-A1", "anes-art").id]: 2 } });
snap = r.json.snapshot;
check("a second save on the same day updates that day's count", r.status === 200 && snap.counts.length === 2 && snap.counts[1].snapshot[line("C1-A1", "anes-art").id] === 2, snap.counts?.length);
const septLineId = (snap.lines as Json[]).find((l) => l.variantId === sept!.id)!.id;
r = await post({ action: "receive-delivery", date: "2026-11-12", supplier: "DentaCarts", lines: [{ variantId: sept!.id, drawerId: storeA1.id, qty: 2, price: 620 }] });
snap = r.json.snapshot;
check("a delivery after that day's count raises the count's own number", r.status === 200 && snap.counts[1].snapshot[septLineId] === 5 && (snap.lines as Json[]).find((l) => l.id === septLineId)?.qty === 5, snap.counts?.[1]?.snapshot?.[septLineId]);

console.log("\n6. doors");
r = await post({ action: "setup", chairs: 2, itemKeys: ["bond"] });
check("assistant may not change the structure", r.status === 403, r.status);
r = await post({ action: "remove-line", lineId: line("C1-A1", "anes-art").id });
check("assistant may not remove lines", r.status === 403);
as = idToken(ADMIN);
r = await post({ action: "remove-line", lineId: line("C1-A1", "anes-art").id });
check("a row with stock is not deleted without a confirmation", r.status === 409 && /write it off/.test(r.json.error), r.json);

// edit, move, write off
r = await post({ action: "update-item", id: artItem.id, nameAr: "بنج أرتيكايين 4%", per: "50 carpules" });
check("an item can be renamed", r.status === 200 && (r.json.snapshot.items as Json[]).find((i) => i.id === artItem.id)?.nameAr.endsWith("4%"));
r = await post({ action: "update-variant", id: sept!.id, spec: "1:200,000", supplier: "Nile Dental", lastPrice: 640 });
snap = r.json.snapshot;
const sept2 = (snap.variants as Json[]).find((v) => v.id === sept!.id);
check("a brand can be corrected", r.status === 200 && sept2?.spec === "1:200,000" && sept2?.supplier === "Nile Dental" && sept2?.lastPrice === 640 && sept2?.isGeneric === false, sept2);
const genericArt = line("C1-A1", "anes-art");
r = await post({ action: "update-variant", id: genericArt.variantId, brand: "Inibsa", product: "Artinibsa" });
snap = r.json.snapshot;
check("naming a brandless row makes it a brand", (snap.variants as Json[]).find((v) => v.id === genericArt.variantId)?.isGeneric === false);
// The store holds two articaine rows by now (the brandless one and Septodont), so the target is
// named by its id: "the first articaine row in the store" is whichever the database lists first.
const targetId = `${genericArt.variantId}__${storeA1.id}`;
const qtyOf = (id: string) => (snap.lines as Json[]).find((l) => l.id === id)?.qty ?? -1;
const before = { chair: line("C1-A1", "anes-art").qty, store: qtyOf(targetId) };
r = await post({ action: "move-line", lineId: line("C1-A1", "anes-art").id, toDrawerId: storeA1.id });
snap = r.json.snapshot;
check("moving a row merges it into the brand's row in the other drawer", r.status === 200 && line("C1-A1", "anes-art").id === "missing" && qtyOf(targetId) === before.chair + before.store, { before, after: qtyOf(targetId) });
const usageAfterMove = usageByItem({ items: snap.items, variants: snap.variants, lines: snap.lines, counts: snap.counts, deliveries: snap.deliveries, weeks: 4 }).find((u) => u.itemId === artItem.id);
check("a move changes nothing in the usage already computed", usageAfterMove?.used === 2, usageAfterMove);
const flowLine = line("C1-A2", "flow");
r = await post({ action: "remove-line", lineId: flowLine.id, writeOff: true });
snap = r.json.snapshot;
check("a confirmed delete removes a row that still had stock", r.status === 200 && line("C1-A2", "flow").id === "missing");
const wo = await clinic.collection("system_logs").where("action", "==", "Stock Written Off").get();
check("the write-off is on the activity log with its quantity", wo.size === 1 && /^3 x /.test(String(wo.docs[0].data().details)) && /C1-A2/.test(String(wo.docs[0].data().details)), wo.docs[0]?.data().details);
r = await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "X", lot: "", date: "2026-11-12" });
check("use works while stock remains", r.status === 200);
for (let i = 0; i < 3; i++) await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "X", lot: "", date: "2026-11-12" });
r = await post({ action: "use-on-patient", variantId: impLine.variantId, drawerId: impLine.drawerId, patientName: "X", lot: "", date: "2026-11-12" });
check("cannot use what the drawer says is not there", r.status === 409, r.status);
r = await post({ action: "nonsense" });
check("unknown action refused", r.status === 400);

console.log("\n7. the clinic's own layout: a room, a cabinet of twenty drawers and one shelf");
r = await post({ action: "add-cabinet", roomCode: "r1", roomName: "Room 1", drawers: 20, shelves: 1 });
snap = r.json.snapshot;
const r1 = (snap.drawers as Json[]).filter((d) => d.roomCode === "R1");
check("twenty drawers and one shelf, coded R1-A1..A20 and R1-AS1", r.status === 200 && r1.length === 21 && r1.some((d) => d.code === "R1-A20") && r1.some((d) => d.code === "R1-AS1" && d.kind === "shelf") && r1.every((d) => d.roomEn === "Room 1" && d.cabinetLetter === "A"), r1.map((d) => d.code).slice(0, 4));
check("they come in walking order, shelf last", r1[0].code === "R1-A1" && r1[19].code === "R1-A20" && r1[20].code === "R1-AS1", r1.map((d) => d.code).join(","));
const d3 = r1.find((d) => d.code === "R1-A3")!;
r = await post({ action: "rename-drawer", id: d3.id, name: "Composite & bond" });
snap = r.json.snapshot;
const d3b = (snap.drawers as Json[]).find((d) => d.id === d3.id);
check("a drawer takes the name the clinic gives it, and keeps its code", d3b?.nameEn === "Composite & bond" && d3b?.nameAr === "Composite & bond" && d3b?.code === "R1-A3", d3b);
r = await post({ action: "add-cabinet", roomCode: "R1", cabinetLetter: "A", drawers: 1, shelves: 1 });
snap = r.json.snapshot;
check("one more drawer and shelf number on from the last", (snap.drawers as Json[]).some((d) => d.code === "R1-A21") && (snap.drawers as Json[]).some((d) => d.code === "R1-AS2"));
r = await post({ action: "add-cabinet", roomCode: "R1", roomName: "ignored", drawers: 2, shelves: 0 });
snap = r.json.snapshot;
check("a second cabinet takes the next letter and the room keeps its name", r.json.cabinetLetter === "B" && (snap.drawers as Json[]).some((d) => d.code === "R1-B2" && d.roomEn === "Room 1"), r.json.cabinetLetter);
r = await post({ action: "rename-room", roomCode: "R1", name: "Surgery room" });
snap = r.json.snapshot;
check("renaming the room renames it on every drawer", (snap.drawers as Json[]).filter((d) => d.roomCode === "R1").every((d) => d.roomEn === "Surgery room" && d.roomAr === "Surgery room"));
r = await post({ action: "add-item", catalogKey: "bond", nameEn: "Bonding agent", nameAr: "bond", drawerId: d3.id, qty: 2 });
check("an item goes into the clinic's own drawer", r.status === 200 && (r.json.snapshot.lines as Json[]).some((l) => l.drawerId === d3.id && l.qty === 2));
r = await post({ action: "delete-drawer", id: d3.id });
check("a drawer that still holds stock is not deleted", r.status === 409 && /still holds/.test(r.json.error), r.json);
const d5 = r1.find((d) => d.code === "R1-A5")!;
r = await post({ action: "delete-drawer", id: d5.id });
check("an empty drawer is", r.status === 200 && !(r.json.snapshot.drawers as Json[]).some((d) => d.id === d5.id));
r = await post({ action: "add-cabinet", roomCode: "R2", roomName: "Room 2", drawers: 0, shelves: 0 });
check("a cabinet of nothing is refused", r.status === 400);
as = idToken(ASSISTANT);
r = await post({ action: "add-cabinet", roomCode: "R3", roomName: "Room 3", drawers: 1, shelves: 0 });
check("the assistant may not change the layout", r.status === 403);
as = idToken(ADMIN);

console.log("\n8. the history: who did what, and when");
const t0 = Date.now();
r = await post({ action: "history" });
const hist = r.json.events as Json[];
check("the history is readable and newest first", r.status === 200 && hist.length > 20 && hist.every((e, k) => k === 0 || hist[k - 1].atMs >= e.atMs), hist.length);
check("every line names a person, a role and a time", hist.every((e) => e.byName && e.byRole && e.atMs > t0 - 600000 && e.atMs <= t0 + 1000 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(e.date)), hist.find((e) => !e.byName || !e.byRole));
const byType = (type: string) => hist.filter((e) => e.type === type);
check("the assistant's count is under the assistant's name, row by row", byType("count").some((e) => e.byName === "Desk" && e.byRole === "Assistant" && e.drawerCode === "C1-A1" && e.qtyBefore === 0 && e.qtyAfter === 3), byType("count").slice(-4));
check("each saved count leaves a summary", byType("count-saved").length === 3 && byType("count-saved").some((e) => e.n2 === 4), byType("count-saved").map((e) => e.n2));
check("the delivery lines carry quantity, price and supplier", byType("delivery").some((e) => e.qty === 4 && e.price === 620 && e.supplier === "DentaCarts" && e.brand === "Septodont Septanest 1:100,000" && e.text === "new-brand"), byType("delivery")[0]);
check("the patient use carries the patient and the lot", byType("used").some((e) => e.patientName === "Mariam Hassan" && e.lot === "DSL-2409-17" && e.byName === "Desk"));
check("the write-off says how much was on the row", byType("write-off").length === 1 && byType("write-off")[0].qty === 3 && byType("write-off")[0].drawerCode === "C1-A2" && byType("write-off")[0].byName === "Owner", byType("write-off")[0]);
check("the move says from where to where", byType("moved").some((e) => e.drawerCode === "C1-A1" && e.toDrawerCode === "SR-A1" && e.qty === 2), byType("moved")[0]);
check("edits list the fields that changed", byType("brand-edited").some((e) => (e.changes as Json[]).some((c) => c.field === "price" && c.to === "640")) && byType("item-edited").length === 1);
check("the layout is in it too", byType("cabinet-added").some((e) => e.text === "R1-A" && e.n1 === 20 && e.n2 === 1) && byType("room-renamed").length === 1 && byType("drawer-deleted").some((e) => e.drawerCode === "R1-A5"), byType("cabinet-added").map((e) => e.text));
check("refused actions leave no trace", !hist.some((e) => e.drawerCode === "R1-A3" && e.type === "drawer-deleted") && !hist.some((e) => e.text === "R3-A"));
as = idToken(ASSISTANT);
r = await post({ action: "history" });
check("the assistant may read the history", r.status === 200 && r.json.events.length === hist.length);
as = idToken(ADMIN);

console.log(`\n${passed} passed, ${failed} failed`);
authServer.close();
process.exit(failed ? 1 : 0);
