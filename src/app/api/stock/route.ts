import { reportServerError } from "@/lib/server/reportError";
/**
 * The stock module's one door.
 *
 * Every read and write of `clinics/{id}/stock_*` goes through here with the admin SDK, so the
 * module needs no Firestore rules of its own and cannot reach another clinic's cupboard. The
 * three events the method is built on — a delivery, a weekly count, an item used on a patient —
 * are the only writes that change a quantity. There is deliberately no "adjust stock" action.
 *
 * A delivery also posts a Supplies expense to the ledger through the same row builder the
 * Finance page uses, so the owner's expenses and the cupboard agree without a second entry.
 */
import { NextResponse } from "next/server";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { buildManualEntryRow } from "@/lib/ledgerWrite";
import { recordMoneyChange } from "@/lib/server/ledgerAudit";
import { logActivityServer } from "@/lib/server/systemLog";
import {
  CATALOG_BY_KEY,
  CHAIR_DRAWERS,
  DEFAULT_SUPPLIERS,
  ROOM_NAMES,
  SPECIALIST_DRAWERS,
  STERI_DRAWERS,
  STORE_DRAWERS,
  type CatalogGroup,
  type StandardDrawer,
} from "@/lib/stock/catalog";
import { lineKey, todayKey } from "@/lib/stock/math";
import type {
  LibraryProduct,
  StockCount,
  StockDelivery,
  StockDrawer,
  StockItem,
  StockLine,
  StockShape,
  StockSnapshot,
  StockUnit,
  StockUse,
  StockVariant,
} from "@/lib/stock/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIBRARY = "stock_library";

type Actor = { uid: string; name: string; role: string };
type Body = Record<string, unknown>;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v.trim() : fallback);
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const SHAPES: StockShape[] = ["syringe", "bottle", "box", "jar", "pack", "bag", "cartridge", "vial"];
const shapeOf = (v: unknown): StockShape => (SHAPES.includes(v as StockShape) ? (v as StockShape) : "box");

// --- readers ---------------------------------------------------------------------------------

function drawerOf(id: string, d: FirebaseFirestore.DocumentData): StockDrawer {
  return {
    id,
    code: str(d.code),
    roomCode: str(d.roomCode),
    roomEn: str(d.roomEn),
    roomAr: str(d.roomAr),
    cabinetLetter: str(d.cabinetLetter, "A"),
    cabinetWhere: str(d.cabinetWhere),
    number: num(d.number, 1),
    nameEn: str(d.nameEn),
    nameAr: str(d.nameAr),
    photoUrl: typeof d.photoUrl === "string" ? d.photoUrl : null,
    tracked: d.tracked === true,
    order: num(d.order, 0),
  };
}
function itemOf(id: string, d: FirebaseFirestore.DocumentData): StockItem {
  return {
    id,
    nameEn: str(d.nameEn),
    nameAr: str(d.nameAr),
    unit: str(d.unit, "box") as StockUnit,
    per: str(d.per),
    shape: shapeOf(d.shape),
    tracked: d.tracked === true,
    catalogKey: typeof d.catalogKey === "string" ? d.catalogKey : null,
    photoUrl: typeof d.photoUrl === "string" ? d.photoUrl : null,
  };
}
function variantOf(id: string, d: FirebaseFirestore.DocumentData): StockVariant {
  return {
    id,
    itemId: str(d.itemId),
    brand: str(d.brand),
    product: str(d.product),
    spec: str(d.spec),
    barcode: typeof d.barcode === "string" && d.barcode ? d.barcode : null,
    photoUrl: typeof d.photoUrl === "string" ? d.photoUrl : null,
    supplier: typeof d.supplier === "string" && d.supplier ? d.supplier : null,
    lastPrice: typeof d.lastPrice === "number" ? d.lastPrice : null,
    isGeneric: d.isGeneric === true,
  };
}
function lineOf(id: string, d: FirebaseFirestore.DocumentData): StockLine {
  return { id, variantId: str(d.variantId), itemId: str(d.itemId), drawerId: str(d.drawerId), qty: Math.max(0, num(d.qty)) };
}
function countOf(id: string, d: FirebaseFirestore.DocumentData): StockCount {
  const snap: Record<string, number> = {};
  if (d.snapshot && typeof d.snapshot === "object") {
    for (const [k, v] of Object.entries(d.snapshot as Record<string, unknown>)) snap[k] = num(v);
  }
  return { id, date: str(d.date), byName: str(d.byName), snapshot: snap, changed: num(d.changed) };
}
function deliveryOf(id: string, d: FirebaseFirestore.DocumentData): StockDelivery {
  const lines = Array.isArray(d.lines)
    ? (d.lines as Body[]).map((l) => ({ variantId: str(l.variantId), drawerId: str(l.drawerId), qty: num(l.qty), price: num(l.price) }))
    : [];
  return {
    id,
    date: str(d.date),
    supplier: str(d.supplier),
    invoiceUrl: typeof d.invoiceUrl === "string" ? d.invoiceUrl : null,
    lines,
    total: num(d.total),
    ledgerId: typeof d.ledgerId === "string" ? d.ledgerId : null,
    byName: str(d.byName),
  };
}
function useOf(id: string, d: FirebaseFirestore.DocumentData): StockUse {
  return {
    id,
    date: str(d.date),
    variantId: str(d.variantId),
    drawerId: str(d.drawerId),
    patientId: typeof d.patientId === "string" ? d.patientId : null,
    patientName: str(d.patientName),
    lot: str(d.lot),
    byName: str(d.byName),
  };
}

