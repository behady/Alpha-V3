/**
 * Who is paying for this treatment — the patient, or an insurer — and what that changes.
 *
 * A clinic doing insurance work has three questions its books could not answer before this:
 * how many cases came from each insurer, what each insurer's work is actually worth, and what
 * each dentist earned on it — because the same dentist is usually paid a different percentage on
 * an insurance case than on a private one, and the insurer's tariff is not the clinic's price.
 *
 * The payer is the thing that answers all three, and it is deliberately NOT the field that looks
 * like it should. `patients.source` already exists and is a *marketing* source — "how did you hear
 * about us", asked once, when the patient is created, and never revisited. Reusing it would have
 * been wrong in both directions: a patient found through Instagram can still be on an insurance
 * plan, and a patient's plan can change between one visit and the next, or differ between two
 * treatments on the same day. So a payer is recorded **per procedure**, because the procedure is
 * what carries the price, the dentist and the lab fee — the three things the answer depends on.
 *
 * Two things hang off a payer:
 *
 *  - **A price list.** Insurers pay their own tariff, and the price-list model already supported
 *    several named lists per clinic (see `priceLists.ts`, whose own comment anticipates exactly
 *    this use). A payer points at one; choosing the payer chooses the prices.
 *  - **A commission rate per dentist.** The rate lives on the staff record as a small map keyed by
 *    payer id, falling back to the dentist's ordinary percentage. So "Dr Omar takes 40% private
 *    and 25% on MetLife" is two numbers, not two systems.
 *
 * Everything resolved here is snapshotted onto the procedure and onto every payment against it,
 * exactly as the commission percentage already is. Changing a rate, retiring an insurer or
 * repointing a price list must never rewrite what last month's payroll said — a report that
 * changes when you change a setting is a report nobody can sign.
 *
 * Pure: no database, no imports from the app. The settings document is `settings/payers`.
 */

/** The id of the payer every clinic starts with, and the one nothing can delete. */
export const PRIVATE_PAYER_ID = "private";

export type Payer = {
  id: string;
  name: string;
  nameAr?: string;
  /**
   * The price list this payer's work is charged from. Absent = the clinic's normal default,
   * which is what "Private" means and what a new insurer means until somebody prices it.
   */
  priceListId?: string;
  /** Retired payers stop being offered on new treatments and stay readable on old ones. */
  active: boolean;
  /** Preselected on a new treatment when the patient has no payer of their own. */
  isDefault: boolean;
};

/**
 * Every clinic has this one, whether or not it does insurance work at all.
 *
 * It is what makes the feature free to ignore: a clinic that never opens this screen has one
 * payer, every case is on it, and every report reads exactly as it did before — one column.
 */
export const PRIVATE_PAYER: Payer = {
  id: PRIVATE_PAYER_ID,
  name: "Private",
  nameAr: "خاص",
  active: true,
  isDefault: true,
};

