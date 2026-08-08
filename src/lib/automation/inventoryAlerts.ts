import { adminClinicCollection } from "@/lib/adminClinicDb";

/**
 * Stock that has fallen to or below its reorder threshold.
 *
 * The subtlety worth stating: an item whose `minStock` is 0 has no threshold configured — that
 * was the field's old default and it is not a deliberate "tell me when this hits empty". Counting
 * those as healthy is how a low-stock check ends up reporting all-clear over a shelf nobody set
 * up, so they are excluded from the alert list and reported as their own number instead. A report
 * that says "nothing is low, but 40 items have no threshold" is useful; one that just says
 * "nothing is low" is misleading.
 */

export interface LowStockItem {
  itemId: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unit: string;
  isPercentage: boolean;
  /** True when stock has hit zero, not merely dipped below the reorder point. */
  outOfStock: boolean;
}

export interface InventoryAlertReport {
  scannedAt: string;
  clinicId: string;
  lowStock: LowStockItem[];
  counts: { total: number; low: number; outOfStock: number; noThreshold: number };
  notes: string[];
}

const SCAN_LIMIT = 4000;

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function scanInventoryAlerts(clinicId: string): Promise<InventoryAlertReport> {
  const snap = await adminClinicCollection(clinicId, "inventory").limit(SCAN_LIMIT).get();
  const notes: string[] = [];

  const lowStock: LowStockItem[] = [];
  let noThreshold = 0;

  snap.forEach((doc) => {
    const d = (doc.data() || {}) as Record<string, unknown>;
    const minStock = toNumber(d.minStock);
    const stock = toNumber(d.stock);

    if (minStock <= 0) {
      noThreshold++;
      return;
    }
    if (stock > minStock) return;

    lowStock.push({
      itemId: doc.id,
      name: typeof d.name === "string" ? d.name : "Unnamed item",
      category: typeof d.category === "string" ? d.category : "General",
      stock,
      minStock,
      unit: typeof d.unit === "string" ? d.unit : "pcs",
      isPercentage: Boolean(d.isPercentage),
      outOfStock: stock <= 0,
    });
  });

  // Out of stock first, then closest to the threshold.
  lowStock.sort((a, b) => {
    if (a.outOfStock !== b.outOfStock) return a.outOfStock ? -1 : 1;
    return a.stock - a.minStock - (b.stock - b.minStock);
  });

  if (noThreshold > 0) {
    notes.push(
      `${noThreshold} item${noThreshold === 1 ? " has" : "s have"} no reorder threshold set, so ` +
        "they can never appear in this list. Set one on each item for alerts to cover them."
    );
  }
  if (snap.size === 0) {
    notes.push("There are no inventory items recorded yet, so there is nothing to check.");
  }

  return {
    scannedAt: new Date().toISOString(),
    clinicId,
    lowStock,
    counts: {
      total: snap.size,
      low: lowStock.length,
      outOfStock: lowStock.filter((i) => i.outOfStock).length,
      noThreshold,
    },
    notes,
  };
}
