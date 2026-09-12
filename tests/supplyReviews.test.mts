// Clinic-to-clinic reviews of the supply store. Run with tsx; no network, no emulator.
//
// The average is the thing worth pinning. It is kept as a running total rather than recomputed
// from the reviews — a catalogue page shows two dozen products, and adding up every review for
// each of them would make the shop slower with every review anybody writes. That is the right
// trade, but it means a rating applied twice, or reversed once too often, silently corrupts a
// number nobody is watching. Every path into it is exercised here: first review, edit, delete,
// hide, restore.
//
// The other half is who may speak. A review carries a clinic's name to every other clinic on the
// platform, and an unverified one is worth nothing to the dentist reading it and a great deal to
// anyone wanting to rubbish a competitor's stock. So the purchase check is pinned too.

import assert from "node:assert/strict";
import {
  applyRatingToStats,
  cleanReviewText,
  displayRating,
  hasPurchased,
  reviewDocId,
  sortReviews,
  validateReview,
  type SupplyReview,
} from "../src/lib/supplyReviews";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// --- 1. One review per clinic per product -------------------------------------------------------

check("the document id is derived from the pair, so a second review is an edit", () => {
  assert.equal(reviewDocId(41, "clinicA"), "41__clinicA");
  // Same clinic, same product, same id — which is what makes "one each" true by construction
  // rather than by a query two browser tabs could race past.
  assert.equal(reviewDocId(41, "clinicA"), reviewDocId(41.0, "clinicA"));
  assert.notEqual(reviewDocId(41, "clinicA"), reviewDocId(41, "clinicB"));
  assert.notEqual(reviewDocId(41, "clinicA"), reviewDocId(42, "clinicA"));
});

// --- 2. Validation ------------------------------------------------------------------------------

check("a rating must be a whole number of stars from 1 to 5", () => {
  for (const rating of [0, 6, -1, 3.5, Number.NaN]) {
    assert.equal(validateReview({ rating, text: "" }).ok, false, `rating ${rating} should be refused`);
  }
  for (const rating of [1, 2, 3, 4, 5]) {
    assert.equal(validateReview({ rating, text: "fine" }).ok, true);
  }
});

check("an empty review body is allowed — stars alone are a judgement", () => {
  assert.equal(validateReview({ rating: 4, text: "" }).ok, true);
});

check("an enormous review is refused rather than truncated at the door", () => {
  assert.equal(validateReview({ rating: 4, text: "x".repeat(1501) }).ok, false);
  assert.equal(validateReview({ rating: 4, text: "x".repeat(1500) }).ok, true);
});

check("stored text is trimmed and its runaway blank lines collapsed", () => {
  assert.equal(cleanReviewText("  good kit  "), "good kit");
  assert.equal(cleanReviewText("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(cleanReviewText("a\r\nb"), "a\nb");
  assert.equal(cleanReviewText("x".repeat(2000)).length, 1500);
});

// --- 3. The running average ---------------------------------------------------------------------

check("the first review sets the average to itself", () => {
  const stats = applyRatingToStats(null, 41, null, 5);
  assert.equal(stats.count, 1);
  assert.equal(stats.sum, 5);
  assert.equal(stats.average, 5);
});

check("a second review averages the two", () => {
  let stats = applyRatingToStats(null, 41, null, 5);
  stats = applyRatingToStats(stats, 41, null, 2);
  assert.equal(stats.count, 2);
  assert.equal(stats.average, 3.5);
});

check("editing a review replaces its rating, it does not add another", () => {
  let stats = applyRatingToStats(null, 41, null, 5);
  stats = applyRatingToStats(stats, 41, null, 3);
  // The same clinic changes its mind: 5 out, 1 in.
  stats = applyRatingToStats(stats, 41, 5, 1);
  assert.equal(stats.count, 2, "an edit must not grow the count");
  assert.equal(stats.sum, 4);
  assert.equal(stats.average, 2);
});

check("deleting a review takes its rating back out", () => {
  let stats = applyRatingToStats(null, 41, null, 5);
  stats = applyRatingToStats(stats, 41, null, 1);
  stats = applyRatingToStats(stats, 41, 1, null);
  assert.equal(stats.count, 1);
  assert.equal(stats.average, 5);
});

check("the last review leaving returns the product to unrated, not to zero stars", () => {
  let stats = applyRatingToStats(null, 41, null, 4);
  stats = applyRatingToStats(stats, 41, 4, null);
  assert.equal(stats.count, 0);
  assert.equal(stats.average, 0);
  // count 0 is what the star row checks; an average of 0 with a count would draw an empty row and
  // read as the worst possible score rather than as no score.
});

check("hiding a review removes it from the average, restoring puts it back", () => {
  let stats = applyRatingToStats(null, 41, null, 5);
  stats = applyRatingToStats(stats, 41, null, 1);
  assert.equal(stats.average, 3);
  // Superadmin hides the 1.
  stats = applyRatingToStats(stats, 41, 1, null);
  assert.equal(stats.count, 1);
  assert.equal(stats.average, 5);
  // ...and restores it.
  stats = applyRatingToStats(stats, 41, null, 1);
  assert.equal(stats.count, 2);
  assert.equal(stats.average, 3);
});

check("a corrupted stats document can never report a negative count or an off-scale average", () => {
  const broken = { productId: 41, count: 0, sum: 0, average: 0, updatedAt: "" };
  const stats = applyRatingToStats(broken, 41, 5, null);
  assert.ok(stats.count >= 0);
  assert.ok(stats.average >= 0 && stats.average <= 5);
});

check("averages round to two places, so a star row never renders 3.3333333", () => {
  let stats = applyRatingToStats(null, 41, null, 5);
  stats = applyRatingToStats(stats, 41, null, 4);
  stats = applyRatingToStats(stats, 41, null, 1);
  assert.equal(stats.average, 3.33);
});

// --- 4. Who may review --------------------------------------------------------------------------

check("only a clinic whose orders name the product may review it", () => {
  assert.equal(hasPurchased([[41, 77]], 41), true);
  assert.equal(hasPurchased([[77], [12, 41]], 41), true);
  assert.equal(hasPurchased([[77]], 41), false);
  assert.equal(hasPurchased([], 41), false);
  // A product id of 0 is not a product; it must never match an order that happens to hold junk.
  assert.equal(hasPurchased([[0]], 0), false);
});

// --- 5. Presentation ----------------------------------------------------------------------------

check("your own review is listed first, then the newest", () => {
  const reviews = [
    { id: "a", clinicId: "other", createdAt: "2026-09-01" },
    { id: "b", clinicId: "mine", createdAt: "2026-08-01" },
    { id: "c", clinicId: "third", createdAt: "2026-09-05" },
  ] as SupplyReview[];
  // Own first even though it is the oldest: someone who has just written one looks for it, and
  // finding it buried reads as the save having failed.
  assert.deepEqual(sortReviews(reviews, "mine").map((r) => r.id), ["b", "c", "a"]);
});

check("the card shows Alpha's score when clinics have spoken, his otherwise", () => {
  assert.deepEqual(displayRating({ average: 4.5, count: 2 }, { average: 3, count: 90 }), {
    average: 4.5,
    count: 2,
    source: "alpha",
  });
  assert.deepEqual(displayRating({ average: 0, count: 0 }, { average: 3, count: 90 }), {
    average: 3,
    count: 90,
    source: "shop",
  });
  assert.deepEqual(displayRating({ average: 0, count: 0 }, { average: 0, count: 0 }), {
    average: 0,
    count: 0,
    source: "none",
  });
});

console.log(`\nsupplyReviews: ${passed} checks passed`);
