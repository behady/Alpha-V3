/**
 * The dental labs a clinic sends work to.
 *
 * Stored as one settings document (`settings/labs`) holding a list, the same shape branches and
 * price lists already use. A settings singleton rather than a subcollection on purpose: this is
 * configuration, not clinic activity, and `match /settings/{docId}` in firestore.rules is
 * Admin-only to write — which is the right answer here. An assistant should be able to send a case
 * to a lab; deciding which labs the clinic deals with is not theirs.
 *
 * The name `labs` was already claimed as a v2 leftover collection name in the migration router, so
 * the LAB CASES live in `lab_cases` rather than `lab_orders` and the directory lives here, under
 * settings, where it cannot collide with anything a migrated clinic brought with it.
 *
 * Cases store `labId` AND `labName`, the same denormalisation appointments use for branches: the
 * id stays the grouping key so a renamed lab keeps its history, and the name is what prints.
 */

import { DEFAULT_LAB_PAPER, LAB_WORK_TYPES, isLabOrderPaper, type LabOrderPaper } from "@/lib/labCases";

export type DentalLab = {
  id: string;
  name: string;
  phone?: string;
  /** Where the order gets sent when an order is raised. Falls back to `phone` when blank. */
  whatsapp?: string;
  address?: string;
  /** The person who actually collects, so the signature strip has a name to check against. */
  driverName?: string;
  /**
   * The lab's usual turnaround.
   *
   * This is what makes the amber and red warnings mean anything. With it, picking the lab fills
   * the due date in and the board can say "late" with a straight face; without it somebody types
   * a date every time and, in practice, eventually stops.
   */
  turnaroundDays?: number;
  /**
   * What this lab charges, per kind of work: `{ zirconia: 600, emax: 750 }`.
   *
   * Sparse on purpose — a lab is only priced for the work it actually makes, and an absent entry
   * means "we have never agreed a price for that with them", which is a different and more honest
   * statement than zero.
   *
   * Per LAB rather than per clinic, because that is the whole point: the clinic's own
   * `estimatedLabFee` in Settings → Prices is one number for every lab, so it cannot know that one
   * lab charges 600 for a crown and another 750. This can.
   */
  prices?: Record<string, number>;
  notes?: string;
};

export const LABS_SETTINGS_DOC = "labs";

/**
 * The paper the clinic prints lab orders on, read from the same settings document.
 *
 * Kept beside the labs rather than in `settings/clinic_info` because it is only ever changed on
 * the Dental Labs screen, and a setting that lives where it is edited is one nobody has to hunt
 * for. An unrecognised or missing value falls back to the default rather than throwing — an old
 * document must not stop an order printing.
 */
export function parseLabPaper(data: unknown): LabOrderPaper {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>).paper : null;
  return isLabOrderPaper(raw) ? raw : DEFAULT_LAB_PAPER;
}

function sanitizeLab(raw: unknown): DentalLab | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const id = String(l.id || "").trim();
  const name = String(l.name || "").trim();
  if (!id || !name) return null;

  const turnaround = Number(l.turnaroundDays);
  return {
    id,
    name,
    phone: String(l.phone || "").trim(),
    whatsapp: String(l.whatsapp || "").trim(),
    address: String(l.address || "").trim(),
    driverName: String(l.driverName || "").trim(),
    // Zero would read as "same day" and is never what an empty field means, so it falls through
    // to absent along with NaN and negatives.
    //
    // OMITTED, not set to undefined. This list is round-tripped straight back into `setDoc` by the
    // settings screen, and the browser SDK rejects a write containing an explicit `undefined`
    // outright — so a single lab with no turnaround would have made the whole Dental Labs screen
    // permanently unsavable, with an error that reads like a permissions problem.
    ...(Number.isFinite(turnaround) && turnaround > 0 ? { turnaroundDays: Math.round(turnaround) } : {}),
    ...sanitizePrices(l.prices),
    notes: String(l.notes || "").trim(),
  };
}

