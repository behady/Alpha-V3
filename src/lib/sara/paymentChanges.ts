import { ledgerCashValue } from "@/lib/reportHelpers";
import type { PdfSection } from "./reportDigest";

/**
 * "Was any payment deleted or changed?", from the ledger's own audit trail.
 *
 * `ledger_audit` holds the document before and after every money change, written only by the
 * server. This turns those entries into lines a person can read: who, when, which patient, and
 * what the amount was and became. Creations are left out (a new payment is not a change), and so
 * are treatment rows (the question is about money taken, not about plans).
 */

type Entry = Record<string, unknown>;
type RowLike = Record<string, unknown> | null | undefined;

export type PaymentChange = {
  date: string;
  action: "deleted" | "changed";
  by: string;
  patient: string;
  kind: string;
  before: number;
  after: number | null;
  /** What moved, in words: "amount 1,500 → 1,000", "method Cash → Card". */
  what: string[];
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const MONEY_TYPES = new Set(["payment", "income", "expense"]);

function label(row: RowLike): string {
  return text(row?.patientName) || text(row?.description) || text(row?.category) || "No name";
}

export function paymentChanges(entries: readonly Entry[]): PaymentChange[] {
  const out: PaymentChange[] = [];
  for (const e of entries) {
    if (text(e.collection) !== "ledger") continue;
    const action = text(e.action);
    if (action !== "update" && action !== "delete") continue;
    const before = (e.before || null) as RowLike;
    const after = (e.after || null) as RowLike;
    const type = text(before?.type) || text(after?.type);
    if (!MONEY_TYPES.has(type)) continue;

    const was = before ? ledgerCashValue(before) : 0;
    const base = { date: text(e.date), by: text(e.byName) || "Unknown", patient: label(before || after), kind: type };

    if (action === "delete") {
      out.push({ ...base, action: "deleted", before: was, after: null, what: [`${money(was)} removed`] });
      continue;
    }

    // An update's `after` may be the changed fields only, so read it over the old row.
    const merged = { ...(before || {}), ...(after || {}) };
    const now = ledgerCashValue(merged);
    const what: string[] = [];
    if (Math.abs(now - was) > 0.005) what.push(`amount ${money(was)} → ${money(now)}`);
    for (const [field, name] of [["method", "method"], ["date", "date"], ["patientName", "patient"], ["category", "category"]] as const) {
      const a = text(before?.[field]);
      const b = text(merged[field]);
      if (a !== b && (a || b)) what.push(`${name} ${a || "—"} → ${b || "—"}`);
    }
    if (what.length === 0) continue; // a commission recalculation, a note: not a change to the money taken
    out.push({ ...base, action: "changed", before: was, after: now, what });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.before - a.before);
}

export function paymentChangesDigest(changes: readonly PaymentChange[], maxLines = 12) {
  const deleted = changes.filter((c) => c.action === "deleted");
  return {
    currency: "EGP",
    deleted: { count: deleted.length, total: Math.round(deleted.reduce((s, c) => s + c.before, 0)) },
    changed: { count: changes.length - deleted.length },
    lines: changes.slice(0, maxLines).map((c) => ({ date: c.date, action: c.action, by: c.by, patient: c.patient, kind: c.kind, what: c.what.join("; ") })),
    shown: Math.min(maxLines, changes.length),
    moreInPdf: changes.length > maxLines,
    notes: ["From the ledger's audit trail. New payments are not listed, only payments that were deleted or edited afterwards."],
  };
}

export function paymentChangesPdfSections(changes: readonly PaymentChange[], isAr: boolean, maxRows = 400): PdfSection[] {
  const t = (en: string, ar: string) => (isAr ? ar : en);
  if (changes.length === 0) return [{ note: t("No payment was deleted or changed in this period.", "مفيش مدفوعات اتمسحت أو اتعدلت في الفترة دي.") }];
  return [
    {
      heading: t("Payments deleted or changed", "مدفوعات اتمسحت أو اتعدلت"),
      columns: [t("Date", "التاريخ"), t("What", "الإجراء"), t("By", "بواسطة"), t("Patient / item", "المريض / البند"), t("Detail", "التفاصيل")],
      rows: changes.slice(0, maxRows).map((c) => [c.date, c.action === "deleted" ? t("Deleted", "حذف") : t("Changed", "تعديل"), c.by, c.patient, c.what.join("; ")]),
    },
  ];
}
