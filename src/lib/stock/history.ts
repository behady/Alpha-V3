import { UNIT_NAMES } from "./catalog";
import type { StockDrawer, StockEvent, StockEventDraft, StockEventType, StockItem, StockLine, StockSnapshot, StockVariant } from "./types";

/**
 * The stock history: who did what, and when.
 *
 * Events are not written by each action separately. The route takes the cupboard as it stood
 * before an action and as it stands after, and this file works out what happened in between.
 * That is deliberate: an action somebody adds next year is in the history the day it ships,
 * because the history is derived from what changed, not from a line somebody remembered to
 * write. The action's name only decides how a change is worded — a quantity that went down is
 * "used on a patient", "written off" or "counted" depending on who asked for it.
 *
 * Every event carries the names as they were at the time (item, brand, drawer code), so the
 * history still reads correctly after something is renamed, moved or deleted.
 *
 * Pure: no database, no clock. tests/stockHistory.test.mts pins it.
 */

type Index = {
  drawers: Map<string, StockDrawer>;
  items: Map<string, StockItem>;
  variants: Map<string, StockVariant>;
  lines: Map<string, StockLine>;
};

function index(s: StockSnapshot): Index {
  return {
    drawers: new Map(s.drawers.map((d) => [d.id, d])),
    items: new Map(s.items.map((i) => [i.id, i])),
    variants: new Map(s.variants.map((v) => [v.id, v])),
    lines: new Map(s.lines.map((l) => [l.id, l])),
  };
}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

function brandLabel(v: StockVariant | undefined): string {
  if (!v || v.isGeneric) return "";
  return [v.brand, v.product, v.spec].filter(Boolean).join(" ");
}

