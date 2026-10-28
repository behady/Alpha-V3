import { EXPENSE_CATEGORY_LIST } from "@/lib/expenseCategories";

/**
 * AI reading of an expense receipt — the pure half (prompt, schema, cleanup), so tests can import
 * it without the Gemini SDK or Firebase.
 *
 * The reading never writes money. The route returns it; the desk edits it on a review sheet and
 * saves through the ledger route's `create-receipt-entries` action, which builds each row with the
 * same `buildManualEntryRow` a hand-typed expense uses.
 *
 * One receipt can become several expense rows: items are grouped into one line per expense
 * category (the owner's decision, 2026-10-28), so a supplier invoice with composite and
 * disinfectant on it lands as Supplies + Cleaning, both pointing at the same photo.
 */

export const RECEIPT_SCAN_FEATURE = "receipt_scan";
/** One image-bearing Flash call with a short structured answer. Charged only on a usable reading. */
export const RECEIPT_SCAN_CREDITS = 1;
/** More lines than this is a reading gone wrong, not a receipt. */
export const RECEIPT_MAX_LINES = 12;
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
export const RECEIPT_ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/**
 * Categories the reader may choose. Salary is left out: a payslip is a staff settlement, which the
 * Team page owns. "Other" is the catch-all, never "General" — a reading should say what it is.
 */
export const RECEIPT_CATEGORY_IDS: string[] = EXPENSE_CATEGORY_LIST.map((c) => c.id).filter((id) => id !== "Salary" && id !== "General");

export interface ReceiptLine {
  /** An id from RECEIPT_CATEGORY_IDS. */
  category: string;
  /** Short, in the receipt's language: what was bought, with the supplier. */
  description: string;
  amount: number;
}

export interface ReceiptScan {
  /** False when the picture is not a receipt or bill at all; lines are then empty. */
  isReceipt: boolean;
  supplier: string;
  /** YYYY-MM-DD, or "" when the receipt shows none the reader could trust. */
  date: string;
  /** The grand total as printed (after tax and discount), or the sum of the lines when none is printed. */
  total: number;
  lines: ReceiptLine[];
  /** Anything the desk should check: unreadable figures, a currency other than EGP, a handwritten total. */
  warnings: string[];
}

const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function validDate(v: unknown): string {
  const s = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? "" : s;
}

/**
 * The model's answer, made safe to show: unknown categories become "Other", empty or zero lines go,
 * two lines under one category merge (the split is by category, so there is one row per category),
 * money is rounded to piastres. Null when nothing usable came back.
 */
export function normalizeReceiptScan(raw: unknown): ReceiptScan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const isReceipt = r.isReceipt !== false;
  const warnings = Array.isArray(r.warnings) ? r.warnings.map((w) => text(w, 200)).filter(Boolean).slice(0, 5) : [];

  const merged = new Map<string, ReceiptLine>();
  for (const item of Array.isArray(r.lines) ? r.lines : []) {
    if (!item || typeof item !== "object") continue;
    const l = item as Record<string, unknown>;
    const amount = money(l.amount);
    if (!amount) continue;
    const rawCategory = text(l.category, 60);
    const category = RECEIPT_CATEGORY_IDS.includes(rawCategory) ? rawCategory : "Other";
    const description = text(l.description, 160);
    const prev = merged.get(category);
    if (prev) {
      prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      if (description && !prev.description.includes(description)) prev.description = `${prev.description}، ${description}`.slice(0, 200);
    } else {
      merged.set(category, { category, description, amount });
    }
  }
  const lines = isReceipt ? [...merged.values()].slice(0, RECEIPT_MAX_LINES) : [];
  const sum = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const total = money(r.total) || sum;

  if (isReceipt && lines.length === 0) return null;
  return { isReceipt, supplier: text(r.supplier, 80), date: validDate(r.date), total, lines, warnings };
}

/** Whether the lines add up to the printed total, to the piastre-and-a-bit a rounding split leaves. */
export function linesMatchTotal(lines: Array<{ amount: number }>, total: number): boolean {
  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return Math.abs(sum - total) <= Math.max(1, lines.length * 0.01);
}

