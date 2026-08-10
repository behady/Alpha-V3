import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { sendWhatsApp } from "@/lib/whatsapp";

function normalizeProcedureText(
  procedure: unknown,
  procedures: unknown
): string {
  const list = Array.isArray(procedures)
    ? procedures.map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (list.length > 0) return list.join(" + ");
  return String(procedure || "").trim() || "Procedure";
}

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    // Clinic data lives under clinics/{clinicId}/. These reads were hitting root-level
    // collections that do not exist, so they silently resolved to empty and this route
    // could never find the record it was asked to send.
    const clinicId = await resolveUserClinicId(authz.uid);

    const body = (await request.json().catch(() => ({}))) as { orderId?: string };
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }

    const orderSnap = await adminClinicDoc(clinicId, "lab_orders", orderId).get();
    if (!orderSnap.exists) {
      return NextResponse.json({ ok: false, error: "Lab order not found" }, { status: 404 });
    }
    const order = orderSnap.data() as Record<string, unknown>;

    const labPhone = String(order.labPhone || "").trim();
    if (!labPhone) {
      return NextResponse.json({ ok: false, error: "Lab order has no lab phone" }, { status: 400 });
    }

    const patientName = String(order.patientName || "Patient");
    const doctorName = String(order.doctorName || "Doctor");
    const labName = String(order.labName || "Lab");
    const teeth = String(order.tooth || "General");
    const dueDate = String(order.dueDate || "—");
    const note = String(order.note || "").trim();
    const shade = String(order.shade || "").trim();
    const impressionType = String(order.impressionType || "").trim();
    const estimated = Number(order.estimatedLabCost) || 0;
    const procedureText = normalizeProcedureText(order.procedure, order.procedures);

    const msg = [
      `🧪 *Lab Order — ${labName}*`,
      `Patient: ${patientName}`,
      `Doctor: ${doctorName}`,
      `Procedures: ${procedureText}`,
      `Teeth: ${teeth}`,
      shade ? `Shade: ${shade}` : "",
      impressionType ? `Impression: ${impressionType}` : "",
      `Due date: ${dueDate}`,
      `Estimated cost: ${estimated.toLocaleString()} EGP`,
      note ? `Notes: ${note}` : "",
      "",
      `Order ID: ${orderId}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await sendWhatsApp({ clinicId, to: labPhone, text: msg });
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId: String(order.patientId || ""),
        type: "lab_order",
        message: msg,
        status: "success",
        createdAt: FieldValue.serverTimestamp(),
      });
      await adminClinicDoc(clinicId, "lab_orders", orderId).update({
        whatsappSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Send failed";
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId: String(order.patientId || ""),
        type: "lab_order",
        message: msg,
        status: "failed",
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
