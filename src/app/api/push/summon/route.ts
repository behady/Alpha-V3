import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb, adminMessaging } from "@/lib/firebaseAdmin";
import { adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    const payload = (await request.json().catch(() => ({}))) as { summonId?: string };
    const summonId = typeof payload.summonId === "string" ? payload.summonId.trim() : "";
    if (!summonId) {
      return NextResponse.json({ ok: false, error: "summonId required" }, { status: 400 });
    }

    // lib/staffSummon writes these via getClinicCollection, i.e. clinics/{clinicId}/staff_summons.
    // Reading at the root found nothing, so every summon push silently 404'd.
    const clinicId = await resolveUserClinicId(authz.uid);
    const summonSnap = await adminClinicDoc(clinicId, "staff_summons", summonId).get();
    if (!summonSnap.exists) {
      return NextResponse.json({ ok: false, error: "Summon not found" }, { status: 404 });
    }

    const summon = summonSnap.data() || {};
    if (summon.status !== "pending") {
      return NextResponse.json({ ok: true, skipped: true, reason: "not_pending" });
    }

    const targetUid = typeof summon.targetUid === "string" ? summon.targetUid : "";
    if (!targetUid) {
      return NextResponse.json({ ok: false, error: "No target user on summon" }, { status: 400 });
    }

    const userSnap = await adminDb().collection("users").doc(targetUid).get();
    const rawTokens = userSnap.exists ? userSnap.data()?.fcmTokens : null;
    const tokens = Array.isArray(rawTokens)
      ? rawTokens.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];

    if (tokens.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: "no_fcm_tokens" });
    }

    const requesterName = String(summon.requestedByName || "Doctor");
    const title = "Doctor needs you | الطبيب يطلبك";
    const notificationBody = `${requesterName} is calling you to the desk | ${requesterName} يطلب حضورك`;

    const messaging = adminMessaging();
    const result = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body: notificationBody },
      data: {
        type: "staff_summon",
        summonId,
        requestedByName: requesterName,
      },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          title,
          body: notificationBody,
          icon: "/logo.png",
          requireInteraction: true,
        },
        fcmOptions: { link: "/" },
      },
    });

    const invalid: string[] = [];
    result.responses.forEach((resp, i) => {
      if (!resp.success && resp.error?.code === "messaging/registration-token-not-registered") {
        invalid.push(tokens[i]);
      }
    });

    if (invalid.length > 0) {
      const kept = tokens.filter((t) => !invalid.includes(t));
      await adminDb()
        .collection("users")
        .doc(targetUid)
        .set({ fcmTokens: kept, fcmTokensUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    return NextResponse.json({
      ok: true,
      sent: result.successCount,
      failed: result.failureCount,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Push failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
