import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { sendClinicPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The happy-check — the public half of the review engine.
 *
 * Patients land here from a WhatsApp link after a completed visit. A 4–5 star answer is
 * forwarded to the clinic's public Google review page; a 1–3 star answer stays PRIVATE and goes
 * straight to the clinic's admins as a push, giving them a chance to call and fix it before it
 * ever becomes a public one-star.
 *
 * Deliberately unauthenticated: the patient has no account. The request id is the capability —
 * a Firestore auto-id from the clinic's own review_requests row, created server-side by the
 * nightly sweep. Everything else is validated against that row; the route leaks nothing beyond
 * the clinic's display name, and a made-up id answers 404.
 */

const bad = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clinicId = url.searchParams.get("c")?.trim() || "";
  const requestId = url.searchParams.get("r")?.trim() || "";
  if (!clinicId || !requestId || clinicId.length > 100 || requestId.length > 100) {
    return bad("Invalid link", 400);
  }

  try {
    const snap = await adminClinicDoc(clinicId, "review_requests", requestId).get();
    if (!snap.exists) return bad("This link is not valid.", 404);
    const data = snap.data() || {};

    const profile = await getClinicProfileAdmin(clinicId);
    return NextResponse.json({
      ok: true,
      clinicName: profile?.clinicName?.trim() || "the clinic",
      alreadyRated: data.status === "rated",
    });
  } catch (e) {
    reportServerError("[PublicReview] GET failed", e);
    return bad("Something went wrong.", 500);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    requestId?: string;
    rating?: number;
    feedback?: string;
  };
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const rating = Math.round(Number(body.rating));
  const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, 1000) : "";

  if (!clinicId || !requestId || clinicId.length > 100 || requestId.length > 100) {
    return bad("Invalid link", 400);
  }
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return bad("Rating must be 1 to 5.", 400);
  }

  try {
    const ref = adminClinicDoc(clinicId, "review_requests", requestId);
    const snap = await ref.get();
    if (!snap.exists) return bad("This link is not valid.", 404);
    const data = snap.data() || {};
    if (data.status === "rated") {
      return bad("This visit was already rated — thank you!", 409);
    }

    await ref.update({
      status: "rated",
      rating,
      feedback: feedback || "",
      ratedAt: FieldValue.serverTimestamp(),
    });

    if (rating >= 4) {
      // A 5-star patient is the reel engine's best casting call: reels of real delighted
      // patients outperform everything else the clinic can film. Tell the desk while the
      // delight is fresh — the interview questions live in Marketing → Reviews.
      if (rating === 5) {
        const patientName = String(data.patientName || "A patient");
        void sendClinicPush(
          clinicId,
          {
            title: `🌟 ${patientName} rated 5/5`,
            body: "Golden chance: ask them for a 30-second video review on their next visit. Interview questions are in Marketing → Reviews.",
          },
          { roles: ["Owner", "Admin", "Receptionist"], channel: "alpha_clinic", data: { screen: "marketing" } }
        );
      }
      const profile = await getClinicProfileAdmin(clinicId);
      const redirectUrl =
        String(profile?.googleReviewUrl || "").trim() || String(profile?.googleMapsUrl || "").trim();
      return NextResponse.json({ ok: true, happy: true, redirectUrl });
    }

    // Unhappy: the whole point — it reaches the manager's pocket, not Google.
    const patientName = String(data.patientName || "A patient");
    void sendClinicPush(
      clinicId,
      {
        title: `⭐${rating} — unhappy visit`,
        body: feedback
          ? `${patientName}: ${feedback.slice(0, 140)}`
          : `${patientName} rated their visit ${rating}/5. A quick call could turn this around.`,
      },
      { roles: ["Owner", "Admin"], channel: "alpha_clinic", data: { screen: "marketing" } }
    );

    return NextResponse.json({ ok: true, happy: false });
  } catch (e) {
    reportServerError("[PublicReview] POST failed", e);
    return bad("Something went wrong.", 500);
  }
}
