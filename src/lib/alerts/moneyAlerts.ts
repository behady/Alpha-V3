import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { notifyTiming } from "@/lib/notificationCatalog";
import { deliverClinicNotification, readAlertPreferences } from "@/lib/notificationDelivery";

/**
 * The money alerts, raised from the one door every money write goes through (`/api/finance/ledger`
 * and the clinical charge route). Fire-and-forget: a notification about a payment must never fail
 * the payment, so every caller `void`s these and every error is swallowed here.
 *
 * Thresholds are the clinic's own, read from the notification centre: discount above N percent,
 * expense above N pounds, a row dated more than N days back.
 */

type Row = Record<string, unknown>;
type Actor = { uid?: string; name?: string };

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const egp = (n: number) => `${Math.round(n).toLocaleString("en-US")} EGP`;

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T12:00:00Z`);
  const b = Date.parse(`${toYmd}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function who(actor: Actor): string {
  return actor.name ? ` — ${actor.name}` : "";
}

function describeRow(row: Row): string {
  const type = str(row.type);
  const amount = type === "expense" ? num(row.cost) || num(row.amount) : num(row.paid) || num(row.amount) || num(row.cost);
  const subject = type === "expense" ? str(row.description) || str(row.category) || "expense" : str(row.patientName) || str(row.description) || "";
  const method = str(row.method);
  return `${egp(amount)}${subject ? ` · ${subject}` : ""}${method && type !== "expense" ? ` · ${method}` : ""}`;
}

/** The percentage a charge was discounted, from whichever fields the row carries. */
export function discountPercentOf(row: Row): number {
  const list = num(row.listPrice) || num(row.cost) + num(row.discountAmount);
  const amount = num(row.discountAmount);
  if (list <= 0 || amount <= 0) return 0;
  return Math.round((amount / list) * 100);
}

async function raise(clinicId: string, event: string, title: string, body: string, screen = "money") {
  try {
    await deliverClinicNotification(clinicId, { title, body }, { event, channel: "alpha_money", data: { screen }, whatsappText: `*${title}*\n${body}` });
  } catch (error) {
    console.warn(`${event} alert failed:`, error);
  }
}

/** After a payment, income or expense row is created. */
export async function afterLedgerCreate(clinicId: string, row: Row, actor: Actor = {}): Promise<void> {
  try {
    const type = str(row.type);
    if (type !== "payment" && type !== "income" && type !== "expense") return;
    const prefs = await readAlertPreferences(clinicId);
    const today = ymdInTimeZone(clinicTimeZone());

    await raise(clinicId, "paymentAdded", type === "expense" ? "Expense recorded" : "Payment recorded", `${describeRow(row)}${who(actor)}`);

    if (type === "expense") {
      const amount = num(row.cost) || num(row.amount);
      const limit = notifyTiming("expenseAbove", "amount", prefs);
      if (amount >= limit) await raise(clinicId, "expenseAbove", `Expense above ${egp(limit)}`, `${describeRow(row)}${who(actor)}`);
    }

    const date = str(row.date).slice(0, 10);
    const back = notifyTiming("paymentBackdated", "days", prefs);
    if (date && daysBetween(date, today) > back) {
      await raise(clinicId, "paymentBackdated", "Backdated entry", `${describeRow(row)} · dated ${date}${who(actor)}`);
    }
  } catch (error) {
    console.warn("afterLedgerCreate failed:", error);
  }
}

/** After a row is edited. `after` holds only the changed fields. */
export async function afterLedgerUpdate(clinicId: string, before: Row, after: Row, actor: Actor = {}): Promise<void> {
  try {
    const type = str(before.type);
    const merged = { ...before, ...after };
    if (type === "payment" || type === "income" || type === "expense") {
      const moneyChanged = ["paid", "amount", "cost", "method", "date"].some((k) => k in after && after[k] !== before[k]);
      if (moneyChanged) await raise(clinicId, "paymentEdited", "Payment changed", `${describeRow(merged)}${who(actor)}`);
    }
    if (type === "procedure" && "discountAmount" in after) {
      const prefs = await readAlertPreferences(clinicId);
      const pct = discountPercentOf(merged);
      const limit = notifyTiming("discountAbove", "percent", prefs);
      if (pct >= limit) {
        await raise(
          clinicId,
          "discountAbove",
          `Discount of ${pct}%`,
          `${str(merged.patientName) || str(merged.description)} · ${egp(num(merged.discountAmount))} off ${egp(num(merged.listPrice))}${who(actor)}`,
        );
      }
    }
  } catch (error) {
    console.warn("afterLedgerUpdate failed:", error);
  }
}

/** After a charge row is created with a discount already on it (the clinical route). */
export async function afterChargeCreate(clinicId: string, row: Row, actor: Actor = {}): Promise<void> {
  try {
    const pct = discountPercentOf(row);
    if (pct <= 0) return;
    const prefs = await readAlertPreferences(clinicId);
    const limit = notifyTiming("discountAbove", "percent", prefs);
    if (pct >= limit) {
      await raise(
        clinicId,
        "discountAbove",
        `Discount of ${pct}%`,
        `${str(row.patientName) || str(row.description)} · ${egp(num(row.discountAmount))} off ${egp(num(row.listPrice))}${who(actor)}`,
      );
    }
  } catch (error) {
    console.warn("afterChargeCreate failed:", error);
  }
}

/** After a row is deleted. */
export async function afterLedgerDelete(clinicId: string, before: Row, actor: Actor = {}): Promise<void> {
  try {
    const type = str(before.type);
    if (type !== "payment" && type !== "income" && type !== "expense") return;
    await raise(clinicId, "paymentDeleted", type === "expense" ? "Expense deleted" : "Payment deleted", `${describeRow(before)}${who(actor)}`);
  } catch (error) {
    console.warn("afterLedgerDelete failed:", error);
  }
}