async function readSnapshot(clinicId: string): Promise<StockSnapshot> {
  const [drawers, items, variants, lines, counts, deliveries, uses] = await Promise.all([
    adminClinicCollection(clinicId, "stock_drawers").get(),
    adminClinicCollection(clinicId, "stock_items").get(),
    adminClinicCollection(clinicId, "stock_variants").get(),
    adminClinicCollection(clinicId, "stock_lines").get(),
    adminClinicCollection(clinicId, "stock_counts").orderBy("date", "desc").limit(30).get(),
    adminClinicCollection(clinicId, "stock_deliveries").orderBy("date", "desc").limit(200).get(),
    adminClinicCollection(clinicId, "stock_uses").orderBy("date", "desc").limit(300).get(),
  ]);
  const suppliers = new Set<string>(DEFAULT_SUPPLIERS);
  deliveries.forEach((d) => {
    const s = str(d.data().supplier);
    if (s) suppliers.add(s);
  });
  return {
    drawers: drawers.docs.map((d) => drawerOf(d.id, d.data())).sort((a, b) => a.order - b.order || a.code.localeCompare(b.code)),
    items: items.docs.map((d) => itemOf(d.id, d.data())),
    variants: variants.docs.map((d) => variantOf(d.id, d.data())),
    lines: lines.docs.map((d) => lineOf(d.id, d.data())),
    counts: counts.docs.map((d) => countOf(d.id, d.data())).reverse(),
    deliveries: deliveries.docs.map((d) => deliveryOf(d.id, d.data())).reverse(),
    uses: uses.docs.map((d) => useOf(d.id, d.data())),
    suppliers: [...suppliers],
  };
}

// --- setup -----------------------------------------------------------------------------------

/** Firestore refuses `undefined`, so the id has to be left out rather than blanked. */
function withoutId<T extends { id: string }>(record: T): Omit<T, "id"> {
  const { id: _id, ...rest } = record;
  void _id;
  return rest;
}

/** Room code ordering: chairs first, then sterilisation, then the store. */
function roomOrder(roomCode: string): number {
  if (roomCode === "ST") return 900;
  if (roomCode === "SR") return 950;
  const n = Number(roomCode.replace(/\D/g, ""));
  return Number.isFinite(n) ? n * 10 : 500;
}
function drawerOrder(roomCode: string, letter: string, number: number): number {
  return roomOrder(roomCode) * 1000 + (letter.charCodeAt(0) - 64) * 100 + number;
}

/**
 * Build the clinic's cupboard from the standard map and the items it picked.
 *
 * Idempotent by code and catalogue key: a second run adds what is missing and touches nothing
 * that exists, so a clinic can come back and tick more items without losing its photos or counts.
 */