export const RECEIPT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isReceipt: { type: "BOOLEAN" },
    supplier: { type: "STRING" },
    date: { type: "STRING" },
    total: { type: "NUMBER" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING", enum: RECEIPT_CATEGORY_IDS, format: "enum" },
          description: { type: "STRING" },
          amount: { type: "NUMBER" },
        },
        required: ["category", "description", "amount"],
      },
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["isReceipt", "supplier", "date", "total", "lines", "warnings"],
};

/** `today` (YYYY-MM-DD, the clinic's day) stops the model calling this year's receipts "future-dated". */
export function buildReceiptPrompt(language: "ar" | "en", today: string): string {
  const categories = EXPENSE_CATEGORY_LIST.filter((c) => RECEIPT_CATEGORY_IDS.includes(c.id))
    .map((c) => `- ${c.id}: ${c.en} (${c.ar})`)
    .join("\n");
  return [
    "You read one expense receipt, invoice or bill for an Egyptian dental clinic. It may be printed or handwritten, in Arabic or English, photographed at an angle, or a PDF.",
    "",
    "Return:",
    "- isReceipt: false if this is not a receipt, invoice or bill at all (then lines is empty).",
    "- supplier: the shop, company or utility name as printed. Empty if none.",
    `Today is ${today}. Receipts dated up to today are normal; warn about a date only if it is after today or more than a year old.`,
    "- date: the receipt's date as YYYY-MM-DD. Egyptian receipts write day/month/year. Empty if there is no date or you are not sure of it.",
    "- total: the grand total actually paid, after tax, delivery and discount.",
    "- lines: the money grouped by expense category — ONE line per category, never one line per item. Each line's description names what was bought in a few words, in the receipt's own language.",
    "- warnings: short notes for the person checking (a blurred figure, a currency other than EGP, a total that does not match the items). Empty when nothing needs checking.",
    "",
    "Categories (use the id on the left):",
    categories,
    "",
    "How to file things:",
    "- Dental materials and consumables (composite, cement, anaesthetic, burs, files, impression material, gloves, masks, cotton rolls, suction tips, syringes, needles, bibs) → Supplies.",
    "- Cleaning, disinfection and sterilisation (detergent, disinfectant, autoclave pouches, indicator strips, tissues, garbage bags, a cleaning company) → Cleaning.",
    "- Electricity, water and gas bills → Utilities. Internet, landline and mobile bills → Internet & phone.",
    "- A dental laboratory invoice → Lab. A device or instrument meant to last (a handpiece, a light-cure unit, a chair) → Equipment. A repair or service visit → Maintenance.",
    "- Use Other only when nothing above fits.",
    "",
    "Money:",
    "- Amounts are numbers only, in the receipt's currency, without thousands separators.",
    "- Spread tax, delivery and any discount across the lines in proportion, so the lines add up to the total.",
    "- Never invent a figure. If an amount cannot be read, leave that item out and say so in warnings.",
    "",
    `Write warnings in ${language === "ar" ? "Egyptian Arabic" : "English"}.`,
  ].join("\n");
}

/**
 * Where a receipt's file lives, and whether a path a caller sent is one of THIS clinic's: the
 * server reads and links only files in `clinics/{clinicId}/expense_receipts/{receiptId}/`, so a
 * caller cannot have another clinic's file read or attached by naming it.
 */
export function receiptFolder(clinicId: string, receiptId: string): string {
  return `clinics/${clinicId}/expense_receipts/${receiptId}/`;
}

export function isOwnReceiptPath(path: string, clinicId: string, receiptId: string): boolean {
  if (!clinicId || !receiptId || /[/\\]/.test(clinicId) || /[/\\]/.test(receiptId)) return false;
  const prefix = receiptFolder(clinicId, receiptId);
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return name.length > 0 && name.length <= 120 && !/[/\\]/.test(name) && name !== "." && name !== "..";
}

/**
 * A Storage download link for exactly that path. The link is what the Finance row opens; it must
 * point at our bucket's copy of the file the server read, not at any URL a caller liked.
 */
export function isDownloadUrlFor(url: string, path: string): boolean {
  if (!/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\//.test(url)) return false;
  const encoded = url.split("/o/")[1]?.split("?")[0] ?? "";
  try {
    return decodeURIComponent(encoded) === path;
  } catch {
    return false;
  }
}

/** A short random id for the receipt's folder and for `receiptGroupId` on its rows. */
export function newReceiptId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