/**
 * The price table, keyed by work type id and validated against the catalogue.
 *
 * Unknown keys are dropped rather than carried: a work type that no longer exists would otherwise
 * sit in the document forever, invisible in the settings screen and impossible to remove. Zero and
 * negative prices are dropped too — an empty box means "not priced with this lab", and storing it
 * as 0 would fill an order in as free.
 *
 * Returns `{}` rather than `{ prices: {} }` when nothing survives, so the key is omitted entirely
 * and an unpriced lab carries no empty object around.
 */
function sanitizePrices(raw: unknown): { prices?: Record<string, number> } {
  if (!raw || typeof raw !== "object") return {};
  const known = new Set(LAB_WORK_TYPES.map((w) => w.id as string));
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(key)) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) out[key] = Math.round(n * 100) / 100;
  }
  return Object.keys(out).length ? { prices: out } : {};
}

/** What this lab charges for this kind of work, or null when nothing has been agreed. */
export function labPriceFor(
  lab: DentalLab | null | undefined,
  workType: string | null | undefined
): number | null {
  if (!lab?.prices || !workType) return null;
  const n = Number(lab.prices[workType]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** How many kinds of work this lab has a price for — for the collapsed summary line. */
/**
 * One work type's price, set or cleared.
 *
 * Clearing DELETES the key. Writing zero instead is what the settings screen used to do, and
 * because a price box reads `prices[id] ?? ""`, zero is a number rather than an absence — so the
 * box refilled itself with "0" the instant it was emptied and a price agreed by mistake could not
 * be taken back off the list. The stored document was never wrong, because serializeDentalLabs
 * drops non-positive prices on the way out; that is exactly why it survived, looking like a
 * display quirk while behaving like a locked field.
 */
export function setLabPrice(
  prices: Record<string, number> | undefined,
  workId: string,
  raw: string
): Record<string, number> {
  const next = { ...(prices || {}) };
  if (raw.trim() === "") delete next[workId];
  else next[workId] = Number(raw);
  return next;
}

export function labPricedCount(lab: DentalLab | null | undefined): number {
  if (!lab?.prices) return 0;
  return Object.values(lab.prices).filter((v) => Number(v) > 0).length;
}

/**
 * A lab list safe to hand to `setDoc`.
 *
 * The settings screen edits labs in local state, where clearing the turnaround box legitimately
 * produces `undefined` — so sanitising on read is not enough on its own. Everything that reaches
 * Firestore goes through here.
 */
export function serializeDentalLabs(labs: DentalLab[]): Record<string, unknown>[] {
  return labs.map((lab) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(lab)) {
      if (value === undefined || value === null) continue;
      if (key === "prices") {
        // The price table needs cleaning one level deeper: clearing a price box leaves the key
        // present with an empty or undefined value, and a nested undefined rejects the write just
        // as surely as a top-level one. An emptied price is a REMOVED price, not a zero.
        const priced: Record<string, number> = {};
        for (const [work, amount] of Object.entries(value as Record<string, unknown>)) {
          const n = Number(amount);
          if (Number.isFinite(n) && n > 0) priced[work] = n;
        }
        if (Object.keys(priced).length) out.prices = priced;
        continue;
      }
      out[key] = value;
    }
    return out;
  });
}

/** Accepts the raw `settings/labs` data (or null) and returns a clean list. */
export function parseDentalLabs(data: unknown): DentalLab[] {
  if (!data || typeof data !== "object") return [];
  const labs = (data as Record<string, unknown>).labs;
  if (!Array.isArray(labs)) return [];
  return labs.map(sanitizeLab).filter(Boolean) as DentalLab[];
}

export function makeLabId(): string {
  return `lab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function findLab(labs: DentalLab[], id: string | null | undefined): DentalLab | null {
  if (!id) return null;
  return labs.find((l) => l.id === id) || null;
}

/**
 * The number the order goes to.
 *
 * A lab that gave one number for calls and never a separate WhatsApp is the common case, so the
 * plain phone is the fallback rather than an error.
 */
export function labMessagingNumber(lab: DentalLab | null | undefined): string {
  if (!lab) return "";
  return (lab.whatsapp || lab.phone || "").trim();
}