async function setup(args: { clinicId: string; actor: Actor; body: Body }) {
  const { clinicId, actor, body } = args;
  const chairs = Math.min(8, Math.max(1, Math.round(num(body.chairs, 1))));
  const keys = Array.isArray(body.itemKeys) ? (body.itemKeys as unknown[]).map((k) => str(k)).filter((k) => CATALOG_BY_KEY[k]) : [];
  if (!keys.length) return bad("Pick at least one item to stock.");

  const pickedGroups = new Set<CatalogGroup>(keys.map((k) => CATALOG_BY_KEY[k].group));
  const existing = await readSnapshot(clinicId);
  const drawerByCode = new Map(existing.drawers.map((d) => [d.code, d]));
  const itemByKey = new Map(existing.items.filter((i) => i.catalogKey).map((i) => [i.catalogKey as string, i]));
  const genericByItem = new Map(existing.variants.filter((v) => v.isGeneric).map((v) => [v.itemId, v]));
  const lineIds = new Set(existing.lines.map((l) => l.id));

  const batch = adminDb().batch();
  let writes = 0;
  const createdDrawers: StockDrawer[] = [];

  const ensureDrawer = (roomCode: string, roomEn: string, roomAr: string, sd: StandardDrawer): StockDrawer => {
    const code = `${roomCode}-${sd.cabinet}${sd.number}`;
    const found = drawerByCode.get(code);
    if (found) return found;
    const ref = adminClinicCollection(clinicId, "stock_drawers").doc();
    const d: StockDrawer = {
      id: ref.id,
      code,
      roomCode,
      roomEn,
      roomAr,
      cabinetLetter: sd.cabinet,
      cabinetWhere: sd.where.en,
      number: sd.number,
      nameEn: sd.nameEn,
      nameAr: sd.nameAr,
      photoUrl: null,
      tracked: sd.tracked === true,
      order: drawerOrder(roomCode, sd.cabinet, sd.number),
    };
    batch.set(ref, { ...withoutId(d), cabinetWhereAr: sd.where.ar, createdAt: FieldValue.serverTimestamp() });
    writes++;
    drawerByCode.set(code, d);
    createdDrawers.push(d);
    return d;
  };

  // Which standard drawers this clinic needs: every chair drawer whose groups were picked, the
  // specialist drawers on chair 1 for picked specialist groups, sterilisation, and the store.
  const placements: Array<{ drawer: StockDrawer; groups: CatalogGroup[] }> = [];
  for (let c = 1; c <= chairs; c++) {
    const roomCode = `C${c}`;
    for (const sd of CHAIR_DRAWERS) {
      if (!sd.groups.some((g) => pickedGroups.has(g))) continue;
      placements.push({ drawer: ensureDrawer(roomCode, `${ROOM_NAMES.chair.en} ${c}`, `${ROOM_NAMES.chair.ar} ${c}`, sd), groups: sd.groups });
    }
    if (c === 1) {
      for (const sd of SPECIALIST_DRAWERS) {
        if (!sd.groups.some((g) => pickedGroups.has(g))) continue;
        placements.push({ drawer: ensureDrawer(roomCode, `${ROOM_NAMES.chair.en} 1`, `${ROOM_NAMES.chair.ar} 1`, sd), groups: sd.groups });
      }
    }
  }
  for (const sd of STERI_DRAWERS) {
    if (!sd.groups.some((g) => pickedGroups.has(g))) continue;
    placements.push({ drawer: ensureDrawer("ST", ROOM_NAMES.ST.en, ROOM_NAMES.ST.ar, sd), groups: sd.groups });
  }
  for (const sd of STORE_DRAWERS) {
    if (!sd.groups.some((g) => pickedGroups.has(g))) continue;
    placements.push({ drawer: ensureDrawer("SR", ROOM_NAMES.SR.en, ROOM_NAMES.SR.ar, sd), groups: sd.groups });
  }

  for (const key of keys) {
    const c = CATALOG_BY_KEY[key];
    let item = itemByKey.get(key);
    if (!item) {
      const ref = adminClinicCollection(clinicId, "stock_items").doc();
      item = { id: ref.id, nameEn: c.en, nameAr: c.ar, unit: c.unit, per: c.per, shape: c.shape, tracked: c.tracked === true, catalogKey: key, photoUrl: null };
      batch.set(ref, { ...withoutId(item), syn: c.syn || "", createdAt: FieldValue.serverTimestamp() });
      writes++;
      itemByKey.set(key, item);
    }
    let generic = genericByItem.get(item.id);
    if (!generic) {
      const ref = adminClinicCollection(clinicId, "stock_variants").doc();
      generic = { id: ref.id, itemId: item.id, brand: "", product: c.en, spec: "", barcode: null, photoUrl: null, supplier: null, lastPrice: null, isGeneric: true };
      batch.set(ref, { ...withoutId(generic), createdAt: FieldValue.serverTimestamp() });
      writes++;
      genericByItem.set(item.id, generic);
    }
    for (const p of placements) {
      if (!p.groups.includes(c.group)) continue;
      const id = lineKey(generic.id, p.drawer.id);
      if (lineIds.has(id)) continue;
      batch.set(adminClinicDoc(clinicId, "stock_lines", id), {
        variantId: generic.id,
        itemId: item.id,
        drawerId: p.drawer.id,
        qty: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writes++;
      lineIds.add(id);
    }
  }

  if (writes > 450) return bad("That is too much to set up in one go. Pick fewer items and come back for the rest.");
  if (writes) await batch.commit();
  await logActivityServer({ clinicId, user: actor, action: "Stock Setup", details: `${chairs} chair(s), ${keys.length} items, ${createdDrawers.length} new drawers`, severity: "LOW" });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId), createdDrawers: createdDrawers.length });
}

// --- structure -------------------------------------------------------------------------------

