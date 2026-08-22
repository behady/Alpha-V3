/**
 * Discounts: what a treatment actually costs once money is taken off it, and who may take it off.
 *
 * The old behaviour was not really a discount system. Editing a charge recomputed the number and
 * rewrote the description into prose — "Crown — Before 500 → After 400 (20% off)" — so the only
 * record that a discount had happened was a sentence. Nothing could total it, group it, or say why
 * it was given, and the finance page's Discounts tile could never show anything but zero because
 * the rows carrying discounts were filtered out before it was calculated.
 *
 * Structured fields replace the prose. The two arithmetic rules below are the ones worth stating
 * out loud, because both are easy to get wrong in a way nobody notices for months:
 *
 *   1. The lab fee is never discounted. The lab charges the clinic its full price whatever the
 *      patient pays, so a discount comes out of the clinic's and the dentist's share, not the
 *      lab's invoice.
 *   2. Commission is calculated on the NET amount, after the discount. A dentist earning their
 *      percentage of a price the patient never paid would be paid out of money that never arrived.
 *
 * Pure and Firebase-free: the server recomputes every discount from these functions, and the
 * browser uses the same ones for its live preview, so the number on screen is the number stored.
 */

import type { DiscountSettings } from "@/lib/priceLists";

export type DiscountMode = "none" | "percent" | "fixed";

export function isDiscountMode(value: unknown): value is DiscountMode {
  return value === "none" || value === "percent" || value === "fixed";
}

export type PricedServiceLike = {
  price?: number | null;
  /** Per-list overrides. An absent entry falls back to `price`, so no migration is needed. */
  prices?: Record<string, number> | null;
};

function money(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

/**
 * What this service costs on this list.
 *
 * `price` IS the standard list's price — that is why adding lists needed no migration. A list with
 * no entry for a service simply charges the standard rate, which is also the sane default for a
 * clinic that has only filled in prices for the treatments it actually discounts.
 */
export function resolveListPrice(service: PricedServiceLike, priceListId?: string | null): number {
  const overrides = service.prices || null;
  if (priceListId && overrides && typeof overrides[priceListId] === "number") {
    return money(Math.max(0, overrides[priceListId]));
  }
  return money(Math.max(0, Number(service.price) || 0));
}

export type AppliedDiscount = {
  discountMode: DiscountMode;
  /** The percentage or the fixed amount, exactly as entered. */
  discountValue: number | null;
  /** What came off, in clinic currency. */
  discountAmount: number;
  /** What the patient is charged. */
  net: number;
  listPrice: number;
};

/**
 * Take a discount off a line total.
 *
 * A fixed discount larger than the line is clamped to the line rather than rejected: staff type
 * "500 off" on a 400 line meaning "make it free", and refusing that outright is more annoying than
 * useful. It can never produce a negative charge, which would read as the clinic owing the patient.
 */
export function applyDiscount(listTotal: number, mode: DiscountMode, value: number | null | undefined): AppliedDiscount {
  const list = money(Math.max(0, listTotal));

  if (mode === "percent") {
    const percent = Math.min(100, Math.max(0, Number(value) || 0));
    const discountAmount = money((list * percent) / 100);
    return {
      discountMode: "percent",
      discountValue: percent,
      discountAmount,
      net: money(Math.max(0, list - discountAmount)),
      listPrice: list,
    };
  }

  if (mode === "fixed") {
    const fixed = Math.max(0, Number(value) || 0);
    const discountAmount = money(Math.min(list, fixed));
    return {
      discountMode: "fixed",
      discountValue: money(fixed),
      discountAmount,
      net: money(Math.max(0, list - discountAmount)),
      listPrice: list,
    };
  }

  return { discountMode: "none", discountValue: null, discountAmount: 0, net: list, listPrice: list };
}

/** The percentage a discount represents, whatever mode it was entered in. Used to check the cap. */
export function effectiveDiscountPercent(listPrice: number, discountAmount: number): number {
  const list = Number(listPrice) || 0;
  if (list <= 0) return 0;
  return Math.min(100, Math.max(0, (Number(discountAmount) || 0) / list * 100));
}

export type DiscountAuthority = {
  /** null = no ceiling. */
  maxPercent: number | null;
  isAdmin: boolean;
};

/**
 * How much this person may take off without an Admin.
 *
 * Enforced server-side, which is the only place it means anything — the same lesson as the
 * finance.* permissions, which controlled whether a button rendered and nothing else.
 */
export function allowedDiscount(
  role: string | null | undefined,
  permissions: string[] | null | undefined,
  settings: DiscountSettings
): DiscountAuthority {
  const isAdmin = String(role || "") === "Admin";
  if (isAdmin) return { maxPercent: null, isAdmin: true };
  void permissions; // reserved: a future "discount.override" grant would widen the ceiling here
  return { maxPercent: settings.maxDiscountPercentNonAdmin, isAdmin: false };
}

export type DiscountCheck = { ok: true } | { ok: false; error: string };

/**
 * May this discount be applied, by this person, with this reason?
 *
 * A reason is required for any discount at all. Without one the month-end question — "we gave away
 * 8,000, on what?" — has no answer, and that question is the entire reason the owner asked for
 * this feature rather than just a cheaper price.
 */
export function checkDiscountAllowed(args: {
  listPrice: number;
  discountAmount: number;
  reason: string | null | undefined;
  authority: DiscountAuthority;
  availableReasons: string[];
}): DiscountCheck {
  const amount = Number(args.discountAmount) || 0;
  if (amount <= 0) return { ok: true };

  const reason = String(args.reason || "").trim();
  if (!reason) {
    return { ok: false, error: "Choose a reason for this discount." };
  }
  if (args.availableReasons.length > 0 && !args.availableReasons.includes(reason)) {
    return { ok: false, error: "That discount reason is not one this clinic offers." };
  }

  const percent = effectiveDiscountPercent(args.listPrice, amount);
  const max = args.authority.maxPercent;
  if (max !== null && percent > max + 0.001) {
    return {
      ok: false,
      error: `Discounts above ${max}% need a Clinic Admin. This one is ${percent.toFixed(1)}%.`,
    };
  }

  return { ok: true };
}
