import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";
import {
  EMPTY_CATEGORY_COUNTS,
  categoryForTemplateKind,
  estimateMessageCostUsd,
  estimateMonthUsd,
  type MessageCategory,
  type WhatsappMonthCost,
} from "@/lib/whatsappCost";

/**
 * The server half of the WhatsApp bill: counting what we send, and asking Meta what it charged.
 *
 * Two numbers, kept apart on purpose.
 *
 *   `sentByCategory` / `estimatedUsd` — ours. Incremented as each message leaves, so the figure
 *      is available immediately and covers messages Meta has not reported yet.
 *   `billedUsd` — Meta's, pulled from `pricing_analytics` on the WABA. Authoritative, and the
 *      only one that matches the invoice.
 *
 * They will not agree, and that is information rather than a fault: our count includes the free
 * service replies (priced at zero) and assumes every recipient is Egyptian, while Meta's counts
 * only billable messages at the recipient's own country rate. A large gap means a template's
 * approved category is not the one this code thinks it is.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** "YYYY-MM" for a date, in the same shape the AI usage counters use. */
export function monthKeyOf(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/**
 * Record one outgoing message against the month's counters.
 *
 * Called from the single point every WhatsApp message passes through. Never throws and never
 * blocks a send: a cost counter that can stop a patient's reminder going out is worse than a
 * cost counter that is occasionally short.
 */
export async function recordWhatsappSend(
  clinicId: string,
  templateKind: string | null | undefined,
  when = new Date()
): Promise<void> {
  const category = categoryForTemplateKind(templateKind);
  const usd = estimateMessageCostUsd(templateKind);
  try {
    await adminClinicDoc(clinicId, "whatsapp_cost", monthKeyOf(when)).set(
      {
        monthKey: monthKeyOf(when),
        sentByCategory: { [category]: FieldValue.increment(1) },
        // Stored in USD, the currency Meta bills in. Never in pounds: an exchange rate baked into
        // a saved document goes stale without anyone noticing. Conversion happens at read time.
        estimatedUsd: FieldValue.increment(usd),
        sentTotal: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.error("Failed to record WhatsApp cost", e);
  }
}

type PricingPoint = { start: number; end: number; volume?: number; cost?: number };

/**
 * Meta's own billed volume and cost for a month.
 *
 * `pricing_analytics` is a field on the WhatsApp Business Account, read with the same system-user
 * token the sender uses. Returns null when the clinic has no Meta channel, when the token cannot
 * read the WABA, or when Meta has nothing for the range — all three are ordinary states, not
 * errors, and none of them should blank out the estimate we already have.
 */
export async function fetchMetaBilledForMonth(
  clinicId: string,
  monthKey: string
): Promise<{ billedUsd: number; billedMessages: number } | null> {
  const config = await loadMetaWhatsappConfig(clinicId).catch(() => null);
  if (!config?.wabaId || !config.token) return null;

  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return null;
  const start = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(y, m, 1) / 1000);

  const field = `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)`;
  try {
    const res = await fetch(`${GRAPH}/${config.wabaId}?fields=${encodeURIComponent(field)}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { pricing_analytics?: { data?: Array<{ data_points?: PricingPoint[] }> } };
    const groups = json.pricing_analytics?.data ?? [];
    if (!groups.length) return null;

    let billedUsd = 0;
    let billedMessages = 0;
    for (const group of groups) {
      for (const point of group.data_points ?? []) {
        billedUsd += Number(point.cost) || 0;
        billedMessages += Number(point.volume) || 0;
      }
    }
    return { billedUsd: Math.round(billedUsd * 10000) / 10000, billedMessages };
  } catch {
    // A billing figure is never worth an exception on a settings screen.
    return null;
  }
}

/** Everything the Settings card shows for one month. */
export async function loadWhatsappMonthCost(clinicId: string, monthKey: string): Promise<WhatsappMonthCost> {
  const snap = await adminClinicDoc(clinicId, "whatsapp_cost", monthKey).get().catch(() => null);
  const data = snap?.data() || {};
  const sentByCategory: Record<MessageCategory, number> = { ...EMPTY_CATEGORY_COUNTS };
  for (const [k, v] of Object.entries((data.sentByCategory || {}) as Record<string, unknown>)) {
    if (k in sentByCategory) sentByCategory[k as MessageCategory] = Number(v) || 0;
  }

  const meta = await fetchMetaBilledForMonth(clinicId, monthKey);
  return {
    monthKey,
    sentByCategory,
    // Recomputed from the counts rather than read back, so a rate correction applies to history
    // instead of only to messages sent after the change.
    estimatedUsd: estimateMonthUsd(sentByCategory),
    billedUsd: meta?.billedUsd ?? null,
    billedMessages: meta?.billedMessages ?? null,
  };
}
