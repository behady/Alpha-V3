import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { isFullAccessRole } from "@/lib/permissions";
import { clinicDisplayName } from "@/lib/sms/events";
import { clinicView, OPEN_REQUESTS_PER_CLINIC, requestToTask, taskFromDoc } from "@/lib/platformTasks";
import { TASKS_COLLECTION } from "@/lib/server/tasksDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Ask Alpha for a change" on the Help page. A clinic's owner or admin writes what they need; it
 * lands on the platform owner's Tasks list as a To-do marked New, with the clinic's name.
 *
 * The clinic sees only its own requests and only the title, the stage and the dates — never the
 * console's notes or priority. Nothing in the clinic's own data is read or written.
 *
 *   GET  ?clinicId=…                 → this clinic's requests, newest first
 *   POST { clinicId, text }          → the new request
 */
async function admit(request: Request, clinicId: string, allowInactive: boolean) {
  const staff = await requireStaffUser(request, clinicId, { allowInactive });
  if (!staff.ok) return staff;
  if (!staff.clinicId || !(staff.isSuperAdmin || isFullAccessRole(staff.role))) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Only the clinic's owner or admins can send requests" }, { status: 403 }) };
  }
  return { ...staff, clinicId: staff.clinicId };
}

export async function GET(request: Request) {
  const clinicId = new URL(request.url).searchParams.get("clinicId") || "";
  const staff = await admit(request, clinicId, true);
  if (!staff.ok) return staff.response;
  try {
    const snap = await adminDb().collection(TASKS_COLLECTION).where("clinicId", "==", staff.clinicId).limit(100).get();
    const items = snap.docs
      .map((d) => taskFromDoc(d.id, d.data()))
      .filter((t) => t.source === "clinic")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clinicView);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    reportServerError("task requests list error:", error);
    return NextResponse.json({ ok: false, error: "Could not load your requests" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  const staff = await admit(request, typeof body.clinicId === "string" ? body.clinicId : "", true);
  if (!staff.ok) return staff.response;

  const parsed = requestToTask(body.text);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const col = adminDb().collection(TASKS_COLLECTION);
    const mine = await col.where("clinicId", "==", staff.clinicId).limit(200).get();
    const open = mine.docs.filter((d) => d.data().status !== "live").length;
    if (open >= OPEN_REQUESTS_PER_CLINIC) {
      return NextResponse.json({ ok: false, error: "You have many requests waiting. We will finish some first." }, { status: 429 });
    }
    const now = new Date().toISOString();
    const row = {
      title: parsed.title,
      notes: parsed.notes,
      clinic: (await clinicDisplayName(staff.clinicId)) || "",
      status: "todo",
      priority: "normal",
      startDate: "",
      deadline: "",
      createdAt: now,
      updatedAt: now,
      liveAt: "",
      source: "clinic",
      clinicId: staff.clinicId,
      requestedBy: staff.name,
      seen: false,
      createdBy: staff.uid,
    };
    const ref = await col.add(row);
    return NextResponse.json({ ok: true, item: clinicView(taskFromDoc(ref.id, row)) });
  } catch (error) {
    reportServerError("task request create error:", error);
    return NextResponse.json({ ok: false, error: "Could not send" }, { status: 500 });
  }
}
