/**
 * The stock module's records, as they travel between the API route and the screens.
 *
 * Everything here is clinic-scoped under `clinics/{clinicId}/stock_*` except the barcode
 * library, which is one shared root collection — the point of it is that the first clinic to
 * scan a box names it for everyone. See docs/superpowers/specs/2026-11-09-stock-cupboard-design.md.
 */

/** What a product physically is — picks the drawn placeholder when no photo exists. */
export type StockShape = "syringe" | "bottle" | "box" | "jar" | "pack" | "bag" | "cartridge" | "vial";

export type StockUnit =
  | "box" | "syringe" | "bottle" | "pack" | "jar" | "bag" | "cartridge" | "piece" | "vial" | "set" | "roll" | "can" | "tube" | "kit" | "strip";

export interface StockDrawer {
  id: string;
  /** `C1-A2` — room, cabinet, number. Unique per clinic. */
  code: string;
  roomCode: string;
  roomEn: string;
  roomAr: string;
  cabinetLetter: string;
  cabinetWhere: string;
  /** A drawer or an open shelf. Shelves are numbered on their own: `C1-AS1`. */
  kind: "drawer" | "shelf";
  number: number;
  nameEn: string;
  nameAr: string;
  photoUrl: string | null;
  /** Items here are used one at a time on a patient, not counted in boxes. */
  tracked: boolean;
  order: number;
}

export interface StockItem {
  id: string;
  nameEn: string;
  nameAr: string;
  unit: StockUnit;
  /** What one unit holds, for the label: "50 carpules", "4 g". */
  per: string;
  shape: StockShape;
  tracked: boolean;
  /** Key into the built-in catalogue, or null for a clinic's own item. */
  catalogKey: string | null;
  photoUrl: string | null;
}

export interface StockVariant {
  id: string;
  itemId: string;
  brand: string;
  product: string;
  spec: string;
  barcode: string | null;
  photoUrl: string | null;
  supplier: string | null;
  lastPrice: number | null;
  /**
   * The brandless placeholder every item gets at setup, so a drawer can hold "composite" before
   * the clinic has told us whose. Real brands arrive with deliveries and get their own lines.
   */
  isGeneric: boolean;
}

export interface StockLine {
  /** `${variantId}__${drawerId}` */
  id: string;
  variantId: string;
  itemId: string;
  drawerId: string;
  qty: number;
}

export interface StockCount {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  byName: string;
  /** Every line's quantity after this count, so usage between two counts is a subtraction. */
  snapshot: Record<string, number>;
  changed: number;
}

/**
 * One press of "Save count", kept on its own with its time. The daily `StockCount` above feeds
 * the usage reports; this is what the count-by-count comparison reads.
 */
export interface StockCountSave {
  id: string;
  /** Milliseconds since 1970, from the server's clock. */
  atMs: number;
  date: string;
  byName: string;
  byRole: string;
  /** The whole cupboard was walked. Otherwise `drawerCodes` says which drawers. */
  whole: boolean;
  drawerCodes: string[];
  counted: number;
  changed: number;
  firstEver: boolean;
}

/** One brand in a comparison of two counts: `last + moved − used = counted`. */
export interface CountCompareRow {
  variantId: string;
  drawerIds: string[];
  /** Quantity at the earlier count; null when there is no earlier count to compare with. */
  last: number | null;
  /** Came in (deliveries) minus went out on record (patient use, deleted rows) in between. */
  moved: number;
  /** What should have been there if nothing had been used. */
  expected: number;
  counted: number;
  /** Positive: used. Negative: more was found than expected. */
  used: number;
  /** This brand was part of the later count (not just carried along). */
  inCount: boolean;
}

export interface StockDeliveryLine {
  variantId: string;
  drawerId: string;
  qty: number;
  price: number;
}

export interface StockDelivery {
  id: string;
  date: string;
  supplier: string;
  invoiceUrl: string | null;
  lines: StockDeliveryLine[];
  total: number;
  ledgerId: string | null;
  byName: string;
}

export interface StockUse {
  id: string;
  date: string;
  variantId: string;
  drawerId: string;
  patientId: string | null;
  patientName: string;
  lot: string;
  byName: string;
}

export type StockEventType =
  | "count" | "count-saved" | "delivery" | "delivery-received" | "used" | "write-off" | "row-removed" | "moved"
  | "item-added" | "brand-added" | "row-added" | "item-edited" | "brand-edited" | "photo"
  | "cabinet-added" | "drawer-renamed" | "room-renamed" | "drawer-deleted" | "setup";

/**
 * One line of the stock history. Names are copied in as they were when it happened, so the line
 * still reads correctly after the item, brand or drawer is renamed, moved or deleted.
 */
export interface StockEvent {
  id: string;
  /** Milliseconds since 1970, from the server's clock. */
  atMs: number;
  date: string;
  byUid: string | null;
  byName: string;
  byRole: string;
  type: StockEventType;
  itemId?: string | null;
  variantId?: string | null;
  drawerId?: string | null;
  itemEn?: string;
  itemAr?: string;
  brand?: string;
  unit?: string;
  drawerCode?: string;
  drawerName?: string;
  toDrawerCode?: string;
  qtyBefore?: number;
  qtyAfter?: number;
  qty?: number;
  price?: number;
  supplier?: string;
  patientName?: string;
  lot?: string;
  changes?: Array<{ field: string; from: string; to: string }>;
  /** Two free numbers and a free word, whose meaning depends on the type (see describeEvent). */
  n1?: number;
  n2?: number;
  text?: string;
}

export type StockEventDraft = Omit<StockEvent, "id" | "atMs" | "date" | "byUid" | "byName" | "byRole">;

/** What the page loads in one call. */
export interface StockSnapshot {
  drawers: StockDrawer[];
  items: StockItem[];
  variants: StockVariant[];
  lines: StockLine[];
  counts: StockCount[];
  deliveries: StockDelivery[];
  uses: StockUse[];
  suppliers: string[];
}

export interface LibraryProduct {
  barcode: string;
  brand: string;
  product: string;
  spec: string;
  photoUrl: string | null;
  catalogKey: string | null;
  shape: StockShape;
  unit: StockUnit;
}
