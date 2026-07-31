import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
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
    const body = (await request.json().catch(() => ({}))) as { orderId?: string };
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }

    const orderSnap = await adminDb().collection("lab_orders").doc(orderId).get();
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
      await sendWhatsApp({ to: labPhone, text: msg });
      await adminDb().collection("whatsapp_logs").add({
        patientId: String(order.patientId || ""),
        type: "lab_order",
        message: msg,
        status: "success",
        createdAt: FieldValue.serverTimestamp(),
      });
      await adminDb().collection("lab_orders").doc(orderId).update({
        whatsappSentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Send failed";
      await adminDb().collection("whatsapp_logs").add({
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