async function saveDrawer(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const id = str(body.id);
  const roomCode = str(body.roomCode).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const letter = str(body.cabinetLetter, "A").toUpperCase().slice(0, 1) || "A";
  const number = Math.max(1, Math.round(num(body.number, 1)));
  if (!roomCode) return bad("A drawer needs a room code, like C1 or SR.");
  const code = `${roomCode}-${letter}${number}`;
  const clash = await adminClinicCollection(clinicId, "stock_drawers").where("code", "==", code).limit(1).get();
  if (!clash.empty && clash.docs[0].id !== id) return bad(`There is already a drawer ${code}.`);
  const patch: Body = {
    code,
    roomCode,
    roomEn: str(body.roomEn) || roomCode,
    roomAr: str(body.roomAr) || str(body.roomEn) || roomCode,
    cabinetLetter: letter,
    cabinetWhere: str(body.cabinetWhere),
    number,
    nameEn: str(body.nameEn) || code,
    nameAr: str(body.nameAr) || str(body.nameEn) || code,
    tracked: body.tracked === true,
    order: drawerOrder(roomCode, letter, number),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (typeof body.photoUrl === "string") patch.photoUrl = body.photoUrl || null;
  if (id) await adminClinicDoc(clinicId, "stock_drawers", id).set(patch, { merge: true });
  else await adminClinicCollection(clinicId, "stock_drawers").add({ ...patch, photoUrl: patch.photoUrl ?? null, createdAt: FieldValue.serverTimestamp() });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

async function setPhoto(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const kind = str(body.kind);
  const id = str(body.id);
  const url = str(body.photoUrl);
  const coll = kind === "drawer" ? "stock_drawers" : kind === "item" ? "stock_items" : kind === "variant" ? "stock_variants" : null;
  if (!coll || !id) return bad("Which photo?");
  if (url && !/^https:\/\//.test(url)) return bad("That is not an uploaded photo.");
  await adminClinicDoc(clinicId, coll, id).set({ photoUrl: url || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

async function addItem(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const nameEn = str(body.nameEn);
  const nameAr = str(body.nameAr) || nameEn;
  const drawerId = str(body.drawerId);
  if (!nameEn) return bad("The item needs a name.");
  if (!drawerId) return bad("Which drawer does it live in?");
  const drawer = await adminClinicDoc(clinicId, "stock_drawers", drawerId).get();
  if (!drawer.exists) return bad("That drawer no longer exists.", 404);
  const catalogKey = str(body.catalogKey) || null;
  const c = catalogKey ? CATALOG_BY_KEY[catalogKey] : null;
  const batch = adminDb().batch();
  const itemRef = adminClinicCollection(clinicId, "stock_items").doc();
  batch.set(itemRef, {
    nameEn,
    nameAr,
    unit: str(body.unit, c?.unit || "box"),
    per: str(body.per, c?.per || ""),
    shape: shapeOf(body.shape || c?.shape),
    tracked: body.tracked === true || c?.tracked === true,
    catalogKey,
    photoUrl: str(body.photoUrl) || null,
    syn: c?.syn || "",
    createdAt: FieldValue.serverTimestamp(),
  });
  const varRef = adminClinicCollection(clinicId, "stock_variants").doc();
  batch.set(varRef, { itemId: itemRef.id, brand: "", product: nameEn, spec: "", barcode: null, photoUrl: null, supplier: null, lastPrice: null, isGeneric: true, createdAt: FieldValue.serverTimestamp() });
  batch.set(adminClinicDoc(clinicId, "stock_lines", lineKey(varRef.id, drawerId)), {
    variantId: varRef.id,
    itemId: itemRef.id,
    drawerId,
    qty: Math.max(0, Math.round(num(body.qty))),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return NextResponse.json({ ok: true, itemId: itemRef.id, snapshot: await readSnapshot(clinicId) });
}

async function updateItem(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const id = str(body.id);
  if (!id) return bad("Which item?");
  const patch: Body = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof body.nameEn === "string" && body.nameEn.trim()) patch.nameEn = body.nameEn.trim();
  if (typeof body.nameAr === "string" && body.nameAr.trim()) patch.nameAr = body.nameAr.trim();
  if (typeof body.unit === "string" && body.unit.trim()) patch.unit = body.unit.trim();
  if (typeof body.per === "string") patch.per = body.per.trim();
  if (typeof body.tracked === "boolean") patch.tracked = body.tracked;
  await adminClinicDoc(clinicId, "stock_items", id).set(patch, { merge: true });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

async function addVariant(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const itemId = str(body.itemId);
  const drawerId = str(body.drawerId);
  const brand = str(body.brand);
  if (!itemId) return bad("Which item is this a brand of?");
  if (!brand) return bad("The brand needs a name.");
  const item = await adminClinicDoc(clinicId, "stock_items", itemId).get();
  if (!item.exists) return bad("That item no longer exists.", 404);
  const ref = adminClinicCollection(clinicId, "stock_variants").doc();
  const batch = adminDb().batch();
  batch.set(ref, {
    itemId,
    brand,
    product: str(body.product) || str(item.data()?.nameEn),
    spec: str(body.spec),
    barcode: str(body.barcode) || null,
    photoUrl: str(body.photoUrl) || null,
    supplier: str(body.supplier) || null,
    lastPrice: num(body.lastPrice) > 0 ? num(body.lastPrice) : null,
    isGeneric: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (drawerId) {
    batch.set(adminClinicDoc(clinicId, "stock_lines", lineKey(ref.id, drawerId)), {
      variantId: ref.id,
      itemId,
      drawerId,
      qty: Math.max(0, Math.round(num(body.qty))),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return NextResponse.json({ ok: true, variantId: ref.id, snapshot: await readSnapshot(clinicId) });
}

async function addLine(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const variantId = str(body.variantId);
  const drawerId = str(body.drawerId);
  if (!variantId || !drawerId) return bad("Which brand, into which drawer?");
  const v = await adminClinicDoc(clinicId, "stock_variants", variantId).get();
  if (!v.exists) return bad("That brand no longer exists.", 404);
  await adminClinicDoc(clinicId, "stock_lines", lineKey(variantId, drawerId)).set(
    { variantId, itemId: str(v.data()?.itemId), drawerId, qty: FieldValue.increment(0), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

/** A line can only leave a drawer empty: stock does not vanish by deleting its row. */
/**
 * Take a row out of a drawer.
 *
 * An empty row simply goes. A row that still holds stock goes only when the person confirms it
 * (`writeOff`), and that is written to the activity log with the quantity: what was on it will
 * read as used at the next count, which is the truth about a box that was thrown away, and a
 * manager can see who removed it and when.
 */
async function removeLine(args: { clinicId: string; actor: Actor; body: Body }) {
  const { clinicId, actor, body } = args;
  const id = str(body.lineId);
  if (!id) return bad("Which line?");
  const ref = adminClinicDoc(clinicId, "stock_lines", id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
  const qty = Math.max(0, num(snap.data()?.qty));
  if (qty > 0 && body.writeOff !== true) return bad("This row still has stock. Confirm the delete to write it off.", 409);
  await ref.delete();
  if (qty > 0) {
    const [variant, drawer] = await Promise.all([
      adminClinicDoc(clinicId, "stock_variants", str(snap.data()?.variantId)).get(),
      adminClinicDoc(clinicId, "stock_drawers", str(snap.data()?.drawerId)).get(),
    ]);
    const what = [str(variant.data()?.brand), str(variant.data()?.product), str(variant.data()?.spec)].filter(Boolean).join(" ");
    await logActivityServer({ clinicId, user: actor, action: "Stock Written Off", details: `${qty} x ${what || "item"} removed from drawer ${str(drawer.data()?.code)}`, severity: "MEDIUM" });
  }
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

/** Correct a brand: its name, shade, barcode, supplier or price. Naming a brandless row makes it a brand. */
async function updateVariant(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const id = str(body.id);
  if (!id) return bad("Which brand?");
  const ref = adminClinicDoc(clinicId, "stock_variants", id);
  const snap = await ref.get();
  if (!snap.exists) return bad("That brand no longer exists.", 404);
  const patch: Body = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof body.brand === "string") {
    const brand = body.brand.trim();
    if (brand) {
      patch.brand = brand;
      patch.isGeneric = false;
    } else if (snap.data()?.isGeneric !== true) return bad("A brand needs a name.");
  }
  if (typeof body.product === "string" && body.product.trim()) patch.product = body.product.trim();
  if (typeof body.spec === "string") patch.spec = body.spec.trim();
  if (typeof body.barcode === "string") patch.barcode = body.barcode.trim() || null;
  if (typeof body.supplier === "string") patch.supplier = body.supplier.trim() || null;
  if (body.lastPrice !== undefined) patch.lastPrice = num(body.lastPrice) > 0 ? num(body.lastPrice) : null;
  await ref.set(patch, { merge: true });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

/**
 * Carry a row to another drawer, with what is on it. If the brand already has a row there, the
 * two become one. Nothing is used and nothing is delivered, and the usage arithmetic agrees: it
 * adds a brand up across all its drawers, so a move cancels itself.
 */
async function moveLine(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const id = str(body.lineId);
  const toDrawerId = str(body.toDrawerId);
  if (!id || !toDrawerId) return bad("Which row, to which drawer?");
  const drawer = await adminClinicDoc(clinicId, "stock_drawers", toDrawerId).get();
  if (!drawer.exists) return bad("That drawer no longer exists.", 404);
  const fromRef = adminClinicDoc(clinicId, "stock_lines", id);
  await adminDb().runTransaction(async (tx) => {
    const from = await tx.get(fromRef);
    if (!from.exists) throw new Error("That row no longer exists.");
    const variantId = str(from.data()?.variantId);
    if (str(from.data()?.drawerId) === toDrawerId) return;
    const toRef = adminClinicDoc(clinicId, "stock_lines", lineKey(variantId, toDrawerId));
    const to = await tx.get(toRef);
    const qty = Math.max(0, num(from.data()?.qty)) + (to.exists ? Math.max(0, num(to.data()?.qty)) : 0);
    tx.set(toRef, { variantId, itemId: str(from.data()?.itemId), drawerId: toDrawerId, qty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.delete(fromRef);
  });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

// --- the three events ------------------------------------------------------------------------

/**
 * The weekly count. The whole walk lands as one document carrying every line's quantity, so
 * usage between any two counts is a subtraction and no line is ever "not counted" — a drawer
 * the assistant skipped with "same as last week" is recorded at last week's number, which is
 * exactly what they asserted.
 */
async function saveCount(args: { clinicId: string; actor: Actor; body: Body }) {
  const { clinicId, actor, body } = args;
  const date = isDate(body.date) ? body.date : todayKey();
  const values = body.values && typeof body.values === "object" ? (body.values as Record<string, unknown>) : {};
  const lines = await adminClinicCollection(clinicId, "stock_lines").get();
  const batch = adminDb().batch();
  const snapshot: Record<string, number> = {};
  let changed = 0;
  lines.forEach((doc) => {
    const current = Math.max(0, num(doc.data().qty));
    const proposed = values[doc.id];
    const next = proposed === undefined || proposed === null ? current : Math.max(0, Math.round(num(proposed, current)));
    snapshot[doc.id] = next;
    if (next !== current) {
      changed++;
      batch.set(doc.ref, { qty: next, updatedAt: FieldValue.serverTimestamp(), lastCountedAt: date }, { merge: true });
    } else {
      batch.set(doc.ref, { lastCountedAt: date }, { merge: true });
    }
  });
  // One count per day. A second save on the same date (a drawer counted from its own page, a walk
  // finished after lunch) updates that day's count instead of adding another, so the gap between
  // two counts is always real calendar time.
  const sameDay = await adminClinicCollection(clinicId, "stock_counts").where("date", "==", date).limit(1).get();
  const countRef = sameDay.empty ? adminClinicCollection(clinicId, "stock_counts").doc() : sameDay.docs[0].ref;
  const earlierChanges = sameDay.empty ? 0 : num(sameDay.docs[0].data().changed);
  batch.set(
    countRef,
    {
      date,
      byUid: actor.uid,
      byName: actor.name,
      snapshot,
      changed: earlierChanges + changed,
      lines: lines.size,
      updatedAt: FieldValue.serverTimestamp(),
      ...(sameDay.empty ? { createdAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true }
  );
  await batch.commit();
  await logActivityServer({ clinicId, user: actor, action: "Stock Counted", details: `${lines.size} lines, ${changed} changed`, severity: "LOW" });
  return NextResponse.json({ ok: true, countId: countRef.id, changed, snapshot: await readSnapshot(clinicId) });
}

async function lookupBarcode(args: { clinicId: string; body: Body }) {
  const { clinicId, body } = args;
  const barcode = str(body.barcode).replace(/\s+/g, "");
  if (!barcode) return bad("No barcode.");
  const [mine, lib] = await Promise.all([
    adminClinicCollection(clinicId, "stock_variants").where("barcode", "==", barcode).limit(1).get(),
    adminDb().collection(LIBRARY).doc(barcode).get(),
  ]);
  const variant = mine.empty ? null : variantOf(mine.docs[0].id, mine.docs[0].data());
  const ld = lib.data();
  const library: LibraryProduct | null = ld
    ? {
        barcode,
        brand: str(ld.brand),
        product: str(ld.product),
        spec: str(ld.spec),
        photoUrl: typeof ld.photoUrl === "string" ? ld.photoUrl : null,
        catalogKey: typeof ld.catalogKey === "string" ? ld.catalogKey : null,
        shape: shapeOf(ld.shape),
        unit: str(ld.unit, "box") as StockUnit,
      }
    : null;
  return NextResponse.json({ ok: true, variant, library });
}

/**
 * A delivery: the only way stock goes up.
 *
 * Lines name an existing brand, or describe a new one (brand, product, spec, barcode, photo,
 * item). New brands become variants; every line's drawer gets its quantity added; the supplier
 * and price are remembered on the variant; a Supplies expense posts to the ledger for the total;
 * and any barcode we were told about is written to the shared library so the next clinic never
 * has to type it.
 */
async function receiveDelivery(args: { clinicId: string; actor: Actor; body: Body }) {
  const { clinicId, actor, body } = args;
  const date = isDate(body.date) ? body.date : todayKey();
  const supplier = str(body.supplier) || "Other";
  const invoiceUrl = str(body.invoiceUrl) || null;
  const rawLines = Array.isArray(body.lines) ? (body.lines as Body[]) : [];
  if (!rawLines.length) return bad("Nothing to receive.");

  const items = new Map((await adminClinicCollection(clinicId, "stock_items").get()).docs.map((d) => [d.id, itemOf(d.id, d.data())]));
  const drawers = new Set((await adminClinicCollection(clinicId, "stock_drawers").get()).docs.map((d) => d.id));
  const batch = adminDb().batch();
  const finalLines: Array<{ variantId: string; drawerId: string; qty: number; price: number; itemId: string }> = [];
  const libraryWrites: Array<{ barcode: string; data: Body }> = [];

  for (const l of rawLines) {
    const drawerId = str(l.drawerId);
    const qty = Math.max(1, Math.round(num(l.qty, 1)));
    const price = Math.max(0, num(l.price));
    if (!drawers.has(drawerId)) return bad("One of the lines points at a drawer that no longer exists.");
    let variantId = str(l.variantId);
    let itemId = "";
    if (variantId) {
      const v = await adminClinicDoc(clinicId, "stock_variants", variantId).get();
      if (!v.exists) return bad("One of the brands no longer exists.");
      itemId = str(v.data()?.itemId);
      const vPatch: Body = { supplier, lastPrice: price > 0 ? price : v.data()?.lastPrice ?? null, updatedAt: FieldValue.serverTimestamp() };
      const bc = str(l.barcode);
      if (bc && !v.data()?.barcode) vPatch.barcode = bc;
      batch.set(v.ref, vPatch, { merge: true });
      const barcode = bc || str(v.data()?.barcode);
      if (barcode && !v.data()?.isGeneric) {
        const item = items.get(itemId);
        libraryWrites.push({ barcode, data: { brand: str(v.data()?.brand), product: str(v.data()?.product), spec: str(v.data()?.spec), photoUrl: v.data()?.photoUrl ?? null, catalogKey: item?.catalogKey ?? null, shape: item?.shape ?? "box", unit: item?.unit ?? "box" } });
      }
    } else {
      const nv = l.newVariant && typeof l.newVariant === "object" ? (l.newVariant as Body) : null;
      if (!nv) return bad("A line needs a brand or a new product.");
      itemId = str(nv.itemId);
      const item = items.get(itemId);
      if (!item) return bad("A new product must say which item it is.");
      const ref = adminClinicCollection(clinicId, "stock_variants").doc();
      const barcode = str(nv.barcode) || null;
      const brand = str(nv.brand) || "Unbranded";
      const product = str(nv.product) || item.nameEn;
      const spec = str(nv.spec);
      const photoUrl = str(nv.photoUrl) || null;
      batch.set(ref, { itemId, brand, product, spec, barcode, photoUrl, supplier, lastPrice: price > 0 ? price : null, isGeneric: false, createdAt: FieldValue.serverTimestamp() });
      variantId = ref.id;
      if (barcode) libraryWrites.push({ barcode, data: { brand, product, spec, photoUrl, catalogKey: item.catalogKey, shape: item.shape, unit: item.unit } });
    }
    batch.set(
      adminClinicDoc(clinicId, "stock_lines", lineKey(variantId, drawerId)),
      { variantId, itemId, drawerId, qty: FieldValue.increment(qty), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    finalLines.push({ variantId, drawerId, qty, price, itemId });
  }

  // A box received after that day's count is on the shelf at the end of the day, so the day's
  // count has to say so — otherwise next week it looks like stock that appeared from nowhere.
  const countThatDay = await adminClinicCollection(clinicId, "stock_counts").where("date", "==", date).limit(1).get();
  if (!countThatDay.empty) {
    for (const l of finalLines) {
      batch.update(countThatDay.docs[0].ref, new FieldPath("snapshot", lineKey(l.variantId, l.drawerId)), FieldValue.increment(l.qty));
    }
  }

  const total = finalLines.reduce((a, l) => a + l.qty * l.price, 0);
  const deliveryRef = adminClinicCollection(clinicId, "stock_deliveries").doc();
  let ledgerId: string | null = null;
  if (total > 0) {
    const ledgerRef = adminClinicCollection(clinicId, "ledger").doc();
    const row = buildManualEntryRow({
      type: "expense",
      amount: total,
      description: `Supplies · ${supplier} · ${finalLines.length} line${finalLines.length === 1 ? "" : "s"}`,
      category: "Supplies",
      date,
      method: "Cash",
      isRecurring: false,
      actor: { uid: actor.uid, name: actor.name },
    });
    batch.set(ledgerRef, { ...row, stockDeliveryId: deliveryRef.id, createdAt: FieldValue.serverTimestamp() });
    ledgerId = ledgerRef.id;
    await recordMoneyChange({
      entry: { clinicId, action: "create", collection: "ledger", documentId: ledgerRef.id, after: row, actor, via: "stock:receive-delivery" },
      action: "Finance Entry Created",
      details: `EXPENSE ${total} EGP - ${row.description}`,
    });
  }
  batch.set(deliveryRef, {
    date,
    supplier,
    invoiceUrl,
    lines: finalLines.map(({ variantId, drawerId, qty, price }) => ({ variantId, drawerId, qty, price })),
    total,
    ledgerId,
    byUid: actor.uid,
    byName: actor.name,
    createdAt: FieldValue.serverTimestamp(),
  });
  for (const w of libraryWrites) {
    batch.set(adminDb().collection(LIBRARY).doc(w.barcode), { ...w.data, updatedAt: FieldValue.serverTimestamp(), updatedByClinic: clinicId }, { merge: true });
  }
  await batch.commit();
  await logActivityServer({ clinicId, user: actor, action: "Stock Delivery Received", details: `${supplier}: ${finalLines.length} lines, ${total} EGP`, severity: "LOW" });
  return NextResponse.json({ ok: true, deliveryId: deliveryRef.id, ledgerId, total, snapshot: await readSnapshot(clinicId) });
}

/** A tracked item leaves the drawer for a patient's mouth, with its lot number. */
async function recordPatientUse(args: { clinicId: string; actor: Actor; body: Body }) {
  const { clinicId, actor, body } = args;
  const variantId = str(body.variantId);
  const drawerId = str(body.drawerId);
  const patientName = str(body.patientName);
  if (!variantId || !drawerId) return bad("Which item, from which drawer?");
  if (!patientName) return bad("Which patient?");
  const lineRef = adminClinicDoc(clinicId, "stock_lines", lineKey(variantId, drawerId));
  const useRef = adminClinicCollection(clinicId, "stock_uses").doc();
  await adminDb().runTransaction(async (tx) => {
    const line = await tx.get(lineRef);
    if (!line.exists) throw new Error("That brand is not in that drawer.");
    const qty = Math.max(0, num(line.data()?.qty));
    if (qty <= 0) throw new Error("The drawer shows none left. Count it first if that is wrong.");
    tx.set(lineRef, { qty: qty - 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(useRef, {
      date: isDate(body.date) ? body.date : todayKey(),
      variantId,
      drawerId,
      itemId: str(line.data()?.itemId),
      patientId: str(body.patientId) || null,
      patientName,
      lot: str(body.lot),
      byUid: actor.uid,
      byName: actor.name,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
}

// --- dispatcher ------------------------------------------------------------------------------

const PERMISSION: Record<string, string> = {
  snapshot: "access.inventory",
  "lookup-barcode": "access.inventory",
  setup: "inventory.add",
  "save-drawer": "inventory.add",
  "add-item": "inventory.add",
  "update-item": "inventory.add",
  "add-variant": "inventory.add",
  "add-line": "inventory.add",
  "remove-line": "inventory.add",
  "update-variant": "inventory.add",
  "move-line": "inventory.add",
  "set-photo": "inventory.edit",
  "save-count": "inventory.edit",
  "receive-delivery": "inventory.edit",
  "use-on-patient": "inventory.edit",
};

export async function POST(request: Request) {
  let action = "";
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    action = str(body.action);
    const permission = PERMISSION[action];
    if (!permission) return bad(`Unknown action "${action}".`);
    const requested = str(body.clinicId) || undefined;
    const readOnly = action === "snapshot" || action === "lookup-barcode";
    const staff = await requireStaffPermission(request, requested, permission, { allowInactive: readOnly });
    if (!staff.ok) return staff.response;
    const clinicId = await resolveUserClinicId(staff.uid, requested ?? null);
    const actor: Actor = { uid: staff.uid, name: staff.name, role: staff.role };

    switch (action) {
      case "snapshot":
        return NextResponse.json({ ok: true, snapshot: await readSnapshot(clinicId) });
      case "setup":
        return await setup({ clinicId, actor, body });
      case "save-drawer":
        return await saveDrawer({ clinicId, body });
      case "set-photo":
        return await setPhoto({ clinicId, body });
      case "add-item":
        return await addItem({ clinicId, body });
      case "update-item":
        return await updateItem({ clinicId, body });
      case "add-variant":
        return await addVariant({ clinicId, body });
      case "add-line":
        return await addLine({ clinicId, body });
      case "remove-line":
        return await removeLine({ clinicId, actor, body });
      case "update-variant":
        return await updateVariant({ clinicId, body });
      case "move-line":
        return await moveLine({ clinicId, body });
      case "save-count":
        return await saveCount({ clinicId, actor, body });
      case "lookup-barcode":
        return await lookupBarcode({ clinicId, body });
      case "receive-delivery":
        return await receiveDelivery({ clinicId, actor, body });
      case "use-on-patient":
        return await recordPatientUse({ clinicId, actor, body });
      default:
        return bad(`Unknown action "${action}".`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message && /none left|not in that drawer|no longer exists/i.test(message)) return bad(message, 409);
    reportServerError("stock route failed", e, { action });
    return bad("Something went wrong. Nothing was changed.", 500);
  }
}
