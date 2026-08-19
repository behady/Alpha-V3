import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { normalizeToE164 } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The referral funnel's public half — where a friend's QR code or shared link lands.
 *
 * A visitor leaves a name and phone; a lead appears in the clinic's inbox already tagged
 * "Friend referral" with WHO referred them — which is what finally makes word-of-mouth,
 * the clinic's biggest channel, measurable and rewardable.
 *
 * Unauthenticated by nature. The abuse surface is lead spam, held down three ways: an
 * invisible honeypot field only bots fill, a per-clinic creation cap per hour, and the
 * referrer id having to match a real patient of that clinic.
 */

const bad = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

/** First name only — a public page must not leak a patient's full identity. */
const firstName = (v: unknown) => String(v || "").trim().split(/\s+/)[0] || "";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clinicId = url.searchParams.get("c")?.trim() || "";
  const referrerId = url.searchParams.get("p")?.trim() || "";
  if (!clinicId || !referrerId || clinicId.length > 100 || referrerId.length > 100) {
    return bad("Invalid link", 400);
  }

  try {
    const patientSnap = await adminClinicDoc(clinicId, "patients", referrerId).get();
    if (!patientSnap.exists) return bad("This link is not valid.", 404);

    const profile = await getClinicProfileAdmin(clinicId);
    let clinicName = profile?.clinicName?.trim() || "";
    if (!clinicName) {
      const infoSnap = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
      const d = infoSnap.data() as Record<string, unknown> | undefined;
      clinicName = (typeof d?.clinicName === "string" && d.clinicName.trim()) || "our clinic";
    }

    return NextResponse.json({
      ok: true,
      clinicName,
      referrerFirstName: firstName(patientSnap.data()?.name),
    });
  } catch (e) {
    console.error("[PublicReferral] GET failed", e);
    return bad("Something went wrong.", 500);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    referrerId?: string;
    name?: string;
    phone?: string;
    /** Honeypot: humans never see this field, so a value here means a bot. */
    website?: string;
  };
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  const referrerId = typeof body.referrerId === "string" ? body.referrerId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const phoneRaw = typeof body.phone === "string" ? body.phone.trim().slice(0, 30) : "";

  if (typeof body.website === "string" && body.website.trim()) {
    // Bot filled the honeypot. Answer success so it learns nothing.
    return NextResponse.json({ ok: true });
  }
  if (!clinicId || !referrerId || clinicId.length > 100 || referrerId.length > 100) {
    return bad("Invalid link", 400);
  }
  if (!name || name.length < 2) return bad("Please write your name.", 400);
  const phone = normalizeToE164(phoneRaw) || "";
  if (!phone) return bad("Please write a valid phone number.", 400);

  try {
    const referrerSnap = await adminClinicDoc(clinicId, "patients", referrerId).get();
    if (!referrerSnap.exists) return bad("This link is not valid.", 404);
    const referrerName = String(referrerSnap.data()?.name || "").trim();

    // Flood guard: one clinic cannot be spammed into an unusable inbox through this route.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSnap = await adminClinicCollection(clinicId, "leads")
      .where("createdAt", ">=", hourAgo)
      .limit(60)
      .get();
    const recentReferrals = recentSnap.docs.filter(
      (d) => String(d.data().createdBy || "") === "referral_page"
    ).length;
    if (recentReferrals >= 25) {
      return bad("Too many requests right now — please try again later.", 429);
    }

    // The same intake stamps the Leads inbox writes on its own leads: reception should see
    // "already a patient" / "asked before" here exactly like everywhere else.
    let existingPatientId: string | null = null;
    let existingPatientName: string | null = null;
    let duplicateOfLeadId: string | null = null;
    const dupLeadSnap = await adminClinicCollection(clinicId, "leads")
      .where("phone", "==", phone).limit(1).get();
    if (!dupLeadSnap.empty) duplicateOfLeadId = dupLeadSnap.docs[0].id;
    for (const field of ["phone", "phoneNumber", "phoneE164", "mobile"]) {
      const snap = await adminClinicCollection(clinicId, "patients")
        .where(field, "==", phone).limit(1).get();
      if (!snap.empty) {
        existingPatientId = snap.docs[0].id;
        existingPatientName = String(snap.docs[0].data()?.name || "") || null;
        break;
      }
    }

    await adminClinicCollection(clinicId, "leads").add({
      name,
      phone,
      interest: "",
      source: "Friend referral",
      stage: "new",
      notes: referrerName ? `Referred by ${referrerName}` : "Came through a referral link",
      referredByPatientId: referrerId,
      referredByName: referrerName || null,
      existingPatientId,
      existingPatientName,
      duplicateOfLeadId,
      branchId: null,
      branchName: null,
      followUpDate: null,
      patientId: null,
      createdBy: "referral_page",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[PublicReferral] POST failed", e);
    return bad("Something went wrong.", 500);
  }
}
