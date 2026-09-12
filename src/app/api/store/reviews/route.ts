import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  SUPPLY_REVIEWS_COLLECTION,
  SUPPLY_REVIEW_STATS_COLLECTION,
  applyRatingToStats,
  cleanReviewText,
  hasPurchased,
  reviewDocId,
  sortReviews,
  validateReview,
  type SupplyReview,
  type SupplyReviewStats,
} from "@/lib/supplyReviews";

/**
 * Clinic-to-clinic reviews of the partner's supplies.
 *
 * Cross-tenant on purpose: a clinic in Alexandria reads what a clinic in Giza thought of the same
 * scaler. That is exactly why it is served from here rather than read from the browser —
 * firestore.rules denies both collections to every client. A rule cannot express "any clinic may
 * read this, no clinic may write another's, and nobody sees a hidden one" without becoming the
 * kind of rule that is wrong in a way nobody notices.
 *
 * Writing is gated on `store.order`, the permission that lets someone spend. A review is the
 * clinic speaking, in its own name, to every other clinic on the platform; that is closer to
 * publishing than to browsing, and the people trusted to commit the clinic's money are the right
 * set. It also has to be EARNED: only a clinic whose own order history names the product may
 * review it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Everything a clinic may see about a review. The hidden ones never leave this file. */
