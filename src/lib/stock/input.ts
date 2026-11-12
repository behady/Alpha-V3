/**
 * What people type, read the way they meant it.
 *
 * A browser's own number box turns anything it cannot read into an empty string, and the page
 * used to turn that into zero. On a phone with an Arabic keyboard that made "٥" a count of
 * nothing. So the stock page reads the text itself: Arabic and Persian digits are digits, an
 * empty box is "no answer" rather than zero, and a count that was interrupted is kept on the
 * device until it is saved.
 */

const ARABIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** ٠-٩ and ۰-۹ become 0-9; everything else is left alone. */
export function toAsciiDigits(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= ARABIC_ZERO && c <= ARABIC_ZERO + 9) out += String(c - ARABIC_ZERO);
    else if (c >= PERSIAN_ZERO && c <= PERSIAN_ZERO + 9) out += String(c - PERSIAN_ZERO);
    else out += ch;
  }
  return out;
}

/**
 * The number in a typed string, or null when there is none.
 *
 * Counts are whole (a half box rounds down); pass `decimal` for money. A comma or the Arabic
 * decimal mark works as a point; a comma in front of exactly three digits is a thousands mark.
 */
export function parseCount(raw: string, opts: { min?: number; max?: number; decimal?: boolean } = {}): number | null {
  const { min = 0, max = Number.POSITIVE_INFINITY, decimal = false } = opts;
  let s = toAsciiDigits(raw).replace(/\s+/g, "");
  s = s.replace(/٬/g, "").replace(/٫/g, ".");
  s = s.replace(/,(?=\d{3}(\D|$))/g, "").replace(/,/g, ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(max, Math.max(min, n));
  return decimal ? clamped : Math.floor(clamped);
}

// --- counts typed but not saved yet --------------------------------------------------------------

export interface DraftStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  keys: () => string[];
}

export interface CountDraft {
  /** lineId → the number typed. */
  values: Record<string, number>;
  /** Which drawer of the weekly walk the person was on; 0 for a single drawer. */
  step: number;
}

const PREFIX = "alpha-stock-draft:";

/** `scope` is "walk" for the weekly count, or "drawer:<id>" for one drawer's page. */
export function draftKey(clinicId: string, scope: string): string {
  return `${PREFIX}${clinicId}:${scope}`;
}

/**
 * The unsaved count for today, if there is one. A draft from another day is thrown away: stock
 * moved since, and yesterday's half-finished numbers would be wrong today.
 */
export function readDraft(store: DraftStore, key: string, today: string, validIds?: Set<string>): CountDraft | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: unknown; values?: unknown; step?: unknown };
    if (parsed.date !== today || !parsed.values || typeof parsed.values !== "object") {
      store.removeItem(key);
      return null;
    }
    const values: Record<string, number> = {};
    for (const [id, v] of Object.entries(parsed.values as Record<string, unknown>)) {
      if (validIds && !validIds.has(id)) continue;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) values[id] = Math.floor(v);
    }
    const step = typeof parsed.step === "number" && parsed.step > 0 ? Math.floor(parsed.step) : 0;
    if (!Object.keys(values).length && !step) return null;
    return { values, step };
  } catch {
    return null;
  }
}

export function writeDraft(store: DraftStore, key: string, today: string, draft: CountDraft): void {
  try {
    if (!Object.keys(draft.values).length && !draft.step) store.removeItem(key);
    else store.setItem(key, JSON.stringify({ date: today, values: draft.values, step: draft.step }));
  } catch {
    /* storage blocked or full: the count still works, it just is not kept across a reload */
  }
}

export function clearDraft(store: DraftStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** The device's own storage. Every call is guarded: private windows and blocked storage throw. */
export function localDraftStore(): DraftStore {
  const ls = () => window.localStorage;
  return {
    getItem: (k) => ls().getItem(k),
    setItem: (k, v) => ls().setItem(k, v),
    removeItem: (k) => ls().removeItem(k),
    keys: () => Object.keys(ls()).filter((k) => k.startsWith(PREFIX)),
  };
}

// --- a delivery, before it is received -----------------------------------------------------------

/** What the person should be told before a delivery posts an expense: it cannot be taken back. */
export function deliveryWarnings(lines: Array<{ qty: number; price: number }>, supplier: string): { noPrice: number; noSupplier: boolean; total: number; units: number } {
  return {
    noPrice: lines.filter((l) => !(l.price > 0)).length,
    noSupplier: !supplier.trim(),
    total: lines.reduce((a, l) => a + l.qty * l.price, 0),
    units: lines.reduce((a, l) => a + l.qty, 0),
  };
}
