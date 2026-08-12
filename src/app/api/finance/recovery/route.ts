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
 * The clinic is resolved from the signed-in user, never taken from the request, so one clinic
 * cannot ask for another's debtors by editing a parameter.
 */
export async function GET(request: Request) {
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff.response;

  try {
    const clinicId = await resolveUserClinicId(staff.uid);
    const list = await loadRecoveryList(clinicId);
    return NextResponse.json({ ok: true, ...list });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