export function deriveEvents(action: string, body: Record<string, unknown>, before: StockSnapshot, after: StockSnapshot, result: Record<string, unknown> = {}): StockEventDraft[] {
  const B = index(before);
  const A = index(after);
  const out: StockEventDraft[] = [];

  /** Labels for an item / brand / drawer, from the newer state when it still exists there. */
  const about = (ids: { itemId?: string | null; variantId?: string | null; drawerId?: string | null }): Partial<StockEventDraft> => {
    const variant = ids.variantId ? A.variants.get(ids.variantId) || B.variants.get(ids.variantId) : undefined;
    const itemId = ids.itemId || variant?.itemId || null;
    const item = itemId ? A.items.get(itemId) || B.items.get(itemId) : undefined;
    const drawer = ids.drawerId ? A.drawers.get(ids.drawerId) || B.drawers.get(ids.drawerId) : undefined;
    return {
      itemId: itemId || null,
      variantId: ids.variantId || null,
      drawerId: ids.drawerId || null,
      itemEn: item?.nameEn || "",
      itemAr: item?.nameAr || "",
      brand: brandLabel(variant),
      unit: item?.unit || "",
      drawerCode: drawer?.code || "",
      drawerName: drawer?.nameEn || "",
    };
  };
  const push = (type: StockEventType, ids: Parameters<typeof about>[0], extra: Partial<StockEventDraft> = {}) => out.push({ type, ...about(ids), ...extra });

  const diff = (pairs: Array<[string, unknown, unknown]>): Array<{ field: string; from: string; to: string }> =>
    pairs.filter(([, a, b]) => s(a) !== s(b)).map(([field, a, b]) => ({ field, from: s(a), to: s(b) }));

  const newDrawers = after.drawers.filter((d) => !B.drawers.has(d.id));
  const cabinetsAdded = () => {
    const groups = new Map<string, { roomName: string; drawers: number; shelves: number }>();
    for (const d of newDrawers) {
      const key = `${d.roomCode}-${d.cabinetLetter}`;
      const g = groups.get(key) || { roomName: d.roomEn, drawers: 0, shelves: 0 };
      if (d.kind === "shelf") g.shelves++;
      else g.drawers++;
      groups.set(key, g);
    }
    for (const [key, g] of groups) out.push({ type: "cabinet-added", text: key, drawerName: g.roomName, n1: g.drawers, n2: g.shelves });
  };
  const drawersEdited = () => {
    for (const d of after.drawers) {
      const was = B.drawers.get(d.id);
      if (!was) continue;
      const changes = diff([
        ["name", was.nameEn, d.nameEn],
        ["nameAr", was.nameAr, d.nameAr],
        ["where", was.cabinetWhere, d.cabinetWhere],
        ["perPatient", was.tracked, d.tracked],
      ]);
      // One name typed into both languages is one change, not two.
      const merged = changes.filter((c) => !(c.field === "nameAr" && changes.some((x) => x.field === "name" && x.to === c.to)));
      if (merged.length) push("drawer-renamed", { drawerId: d.id }, { changes: merged });
    }
  };

  switch (action) {
    case "save-count": {
      let changed = 0;
      const ids = new Set([...B.lines.keys(), ...A.lines.keys()]);
      for (const id of ids) {
        const was = B.lines.get(id);
        const now = A.lines.get(id);
        const qb = was?.qty ?? 0;
        const qa = now?.qty ?? 0;
        if (qb === qa) continue;
        changed++;
        const l = now || was;
        if (l) push("count", { variantId: l.variantId, itemId: l.itemId, drawerId: l.drawerId }, { qtyBefore: qb, qtyAfter: qa });
      }
      out.push({ type: "count-saved", n1: after.lines.length, n2: changed, text: s(body.date) });
      break;
    }
    case "receive-delivery": {
      const delivery = after.deliveries.find((d) => d.id === s(result.deliveryId)) || after.deliveries[after.deliveries.length - 1];
      if (!delivery) break;
      for (const l of delivery.lines) {
        const line = A.lines.get(`${l.variantId}__${l.drawerId}`);
        push("delivery", { variantId: l.variantId, drawerId: l.drawerId }, { qty: l.qty, price: l.price, supplier: delivery.supplier, qtyAfter: line?.qty, text: B.variants.has(l.variantId) ? "" : "new-brand" });
      }
      out.push({ type: "delivery-received", supplier: delivery.supplier, n1: delivery.lines.length, n2: delivery.total, text: delivery.date });
      break;
    }
    case "use-on-patient": {
      const id = `${s(body.variantId)}__${s(body.drawerId)}`;
      push("used", { variantId: s(body.variantId), drawerId: s(body.drawerId) }, { qty: 1, qtyBefore: B.lines.get(id)?.qty, qtyAfter: A.lines.get(id)?.qty, patientName: s(body.patientName), lot: s(body.lot) });
      break;
    }
    case "move-line": {
      const was = B.lines.get(s(body.lineId));
      if (!was || was.drawerId === s(body.toDrawerId)) break;
      const to = A.drawers.get(s(body.toDrawerId));
      push("moved", { variantId: was.variantId, itemId: was.itemId, drawerId: was.drawerId }, { qty: was.qty, toDrawerCode: to?.code || "" });
      break;
    }
    case "remove-line": {
      const was = B.lines.get(s(body.lineId));
      if (!was || A.lines.has(was.id)) break;
      push(was.qty > 0 ? "write-off" : "row-removed", { variantId: was.variantId, itemId: was.itemId, drawerId: was.drawerId }, { qty: was.qty, qtyBefore: was.qty, qtyAfter: 0 });
      break;
    }
    case "add-item": {
      for (const item of after.items) {
        if (B.items.has(item.id)) continue;
        const line = after.lines.find((l) => l.itemId === item.id);
        push("item-added", { itemId: item.id, variantId: line?.variantId, drawerId: line?.drawerId }, { qty: line?.qty ?? 0 });
      }
      break;
    }
    case "add-variant": {
      for (const v of after.variants) {
        if (B.variants.has(v.id)) continue;
        const line = after.lines.find((l) => l.variantId === v.id);
        push("brand-added", { variantId: v.id, drawerId: line?.drawerId }, { qty: line?.qty ?? 0 });
      }
      break;
    }
    case "add-line": {
      for (const l of after.lines) if (!B.lines.has(l.id)) push("row-added", { variantId: l.variantId, itemId: l.itemId, drawerId: l.drawerId });
      break;
    }
    case "update-item": {
      for (const item of after.items) {
        const was = B.items.get(item.id);
        if (!was) continue;
        const changes = diff([
          ["name", was.nameEn, item.nameEn],
          ["nameAr", was.nameAr, item.nameAr],
          ["unit", was.unit, item.unit],
          ["packSize", was.per, item.per],
          ["perPatient", was.tracked, item.tracked],
        ]);
        if (changes.length) push("item-edited", { itemId: item.id }, { changes });
      }
      break;
    }
    case "update-variant": {
      for (const v of after.variants) {
        const was = B.variants.get(v.id);
        if (!was) continue;
        const changes = diff([
          ["brand", was.isGeneric ? "" : was.brand, v.isGeneric ? "" : v.brand],
          ["product", was.isGeneric ? "" : was.product, v.isGeneric ? "" : v.product],
          ["shade", was.spec, v.spec],
          ["barcode", was.barcode, v.barcode],
          ["supplier", was.supplier, v.supplier],
          ["price", was.lastPrice, v.lastPrice],
        ]);
        if (changes.length) push("brand-edited", { variantId: v.id }, { changes });
      }
      break;
    }
    case "set-photo": {
      const kind = s(body.kind);
      const id = s(body.id);
      push("photo", kind === "drawer" ? { drawerId: id } : kind === "item" ? { itemId: id } : { variantId: id }, { text: kind });
      break;
    }
    case "rename-room": {
      const code = s(body.roomCode).toUpperCase();
      const was = before.drawers.find((d) => d.roomCode === code);
      const now = after.drawers.find((d) => d.roomCode === code);
      if (was && now && was.roomEn !== now.roomEn) out.push({ type: "room-renamed", text: code, changes: [{ field: "name", from: was.roomEn, to: now.roomEn }] });
      break;
    }
    case "delete-drawer": {
      for (const d of before.drawers) if (!A.drawers.has(d.id)) push("drawer-deleted", { drawerId: d.id });
      break;
    }
    case "setup": {
      cabinetsAdded();
      const items = after.items.filter((i) => !B.items.has(i.id)).length;
      if (newDrawers.length || items) out.push({ type: "setup", n1: newDrawers.length, n2: items });
      break;
    }
    case "add-cabinet":
      cabinetsAdded();
      break;
    case "rename-drawer":
      drawersEdited();
      break;
    case "save-drawer":
      cabinetsAdded();
      drawersEdited();
      break;
    default:
      break;
  }
  return out;
}

