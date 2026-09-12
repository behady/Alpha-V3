import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  SUPPLY_REVIEWS_COLLECTION,
  SUPPLY_REVIEW_STATS_COLLECTION,
  applyRatingToStats,
  type SupplyReviewStats,
} from "@/lib/supplyReviews";

/**
 * Moderating what one clinic says to all the others.
 *
 * SUPERADMIN ONLY. Reviews are published to every clinic on the platform, so there has to be a
 * way to take one down — a mistaken accusation about a medical supply is not something to leave
 * up while emails are exchanged.
 *
 * Hiding, never deleting. The document stays, carrying who hid it and why, so the decision can be
 * examined and reversed. A moderation tool that destroys the thing it moderates cannot be audited,
 * and the clinic that wrote the review still sees their own — see the GET in api/store/reviews.
 *
 * Hiding also removes the rating from the product's average. A review nobody may read must not go
 * on counting against a supplier's score.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const limit = Math.max(1, Math.min(300, Number(new URL(request.url).searchParams.get("limit")) || 100));
    const snap = await adminDb()
      .collection(SUPPLY_REVIEWS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return NextResponse.json({
      ok: true,
      reviews: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load reviews";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      reviewId?: string;
      hidden?: boolean;
      reason?: string;
    };

    const reviewId = (body.reviewId || "").trim();
    if (!reviewId) return NextResponse.json({ ok: false, error: "reviewId is required" }, { status: 400 });
    if (typeof body.hidden !== "boolean") {
      return NextResponse.json({ ok: false, error: "hidden must be true or false" }, { status: 400 });
    }

    const db = adminDb();
    const reviewRef = db.collection(SUPPLY_REVIEWS_COLLECTION).doc(reviewId);

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(reviewRef);
      if (!existing.exists) throw new Error("That review no longer exists.");

      const data = existing.data() ?? {};
      const wasHidden = data.hidden === true;
      if (wasHidden === body.hidden) return; // Nothing to do; do not double-count the average.

      const productId = Math.floor(Number(data.productId) || 0);
      const rating = Number(data.rating) || 0;
      const statsRef = db.collection(SUPPLY_REVIEW_STATS_COLLECTION).doc(String(productId));
      const statsDoc = await tx.get(statsRef);
      const stats = statsDoc.exists ? (statsDoc.data() as SupplyReviewStats) : null;

      tx.update(reviewRef, {
        hidden: body.hidden,
        hiddenReason: body.hidden ? (body.reason || "").trim().slice(0, 300) : "",
        hiddenBy: body.hidden ? authz.uid : "",
        hiddenAt: body.hidden ? new Date().toISOString() : "",
      });

      // Out of the average when hidden, back into it when restored.
      tx.set(
        statsRef,
        body.hidden
          ? applyRatingToStats(stats, productId, rating, null)
          : applyRatingToStats(stats, productId, null, rating)
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update that review";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
