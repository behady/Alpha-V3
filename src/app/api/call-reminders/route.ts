import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { createReminder, deleteReminder, editReminder, markBooked, markDone, reschedule, type Actor, type Outcome } from "@/lib/callRemindersServer";
import type { ReminderInput } from "@/lib/callReminders";

/**
 * Call reminders: create, edit, done, call again, book, delete. The only writer of `call_reminders`;
 * the decisions live in lib/callRemindersServer.ts and lib/callReminders.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function answer(result: Outcome<Record<string, unknown>>) {
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad-action" }, { status: 400 });
  }
  const staff = await requireStaffUser(request, typeof body.clinicId === "string" ? body.clinicId : undefined);
  if (!staff.ok) return staff.response;
  const clinicId = staff.clinicId;
  if (!clinicId) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const actor: Actor = { uid: staff.uid, name: staff.name || "", role: staff.role };
  const id = String(body.id || "");

  switch (body.action) {
    case "create":
      return answer(await createReminder(clinicId, actor, body as unknown as ReminderInput, typeof body.branchId === "string" && body.branchId ? body.branchId : null));
    case "done":
      return answer(await markDone(clinicId, actor, id, body.note as string | undefined));
    case "reschedule":
      return answer(await reschedule(clinicId, actor, id, String(body.date || ""), typeof body.time === "string" && body.time ? body.time : null, body.note as string | undefined));
    case "book":
      return answer(await markBooked(clinicId, actor, id, String(body.appointmentId || ""), String(body.appointmentDate || "")));
    case "edit":
      return answer(
        await editReminder(clinicId, actor, id, {
          date: String(body.date || ""),
          time: typeof body.time === "string" && body.time ? body.time : null,
          reason: String(body.reason ?? ""),
          recipient: body.recipient as ReminderInput["recipient"],
        }),
      );
    case "delete":
      return answer(await deleteReminder(clinicId, actor, id));
    default:
      return NextResponse.json({ ok: false, error: "bad-action" }, { status: 400 });
  }
}