function publicReview(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): SupplyReview {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    productId: Number(d.productId) || 0,
    productName: text(d.productName),
    rating: Number(d.rating) || 0,
    text: text(d.text),
    clinicId: text(d.clinicId),
    clinicName: text(d.clinicName),
    authorUid: text(d.authorUid),
    authorName: text(d.authorName),
    createdAt: text(d.createdAt),
    updatedAt: text(d.updatedAt),
    hidden: d.hidden === true,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinic = url.searchParams.get("clinicId") || "";
  const productId = Math.floor(Number(url.searchParams.get("productId")) || 0);

  const staff = await requireStaffPermission(request, requestedClinic || undefined, "access.store", {
    allowInactive: true,
  });
  if (!staff.ok) return staff.response;

  if (!productId) {
    return NextResponse.json({ ok: false, error: "productId is required" }, { status: 400 });
  }

  try {
    const clinicId = await resolveUserClinicId(staff.uid, requestedClinic);
    const db = adminDb();

    const [snap, statsSnap, ordersSnap] = await Promise.all([
      db
        .collection(SUPPLY_REVIEWS_COLLECTION)
        .where("productId", "==", productId)
        .limit(200)
        .get(),
      db.collection(SUPPLY_REVIEW_STATS_COLLECTION).doc(String(productId)).get(),
      // Has this clinic bought it? Decides whether the write form renders at all, so it is
      // answered here rather than left for the POST to refuse after someone has typed a review.
      db
        .collection("clinics")
        .doc(clinicId)
        .collection("supply_orders")
        .where("productIds", "array-contains", productId)
        .limit(1)
        .get(),
    ]);

    const all = snap.docs.map(publicReview);
    // A hidden review is withheld from everyone EXCEPT the clinic that wrote it, which still sees
    // its own — a review that silently vanishes from its author's view teaches them to write it
    // again rather than to ask why.
    const visible = all.filter((r) => !r.hidden || r.clinicId === clinicId);

    const stats = statsSnap.exists ? (statsSnap.data() as SupplyReviewStats) : null;

    return NextResponse.json({
      ok: true,
      reviews: sortReviews(visible, clinicId).map((r) => ({ ...r, hidden: r.hidden ? true : undefined })),
      stats: stats ? { count: stats.count, average: stats.average } : { count: 0, average: 0 },
      /** Whether this clinic may write one, and why not when it may not. */
      canReview: !ordersSnap.empty,
      ownReviewId: reviewDocId(productId, clinicId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load reviews";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    productId?: number;
    productName?: string;
    rating?: number;
    text?: string;
  };

  const staff = await requireStaffPermission(request, body.clinicId || undefined, "store.order");
  if (!staff.ok) return staff.response;

  const productId = Math.floor(Number(body.productId) || 0);
  if (!productId) return NextResponse.json({ ok: false, error: "productId is required" }, { status: 400 });

  const valid = validateReview({ rating: Number(body.rating), text: text(body.text) });
  if (!valid.ok) return NextResponse.json({ ok: false, error: valid.error }, { status: 400 });

  try {
    const clinicId = await resolveUserClinicId(staff.uid, body.clinicId || "");
    const db = adminDb();

    // Verified purchase, checked here and not only on the GET: the form being hidden is a
    // courtesy, this is the rule.
    const ordersSnap = await db
      .collection("clinics")
      .doc(clinicId)
      .collection("supply_orders")
      .where("productIds", "array-contains", productId)
      .limit(5)
      .get();

    const purchased = hasPurchased(
      ordersSnap.docs.map((d) => (Array.isArray(d.data().productIds) ? (d.data().productIds as number[]) : [])),
      productId
    );
    if (!purchased) {
      return NextResponse.json(
        { ok: false, error: "You can review this once your clinic has ordered it." },
        { status: 403 }
      );
    }

    const clinicSnap = await db.collection("clinics").doc(clinicId).get();
    const clinicName = text(clinicSnap.data()?.name) || "A clinic";

    const docId = reviewDocId(productId, clinicId);
    const reviewRef = db.collection(SUPPLY_REVIEWS_COLLECTION).doc(docId);
    const statsRef = db.collection(SUPPLY_REVIEW_STATS_COLLECTION).doc(String(productId));
    const rating = Math.round(Number(body.rating));
    const now = new Date().toISOString();

    /**
     * The review and the running average move together or not at all.
     *
     * A transaction rather than a batch because the average is read, adjusted and written back:
     * two clinics reviewing the same product in the same second would otherwise each apply their
     * change to the same stale total, and one of them would be lost.
     */
    await db.runTransaction(async (tx) => {
      const [existing, statsDoc] = await Promise.all([tx.get(reviewRef), tx.get(statsRef)]);
      const previousRating = existing.exists ? Number(existing.data()?.rating) || null : null;
      const stats = statsDoc.exists ? (statsDoc.data() as SupplyReviewStats) : null;

      tx.set(
        reviewRef,
        {
          productId,
          productName: text(body.productName).slice(0, 200),
          rating,
          text: cleanReviewText(text(body.text)),
          clinicId,
          clinicName,
          authorUid: staff.uid,
          authorName: staff.name,
          createdAt: existing.exists ? text(existing.data()?.createdAt) || now : now,
          updatedAt: now,
          // An edit does not clear a superadmin's decision to hide it. Rewriting a hidden review
          // to make it visible again would make moderation a formality.
          hidden: existing.exists ? existing.data()?.hidden === true : false,
        },
        { merge: true }
      );

      tx.set(statsRef, applyRatingToStats(stats, productId, previousRating, rating));
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save your review";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const requestedClinic = url.searchParams.get("clinicId") || "";
  const productId = Math.floor(Number(url.searchParams.get("productId")) || 0);

  // Removing your own clinic's review needs the same standing as writing it.
  const staff = await requireStaffPermission(request, requestedClinic || undefined, "store.order");
  if (!staff.ok) return staff.response;
  if (!productId) return NextResponse.json({ ok: false, error: "productId is required" }, { status: 400 });

  try {
    const clinicId = await resolveUserClinicId(staff.uid, requestedClinic);
    const db = adminDb();
    const reviewRef = db.collection(SUPPLY_REVIEWS_COLLECTION).doc(reviewDocId(productId, clinicId));
    const statsRef = db.collection(SUPPLY_REVIEW_STATS_COLLECTION).doc(String(productId));

    await db.runTransaction(async (tx) => {
      const [existing, statsDoc] = await Promise.all([tx.get(reviewRef), tx.get(statsRef)]);
      if (!existing.exists) return;
      // The document id is derived from (product, clinic), so reaching this line at all proves
      // the review belongs to the caller's clinic — there is no id to tamper with.
      const previousRating = Number(existing.data()?.rating) || null;
      tx.delete(reviewRef);
      tx.set(
        statsRef,
        applyRatingToStats(statsDoc.exists ? (statsDoc.data() as SupplyReviewStats) : null, productId, previousRating, null)
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove your review";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
