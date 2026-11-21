/**
 * A treatment on a company sheet that was already sent is locked — everywhere, not only on the
 * Insurance page.
 *
 * A sent month prints the list of charges stored when it was sent, read as they stand today. So a
 * price edited, a date moved or a treatment deleted from the patient's file afterwards silently
 * changes a sheet the company already has. The Insurance page refused that; the patient's file,
 * the chair pop-up and the visit's money tab (all through /api/clinical/procedures) did not.
 *
 * The rule, the same on both pages: nobody but an Owner or Admin may change it, and they only
 * after the screen has warned them and sent `confirmSentSheet: true`.
 */
import { NextResponse } from "next/server";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { isFullAccessRole } from "@/lib/permissions";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The sent sheet month that lists any of these charges, or null. One indexed query. */
export async function sentSheetOf(clinicId: string, chargeIds: readonly string[]): Promise<{ month: string; payerId: string } | null> {
  const ids = [...new Set(chargeIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 30);
  if (ids.length === 0) return null;
  const snap = await adminClinicCollection(clinicId, "settings").where("chargeIds", "array-contains-any", ids).limit(5).get();
  for (const doc of snap.docs) {
    const month = doc.get("month");
    const payerId = doc.get("payerId");
    // Only a company sheet's sent document: `company_sheet_<payerId>_<yyyy-mm>`.
    if (typeof month === "string" && MONTH.test(month) && typeof payerId === "string" && doc.id === `company_sheet_${payerId}_${month}`) {
      return { month, payerId };
    }
  }
  return null;
}

/**
 * The refusal for a write to a treatment whose charge is on a sent sheet, or null when it may go
 * ahead. `chargeIds`: the charges the treatment card carries.
 */
export async function sentSheetGate(args: {
  clinicId: string;
  role: string | null | undefined;
  chargeIds: readonly string[];
  /** The caller's `confirmSentSheet`: an Owner or Admin who has read the warning. */
  confirmed: unknown;
}): Promise<NextResponse | null> {
  const lock = await sentSheetOf(args.clinicId, args.chargeIds);
  if (!lock) return null;
  if (!isFullAccessRole(args.role)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "sheet_sent",
        month: lock.month,
        error: `This treatment is on the ${lock.month} company sheet, which was already sent. Only the owner or an admin can change it. / العلاج ده في تقفيلة ${lock.month} اللي اتبعتت للشركة. المالك أو المدير بس اللي يقدر يغيّره.`,
      },
      { status: 409 },
    );
  }
  if (args.confirmed !== true) {
    return NextResponse.json(
      {
        ok: false,
        reason: "sheet_sent_confirm",
        month: lock.month,
        error: `This treatment is on the ${lock.month} company sheet, which was already sent. Confirm to change it. / العلاج ده في تقفيلة ${lock.month} اللي اتبعتت للشركة. أكّد عشان تغيّره.`,
      },
      { status: 409 },
    );
  }
  return null;
}