// --- reading -----------------------------------------------------------------------------------

export type EventGroup = "counts" | "deliveries" | "patients" | "losses" | "changes" | "layout";

export const EVENT_GROUP: Record<StockEventType, EventGroup> = {
  count: "counts",
  "count-saved": "counts",
  delivery: "deliveries",
  "delivery-received": "deliveries",
  used: "patients",
  "write-off": "losses",
  "row-removed": "losses",
  moved: "changes",
  "item-added": "changes",
  "brand-added": "changes",
  "row-added": "changes",
  "item-edited": "changes",
  "brand-edited": "changes",
  photo: "changes",
  "cabinet-added": "layout",
  "drawer-renamed": "layout",
  "room-renamed": "layout",
  "drawer-deleted": "layout",
  setup: "layout",
};

export const GROUP_LABEL: Record<EventGroup, { en: string; ar: string }> = {
  counts: { en: "Counts", ar: "العدّ" },
  deliveries: { en: "Deliveries", ar: "التوريدات" },
  patients: { en: "Used on patients", ar: "اتستخدم لمرضى" },
  losses: { en: "Deleted and written off", ar: "المسح والهالك" },
  changes: { en: "Edits and moves", ar: "تعديلات ونقل" },
  layout: { en: "Rooms and drawers", ar: "الغرف والأدراج" },
};

