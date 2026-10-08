import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { LEAD_GRADING_DOC } from "@/lib/leads/gradeLeadServer";
import { LEAD_FLOWS, draftLeadFlow } from "@/lib/leads/leadFlowDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The admin's hand on the AI's lead-grading flow: approve a draft (as written or as edited),
 * reject it, switch grading off and on, or ask for a draft now.
 *
 * Admin SDK on purpose. The draft and the approved flow are the rules the AI grades every lead
 * by, so who may change them is decided here, once, by requireAdminUser — not by a client rule
 * on a new collection.
 */

type Body = {
  clinicId?: string;
  action?: "approve" | "reject" | "edit" | "toggle" | "draft";
  weekKey?: string;
  text?: string;
  enabled?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  // Admin of the clinic whose flow this is, not of whichever clinic the account defaults to.
  const authz = await requireAdminUser(request, typeof body.clinicId === "string" && body.clinicId ? body.clinicId : undefined);
  if (!authz.ok) return authz.response;
  const clinicId = await resolveUserClinicId(authz.uid, typeof body.clinicId === "string" ? body.clinicId : "");
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
  const settingsRef = adminClinicDoc(clinicId, "settings", LEAD_GRADING_DOC);

  try {
    switch (body.action) {
      case "toggle": {
        await settingsRef.set({ enabled: body.enabled !== false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return NextResponse.json({ ok: true, enabled: body.enabled !== false });
      }
      case "draft": {
        const result = await draftLeadFlow(clinicId, { force: true });
        return NextResponse.json({ ok: true, ...result });
      }
      case "edit":
      case "approve":
      case "reject": {
        const weekKey = String(body.weekKey || "").trim();
        if (!/^\d{4}-W\d{2}$/.test(weekKey)) return NextResponse.json({ ok: false, error: "weekKey" }, { status: 400 });
        const flowRef = adminClinicDoc(clinicId, LEAD_FLOWS, weekKey);
        const snap = await flowRef.get();
        if (!snap.exists) return NextResponse.json({ ok: false, error: "No such draft" }, { status: 404 });
        const d = snap.data() || {};
        if (body.action === "edit") {
          const text = String(body.text || "").trim().slice(0, 6000);
          await flowRef.set({ editedText: text, editedAt: FieldValue.serverTimestamp(), editedBy: authz.uid }, { merge: true });
          return NextResponse.json({ ok: true });
        }
        if (body.action === "reject") {
          await flowRef.set({ status: "rejected", decidedAt: FieldValue.serverTimestamp(), decidedBy: authz.uid }, { merge: true });
          await settingsRef.set({ pendingWeek: FieldValue.delete() }, { merge: true });
          return NextResponse.json({ ok: true });
        }
        const text = String(body.text ?? d.editedText ?? d.text ?? "").trim().slice(0, 6000);
        if (!text) return NextResponse.json({ ok: false, error: "Empty flow" }, { status: 400 });
        const approvedAtMs = Date.now();
        await flowRef.set({ status: "approved", editedText: text, decidedAt: FieldValue.serverTimestamp(), decidedBy: authz.uid }, { merge: true });
        await settingsRef.set(
          {
            approvedFlow: { text, weekKey, approvedAtMs, approvedBy: authz.uid, profile: String(d.profile || "") },
            pendingWeek: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return NextResponse.json({ ok: true, approvedAtMs });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
