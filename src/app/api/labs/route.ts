import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, resolveUserClinicId } from "@/lib/adminClinicDb";

type LabServicePrice = {
  name: string;
  price: number;
  turnaroundDays: number;
};

export async function GET(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    // Root-level `labs` would be one shared list across every tenant; each clinic keeps its own.
    const clinicId = await resolveUserClinicId(authz.uid);
    const snap = await adminClinicCollection(clinicId, "labs").orderBy("name").get();
    const labs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ ok: true, labs });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load labs";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid);

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      phone?: string;
      address?: string;
      notes?: string;
      servicesPricing?: LabServicePrice[];
    };

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const servicesPricing = Array.isArray(body.servicesPricing) ? body.servicesPricing : [];

    if (!name || !phone) {
      return NextResponse.json({ ok: false, error: "name and phone are required" }, { status: 400 });
    }

    const payload = {
      name,
      phone,
      address,
      notes,
      servicesPricing: servicesPricing
        .map((s) => ({
          name: String(s?.name || "").trim(),
          price: Number(s?.price) || 0,
          turnaroundDays: Number(s?.turnaroundDays) || 0,
        }))
        .filter((s) => s.name),
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: authz.uid || "unknown",
    };

    if (id) {
      await adminClinicCollection(clinicId, "labs").doc(id).set(payload, { merge: true });
      return NextResponse.json({ ok: true, id });
    }

    const ref = await adminClinicCollection(clinicId, "labs").add({
      ...payload,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: authz.uid || "unknown",
    });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to save lab";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