const FIELD_LABEL: Record<string, { en: string; ar: string }> = {
  name: { en: "name", ar: "الاسم" },
  nameAr: { en: "Arabic name", ar: "الاسم بالعربي" },
  unit: { en: "unit", ar: "الوحدة" },
  packSize: { en: "pack size", ar: "حجم العبوة" },
  perPatient: { en: "per-patient", ar: "لكل مريض" },
  where: { en: "place", ar: "المكان" },
  brand: { en: "brand", ar: "الماركة" },
  product: { en: "product", ar: "المنتج" },
  shade: { en: "shade/size", ar: "اللون/المقاس" },
  barcode: { en: "barcode", ar: "الباركود" },
  supplier: { en: "supplier", ar: "المورّد" },
  price: { en: "price", ar: "السعر" },
};

function unitWord(unit: string | undefined, n: number, ar: boolean): string {
  const u = UNIT_NAMES[unit || ""];
  if (!u) return "";
  return ar ? u.ar : n === 1 ? u.en : u.plural;
}

/** What the thing is called: the item, and its brand when it has one. */
export function eventSubject(e: StockEvent, ar: boolean): string {
  const item = ar ? e.itemAr || e.itemEn : e.itemEn || e.itemAr;
  return [item, e.brand].filter(Boolean).join(" · ");
}

function changesText(e: StockEvent, ar: boolean): string {
  return (e.changes || [])
    .map((c) => {
      const f = FIELD_LABEL[c.field] ? (ar ? FIELD_LABEL[c.field].ar : FIELD_LABEL[c.field].en) : c.field;
      const from = c.from || (ar ? "فاضي" : "empty");
      const to = c.to || (ar ? "فاضي" : "empty");
      // Arabic reads right to left, so "became" points left.
      return ar ? `${f}: ${from} ← ${to}` : `${f}: ${from} → ${to}`;
    })
    .join(" · ");
}

