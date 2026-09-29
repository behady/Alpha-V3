import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { loadRecoveryList } from "@/lib/paymentRecovery";

/**
 * The debtors list behind the Recover Payments screen.
 *
 * Served from the server rather than read straight from Firestore in the browser because it walks
 * three whole collections to work out who owes what — pulling the entire ledger and every clinical
 * note down to a phone on clinic wifi to do the same arithmetic client-side would be slow and
 * expensive, and every device would be doing it separately.
 *
 * The clinic on screen arrives as ?clinicId=; it is honoured only when the signed-in user holds a
 * role there (resolveUserClinicId checks membership), otherwise the account's default clinic is
 * used. Without the parameter an owner of two clinics always saw the default one's debtors, even
 * while looking at the other.
 */
export async function GET(request: Request) {
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff.response;

  try {
    const requestedClinicId = new URL(request.url).searchParams.get("clinicId")?.trim() || undefined;
    const clinicId = await resolveUserClinicId(staff.uid, requestedClinicId);
    const list = await loadRecoveryList(clinicId);
    return NextResponse.json({ ok: true, ...list });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
