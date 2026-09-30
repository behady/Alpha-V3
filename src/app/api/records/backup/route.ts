import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { logActivityServer } from "@/lib/server/systemLog";
import { reportServerError } from "@/lib/server/reportError";
import { loadClinicBackupData } from "@/lib/backup/loadClinicBackupData";
import { buildClinicWorkbook, workbookToBuffer } from "@/lib/backup/buildClinicWorkbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Every collection the clinic owns, paged in full. A clinic with years of history takes minutes. */
export const maxDuration = 300;

/**
 * The Excel backup: the whole clinic in one readable workbook.
 *
 * GET ?clinicId=...&lang=en|ar
 *
 * Owner or Admin only. The file carries salaries, every patient's medical history and every
 * payment, which is exactly the set of things the permission checkboxes exist to hide from a
 * receptionist; there is no partial backup for a partial role.
 *
 * `allowInactive` is deliberate. A clinic whose subscription lapsed must still be able to take its
 * own data out — that is the promise that makes it safe to put the data in. Nothing here writes,
 * so the expiry gate protects nothing by refusing.
 *
 * The clinic is resolved from the caller's membership, not the query string alone, and the file
 * is built in memory and sent whole: a failure produces an error, never a truncated workbook the
 * owner would trust.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;
  const language = url.searchParams.get("lang") === "ar" ? "ar" : "en";

  const authz = await requireAdminUser(request, requestedClinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const timeZone = clinicTimeZone();
    const today = ymdInTimeZone(timeZone);

    const data = await loadClinicBackupData({ clinicId, generatedBy: authz.name || "" });
    const workbook = buildClinicWorkbook(data, { language, today });
    const bytes = workbookToBuffer(workbook);

    await logActivityServer({
      clinicId,
      user: { uid: authz.uid, name: authz.name, role: authz.role },
      action: "backup.download",
      details:
        `Excel backup downloaded: ${data.patients.length} patients, ${data.appointments.length} appointments, ` +
        `${data.ledger.length} ledger rows`,
      severity: "MEDIUM",
      module: "system",
    });

    // ASCII-only filename: the clinic's name (often Arabic) is inside the file, on the About sheet.
    const filename = `alpha-backup-${today}.xlsx`;
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build the backup";
    reportServerError("[Backup] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
