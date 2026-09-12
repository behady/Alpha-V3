/**
 * What Alpha clinics think of the partner's supplies, told to each other.
 *
 * These reviews live in Alpha and are never sent to his shop. That was the decision, and it is
 * the whole point of them: he cannot delete a bad one, a clinic reads an honest opinion from
 * another clinic doing the same job, and the collected judgement belongs to the platform rather
 * than to the supplier. His own shop's star rating is shown alongside, clearly labelled and
 * separate — see StoreProduct.averageRating.
 *
 * Three rules shape everything here, and each is enforced rather than assumed:
 *
 *  1. **Only a clinic that bought the thing may review it.** The order route stamps every order
 *     with the product ids it contained; a review is refused unless one of those orders names
 *     this product. An unverified review of dental supplies is worth nothing to the dentist
 *     reading it, and worth a great deal to anyone wanting to attack a competitor's stock.
 *
 *  2. **One review per clinic per product.** The document id is derived from the pair, so a
 *     clinic that reviews the same burs twice is editing, not stacking. Without this, the average
 *     is a measure of who typed the most.
 *
 *  3. **The running average is kept, not recomputed.** A card shows the score for 24 products at
 *     a time; reading every review to add them up would make the catalogue slower with every
 *     review written, which is the wrong way round.
 *
 * Everything in this file is pure. The Firestore half lives in the routes under api/store/reviews.
 */

/** Root collection. Cross-tenant by nature: every Alpha clinic reads every other clinic's review. */
export const SUPPLY_REVIEWS_COLLECTION = "supply_reviews";

/** One document per product, holding the running total so a card never reads the reviews. */
export const SUPPLY_REVIEW_STATS_COLLECTION = "supply_review_stats";

export interface SupplyReview {
  id: string;
  productId: number;
  /** Snapshotted, so a review still reads sensibly after he delists the product. */
  productName: string;
  rating: number;
  text: string;
  clinicId: string;
  clinicName: string;
  authorUid: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  /** Hidden by a superadmin. Kept rather than deleted so the decision is reversible and visible. */
  hidden?: boolean;
  hiddenReason?: string;
}

export interface SupplyReviewStats {
  productId: number;
  count: number;
  /** Kept alongside the count so an edited or removed review can be applied without a re-read. */
  sum: number;
  average: number;
  updatedAt: string;
}

const EMPTY_STATS = (productId: number): SupplyReviewStats => ({
  productId,
  count: 0,
  sum: 0,
  average: 0,
  updatedAt: "",
});

/**
 * The document id for one clinic's review of one product.
 *
 * Derived rather than random, which is what makes "one per clinic per product" true by
 * construction instead of by a query that could race two browser tabs into two reviews.
 */
export function reviewDocId(productId: number, clinicId: string): string {
  return `${Math.floor(Number(productId) || 0)}__${(clinicId || "").trim()}`;
}

export interface ReviewDraft {
  rating: number;
  text: string;
}

/**
 * Is this something we are willing to publish to every other clinic on the platform?
 *
 * The text limit is generous but real: this renders inside another clinic's page, and an
 * unbounded string is a way to push the rest of the screen off it.
 */
export function validateReview(draft: ReviewDraft): { ok: true } | { ok: false; error: string } {
  const rating = Number(draft?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Choose a rating from 1 to 5 stars." };
  }
  const text = typeof draft?.text === "string" ? draft.text.trim() : "";
  if (text.length > 1500) {
    return { ok: false, error: "That review is too long. Keep it under 1500 characters." };
  }
  return { ok: true };
}

/** Text as it will be stored: trimmed, length-capped, and with runaway blank lines collapsed. */
export function cleanReviewText(raw: string): string {
  return (raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);
}

/**
 * The stats after a review is added, changed or removed.
 *
 * `previousRating` is null when this clinic had not reviewed the product before; pass
 * `nextRating: null` to remove a review. Both directions are here rather than in the route
 * because an average that drifts is the kind of bug nobody notices until the numbers are
 * embarrassing, and this is the piece a test can hold still.
 */
export function applyRatingToStats(
  current: SupplyReviewStats | null,
  productId: number,
  previousRating: number | null,
  nextRating: number | null
): SupplyReviewStats {
  const base = current && current.count > 0 ? current : EMPTY_STATS(productId);

  let count = base.count;
  let sum = base.sum;

  if (previousRating !== null) {
    count -= 1;
    sum -= previousRating;
  }
  if (nextRating !== null) {
    count += 1;
    sum += nextRating;
  }

  // Floating-point sums of integers stay exact, but a stats document that has drifted — a hidden
  // review reversed twice, a manual edit — must never report a negative count or an average
  // outside the scale a star row can draw.
  count = Math.max(0, count);
  sum = Math.max(0, sum);
  const average = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;

  return {
    productId: Math.floor(Number(productId) || 0),
    count,
    sum,
    average: Math.min(5, average),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Newest first, but the caller's own review always at the top.
 *
 * Someone who has just written one looks for it immediately, and finding it buried on the third
 * page of a popular product reads as the save having failed.
 */
export function sortReviews(reviews: SupplyReview[], ownClinicId: string): SupplyReview[] {
  return [...reviews].sort((a, b) => {
    if (a.clinicId === ownClinicId && b.clinicId !== ownClinicId) return -1;
    if (b.clinicId === ownClinicId && a.clinicId !== ownClinicId) return 1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

/**
 * Did this clinic actually buy the product?
 *
 * Reads the `productIds` array the order route stamps on every supply order. A cancelled order
 * still counts: the clinic dealt with the supplier over that item and has something to say about
 * it — often the very thing another clinic most needs to hear.
 */
export function hasPurchased(orderProductIdLists: number[][], productId: number): boolean {
  const target = Math.floor(Number(productId) || 0);
  if (!target) return false;
  return orderProductIdLists.some((ids) => Array.isArray(ids) && ids.includes(target));
}

/** The rating to show on a catalogue card: ours when clinics have spoken, his otherwise. */
export function displayRating(
  alpha: { average: number; count: number },
  shop: { average: number; count: number }
): { average: number; count: number; source: "alpha" | "shop" | "none" } {
  if (alpha.count > 0) return { average: alpha.average, count: alpha.count, source: "alpha" };
  if (shop.count > 0) return { average: shop.average, count: shop.count, source: "shop" };
  return { average: 0, count: 0, source: "none" };
}