function cleanId(raw: unknown): string {
  // Ids end up as Firestore map keys on the staff record, so a dot or a slash in one would create
  // a nested path instead of a key. Kept to the characters that cannot mean anything else.
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** A stable id for a payer somebody has just named, unique against the ones already there. */
export function payerIdFrom(name: string, existing: readonly Payer[]): string {
  const base = cleanId(name) || "payer";
  if (!existing.some((p) => p.id === base)) return base;
  for (let n = 2; n < 200; n++) {
    const candidate = `${base}-${n}`;
    if (!existing.some((p) => p.id === candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * The clinic's payers, from the stored document, always with Private present and exactly one
 * default among the active ones.
 *
 * Re-derived rather than trusted for the same reason `priceLists` re-derives its defaults: this is
 * hand-editable text, and "which payer is preselected?" having two answers, or none, is a question
 * the treatment screen cannot render.
 */
export function parsePayers(raw: unknown): Payer[] {
  const list = (raw && typeof raw === "object" ? (raw as { payers?: unknown }).payers : null) ?? null;
  const rows: Payer[] = [];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const p = item as Partial<Payer>;
      const id = cleanId(p.id);
      if (!id || rows.some((r) => r.id === id)) continue;
      const name = String(p.name ?? "").trim();
      if (!name) continue;
      rows.push({
        id,
        name,
        ...(typeof p.nameAr === "string" && p.nameAr.trim() ? { nameAr: p.nameAr.trim() } : {}),
        ...(typeof p.priceListId === "string" && p.priceListId.trim()
          ? { priceListId: p.priceListId.trim() }
          : {}),
        active: p.active !== false,
        isDefault: p.isDefault === true,
      });
    }
  }

  // Private is never absent and never inactive. A clinic that deleted it would have nowhere to
  // put a walk-in, and every historical private case would resolve to a payer that is gone.
  const privateRow = rows.find((r) => r.id === PRIVATE_PAYER_ID);
  if (!privateRow) rows.unshift({ ...PRIVATE_PAYER, isDefault: !rows.some((r) => r.isDefault && r.active) });
  else privateRow.active = true;

  // Exactly one default among the active rows: the first one that claims it, else Private.
  let claimed = false;
  for (const row of rows) {
    if (row.isDefault && row.active && !claimed) claimed = true;
    else row.isDefault = false;
  }
  if (!claimed) {
    const fallback = rows.find((r) => r.id === PRIVATE_PAYER_ID) || rows.find((r) => r.active);
    if (fallback) fallback.isDefault = true;
  }
  return rows;
}

/** What gets written back. Sorted so Private leads and the rest keep the author's order. */
export function payersDocFrom(payers: readonly Payer[]): { payers: Payer[] } {
  const parsed = parsePayers({ payers });
  return {
    payers: [
      ...parsed.filter((p) => p.id === PRIVATE_PAYER_ID),
      ...parsed.filter((p) => p.id !== PRIVATE_PAYER_ID),
    ],
  };
}

export function findPayer(payers: readonly Payer[], id: string | null | undefined): Payer | null {
  if (!id) return null;
  return payers.find((p) => p.id === id) || null;
}

export function defaultPayer(payers: readonly Payer[]): Payer {
  return payers.find((p) => p.isDefault && p.active) || payers.find((p) => p.active) || PRIVATE_PAYER;
}

/**
 * Who is paying, worked out from the price list the treatment was charged on.
 *
 * This is the whole interface. There is no separate "paid by" question anywhere in the app,
 * because there never needed to be one: an insurer IS its price list. Charge a treatment on the
 * AXA list and it is AXA's case — the patient appears in AXA's patient list, the dentist earns
 * his AXA percentage, and the revenue lands in AXA's column. Charge the next treatment in the
 * same visit on the clinic's own list and that one is private. One control, one decision, and a
 * mixed visit falls out of it for free.
 *
 * Everything else was scaffolding around this idea and has been removed: a payer picker on the
 * treatment screen that argued with the price list, and a "usually pays by" field on the patient
 * that tried to predict an answer the list already gives.
 *
 * A list no insurer owns — the clinic's Standard list, or any list a clinic made for its own
 * reasons — is private work, which is the correct default and needs no configuration.
 */
export function payerForPriceList(
  payers: readonly Payer[],
  priceListId: string | null | undefined,
): Payer {
  if (priceListId) {
    const owner = payers.find((p) => p.priceListId === priceListId && p.active);
    if (owner) return owner;
  }
  return payers.find((p) => p.id === PRIVATE_PAYER_ID) || PRIVATE_PAYER;
}

/* --- what a dentist earns, per payer ---------------------------------------------------------- */

/**
 * A dentist's commission rates, as stored on their staff record.
 *
 * `commissionPercentage` is what they earn on anything not named here, and is the field that
 * already existed — so a clinic that never touches insurance keeps exactly the behaviour it had.
 * `commissionByPayer` is the exceptions list, keyed by payer id.
 */
export type CommissionRates = {
  commissionPercentage?: number | null;
  commissionByPayer?: Record<string, unknown> | null;
};

function asPercent(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // A rate outside 0–100 is a typo, and honouring it would pay a dentist more than the treatment
  // earned. Clamped rather than rejected: refusing the save would lose the rest of the row.
  return Math.min(Math.max(n, 0), 100);
}

/**
 * What this dentist earns on this payer's work.
 *
 * The order is the whole feature: the rate set for this payer, then the dentist's ordinary rate,
 * then nothing. An absent entry means "no exception", NOT "zero" — a clinic that has named three
 * insurers and set rates for two must not silently stop paying on the third.
 */
export function commissionRateFor(
  staff: CommissionRates | null | undefined,
  payerId: string | null | undefined,
): number {
  const perPayer = staff?.commissionByPayer;
  if (payerId && perPayer && typeof perPayer === "object") {
    const exact = asPercent((perPayer as Record<string, unknown>)[payerId]);
    if (exact !== null) return exact;
  }
  return asPercent(staff?.commissionPercentage) ?? 0;
}

/** True when this dentist has a rate specifically for this payer, rather than inheriting one. */
export function hasOwnRate(
  staff: CommissionRates | null | undefined,
  payerId: string | null | undefined,
): boolean {
  const perPayer = staff?.commissionByPayer;
  if (!payerId || !perPayer || typeof perPayer !== "object") return false;
  return asPercent((perPayer as Record<string, unknown>)[payerId]) !== null;
}

/**
 * The map to save after somebody types a rate into the grid, or clears one.
 *
 * Clearing writes the key away entirely rather than storing 0, because those are different
 * answers: no key means "pay them their usual rate here", and 0 means "this insurer's work earns
 * them nothing". The grid can express both, so the store has to as well.
 */
export function withCommissionRate(
  current: Record<string, unknown> | null | undefined,
  payerId: string,
  rate: number | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (current && typeof current === "object") {
    for (const [key, value] of Object.entries(current)) {
      const pct = asPercent(value);
      if (pct !== null) out[key] = pct;
    }
  }
  if (rate === null) delete out[payerId];
  else {
    const pct = asPercent(rate);
    if (pct !== null) out[payerId] = pct;
  }
  return out;
}

/* --- reading the books back ------------------------------------------------------------------- */

/** The fields every procedure and every payment carries, so a report never has to join. */
export type PayerStamp = {
  payerId: string;
  payerName: string;
};

/**
 * The stamp to write onto a row.
 *
 * The NAME is stored beside the id on purpose. An insurer that is renamed, or removed from the
 * list a year later, must still read correctly on the treatment that was done under it — the id
 * alone would resolve to nothing and the row would go blank in exactly the report that is supposed
 * to prove what happened.
 */
export function payerStamp(payers: readonly Payer[], payerId: string): PayerStamp {
  const payer = findPayer(payers, payerId);
  return { payerId, payerName: payer?.name || PRIVATE_PAYER.name };
}

/**
 * How a row that predates all this is counted.
 *
 * Every procedure and payment recorded before the payer field existed has no payer, and there is
 * no way to work out what it should have been. They are counted as private rather than as
 * "unknown", because a clinic that has just switched this on had exactly one kind of work
 * yesterday — its own — and a report whose largest column is "unknown" is one nobody reads. The
 * reports say so in a line of their own rather than leaving the reader to assume.
 */
export function payerOf(row: { payerId?: unknown; payerName?: unknown }): PayerStamp {
  const id = typeof row.payerId === "string" && row.payerId.trim() ? row.payerId.trim() : PRIVATE_PAYER_ID;
  const name =
    typeof row.payerName === "string" && row.payerName.trim() ? row.payerName.trim() : PRIVATE_PAYER.name;
  return { payerId: id, payerName: name };
}

/** True for a row that was recorded before the payer field existed. */
export function isUnstamped(row: { payerId?: unknown }): boolean {
  return !(typeof row.payerId === "string" && row.payerId.trim());
}
