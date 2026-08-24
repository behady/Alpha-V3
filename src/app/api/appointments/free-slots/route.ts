import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { suggestSlots } from "@/lib/automation/slotSuggestions";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SCAN_DAYS = 30;
const MAX_RESULT_DAYS = 6;
const MAX_TIMES_PER_DAY = 8;

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Days with free appointment slots, walking forward from a date.
 *
 * Thin staff-authed wrapper around the same suggestSlots engine the AI assistant uses, so the
 * treatment-plan editor offers exactly the availability the rest of the system believes in —
 * clinic hours, days off, and existing bookings included.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });
    }

    const authz = await requireStaffUser(req, clinicId);
    if (!authz.ok) return authz.response;

    const today = ymdInTimeZone(clinicTimeZone());
    let fromDate = typeof body?.fromDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fromDate)
      ? body.fromDate
      : today;
    // Never offer the past.
    if (fromDate < today) fromDate = today;

    const wantedDays = Math.min(MAX_RESULT_DAYS, Math.max(1, Number(body?.maxDays) || 4));
    // The visit's chair time — a long visit must only be offered gaps it actually fits in.
    const durationMinutes =
      Number(body?.durationMinutes) > 0 ? Math.min(300, Math.max(5, Math.round(Number(body.durationMinutes)))) : null;

    const days: Array<{ date: string; dayName: string; times: string[] }> = [];
    const notes = new Set<string>();

    for (let i = 0; i < MAX_SCAN_DAYS && days.length < wantedDays; i++) {
      const date = addDays(fromDate, i);
      const res = await suggestSlots({ clinicId, date, durationMinutes });
      res.notes.forEach((n) => notes.add(n));
      if (res.slots.length > 0) {
        days.push({
          date,
          dayName: res.dayName,
          times: res.slots.slice(0, MAX_TIMES_PER_DAY).map((s) => s.time),
        });
      }
    }

    return NextResponse.json({ ok: true, days, notes: Array.from(notes) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load free slots";
    reportServerError("[FreeSlots] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
