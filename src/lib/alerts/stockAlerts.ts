import { reportPrefs } from "@/lib/notificationCatalog";
import { deliverClinicNotification, readAlertPreferences } from "@/lib/notificationDelivery";
import { unitLabel } from "@/lib/stock/catalog";
import { lowAlertText, lowCrossings, type LowAlertLine } from "@/lib/stock/low";
import type { StockSnapshot } from "@/lib/stock/types";

/**
 * The running-low alert, raised from the one door every stock write goes through (`/api/stock`).
 *
 * It compares the cupboard before a save with the cupboard after it and speaks only for the
 * brands that save took down to their warning level. Several in one save — a weekly count — are
 * one message, not one each. Who hears it, and on which of the bell, the phone and WhatsApp, is
 * the clinic's own answer in Settings → Alerts ("Something is running low").
 *
 * A notification is a courtesy about something already saved, so nothing here may fail the
 * save: every error is swallowed and the number of brands spoken for is all that comes back.
 */
export async function afterStockChange(clinicId: string, before: StockSnapshot, after: StockSnapshot): Promise<number> {
  try {
    const crossed = lowCrossings(before, after);
    if (!crossed.length) return 0;

    const prefs = await readAlertPreferences(clinicId);
    // The clinic's reports have a language; an alert about the same clinic speaks it too.
    const language = reportPrefs("eveningDigest", prefs).language;
    const ar = language === "ar";
    const items = new Map(after.items.map((i) => [i.id, i]));
    const variants = new Map(after.variants.map((v) => [v.id, v]));
    const drawers = new Map(after.drawers.map((d) => [d.id, d]));

    const rows: LowAlertLine[] = crossed
      .map((r) => {
        const item = items.get(r.itemId);
        const v = variants.get(r.variantId);
        const itemName = item ? (ar ? item.nameAr || item.nameEn : item.nameEn || item.nameAr) : "";
        const brand = v && !v.isGeneric ? [v.brand, v.product, v.spec].filter(Boolean).join(" ") : "";
        return {
          name: [itemName, brand].filter(Boolean).join(" · ") || (ar ? "صنف" : "An item"),
          onHand: r.onHand,
          unit: unitLabel(item?.unit || "box", r.onHand, ar),
          codes: r.drawerIds.map((id) => drawers.get(id)?.code || "").filter(Boolean).sort(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, language));

    const text = lowAlertText(rows, language);
    await deliverClinicNotification(
      clinicId,
      { title: text.title, body: text.body },
      { event: "stockLow", channel: "alpha_clinic", actionUrl: "/inventory", data: { screen: "inventory" }, whatsappText: text.whatsappText },
    );
    return rows.length;
  } catch (error) {
    console.warn("stockLow alert failed:", error);
    return 0;
  }
}