/** One sentence for one event, in the reader's language. */
export function describeEvent(e: StockEvent, ar: boolean): string {
  const what = eventSubject(e, ar);
  const code = e.drawerCode || "";
  const unit = (n: number) => unitWord(e.unit, n, ar);
  switch (e.type) {
    case "count":
      return ar ? `عدّ ${what} في ${code}: ${e.qtyBefore ?? 0} ← ${e.qtyAfter ?? 0}` : `Counted ${what} in ${code}: ${e.qtyBefore ?? 0} → ${e.qtyAfter ?? 0}`;
    case "count-saved":
      return ar ? `حفظ العدّ: ${e.n1 ?? 0} سطر اتراجع، ${e.n2 ?? 0} اتغير` : `Saved a count: ${e.n1 ?? 0} rows checked, ${e.n2 ?? 0} changed`;
    case "delivery":
      return ar
        ? `استلم ${e.qty ?? 0} ${unit(e.qty ?? 0)} ${what} في ${code}${e.price ? ` بسعر ${e.price} جنيه` : ""}${e.supplier ? ` من ${e.supplier}` : ""}${e.text === "new-brand" ? " (ماركة جديدة)" : ""}`
        : `Received ${e.qty ?? 0} ${unit(e.qty ?? 0)} of ${what} into ${code}${e.price ? ` at ${e.price} EGP` : ""}${e.supplier ? ` from ${e.supplier}` : ""}${e.text === "new-brand" ? " (new brand)" : ""}`;
    case "delivery-received":
      return ar ? `توريد من ${e.supplier || "—"}: ${e.n1 ?? 0} سطر، ${Math.round(e.n2 ?? 0).toLocaleString("en-US")} جنيه` : `Delivery from ${e.supplier || "—"}: ${e.n1 ?? 0} lines, ${Math.round(e.n2 ?? 0).toLocaleString("en-US")} EGP`;
    case "used":
      return ar
        ? `استخدم ${what} من ${code} للمريض ${e.patientName || "—"}${e.lot ? `، تشغيلة ${e.lot}` : ""}`
        : `Used ${what} from ${code} on ${e.patientName || "—"}${e.lot ? `, lot ${e.lot}` : ""}`;
    case "write-off":
      return ar ? `مسح ${what} من ${code} وعليه ${e.qty ?? 0} ${unit(e.qty ?? 0)} (هالك)` : `Deleted ${what} from ${code} with ${e.qty ?? 0} ${unit(e.qty ?? 0)} still on it (written off)`;
    case "row-removed":
      return ar ? `شال ${what} من ${code}` : `Removed ${what} from ${code}`;
    case "moved":
      return ar ? `نقل ${what} (${e.qty ?? 0}) من ${code} إلى ${e.toDrawerCode || "—"}` : `Moved ${what} (${e.qty ?? 0}) from ${code} to ${e.toDrawerCode || "—"}`;
    case "item-added":
      return ar ? `ضاف الصنف ${what} في ${code}${e.qty ? ` بكمية ${e.qty}` : ""}` : `Added the item ${what} to ${code}${e.qty ? ` with ${e.qty}` : ""}`;
    case "brand-added":
      return ar ? `ضاف الماركة ${what}${code ? ` في ${code}` : ""}${e.qty ? ` بكمية ${e.qty}` : ""}` : `Added the brand ${what}${code ? ` to ${code}` : ""}${e.qty ? ` with ${e.qty}` : ""}`;
    case "row-added":
      return ar ? `حط ${what} في ${code}` : `Placed ${what} in ${code}`;
    case "item-edited":
      return ar ? `عدّل الصنف ${what} — ${changesText(e, ar)}` : `Edited the item ${what} — ${changesText(e, ar)}`;
    case "brand-edited":
      return ar ? `عدّل الماركة ${what} — ${changesText(e, ar)}` : `Edited the brand ${what} — ${changesText(e, ar)}`;
    case "photo":
      return ar
        ? `غيّر صورة ${e.text === "drawer" ? `الدرج ${code}` : what}`
        : `Changed the photo of ${e.text === "drawer" ? `drawer ${code}` : what}`;
    case "cabinet-added":
      return ar
        ? `ضاف في الدولاب ${e.text || ""}: ${e.n1 ?? 0} درج${e.n2 ? ` و${e.n2} رف` : ""}`
        : `Added to cabinet ${e.text || ""}: ${e.n1 ?? 0} drawer${e.n1 === 1 ? "" : "s"}${e.n2 ? ` and ${e.n2} shel${e.n2 === 1 ? "f" : "ves"}` : ""}`;
    case "drawer-renamed":
      return ar ? `عدّل ${code} — ${changesText(e, ar)}` : `Edited ${code} — ${changesText(e, ar)}`;
    case "room-renamed":
      return ar ? `غيّر اسم الغرفة ${e.text || ""} — ${changesText(e, ar)}` : `Renamed room ${e.text || ""} — ${changesText(e, ar)}`;
    case "drawer-deleted":
      return ar ? `مسح ${code}${e.drawerName ? ` (${e.drawerName})` : ""}` : `Deleted ${code}${e.drawerName ? ` (${e.drawerName})` : ""}`;
    case "setup":
      return ar ? `تقسيمة جاهزة: ${e.n1 ?? 0} درج، ${e.n2 ?? 0} صنف` : `Ready-made layout: ${e.n1 ?? 0} drawers, ${e.n2 ?? 0} items`;
    default:
      return e.type;
  }
}
