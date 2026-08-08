import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { listMessageDrafts, resolveMessageDraft, type DraftStatus } from "@/lib/messageDrafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The review queue for automatically drafted messages.
 *
 * Reading and approving are staff-level, not Admin-only: approving sends one message to one
 * patient, which is the same reach a receptionist already has from the patient screen. Generating
 * the queue in the first place is the Admin action.
 *
 * All mutations go through here rather than the client writing Firestore directly, so
 * message_drafts can stay server-write-only and a draft's target cannot be edited between being
 * reviewed and being sent.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const clinicId = url.searchParams.get("clinicId")?.trim();
  const status = url.searchParams.get("status")?.trim() as DraftStatus | undefined;

  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  const authz = await requireStaffUser(request, clinicId);
  if (!authz.ok) return authz.response;

  try {
    const drafts = await listMessageDrafts(clinicId, status || undefined);
    return NextResponse.json({ ok: true, drafts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load drafts";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    draftId?: string;
    decision?: "approve" | "reject";
    editedBody?: string;
    userName?: string;
  };
  const clinicId = body.clinicId?.trim();

  if (!clinicId || !body.draftId) {
    return NextResponse.json({ ok: false, error: "clinicId and draftId are required" }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json({ ok: false, error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  const authz = await requireStaffUser(request, clinicId);
  if (!authz.ok) return authz.response;

  try {
    const result = await resolveMessageDraft({
      clinicId,
      draftId: body.draftId,
      decision: body.decision,
      userId: authz.uid,
      userName: typeof body.userName === "string" ? body.userName : null,
      editedBody: typeof body.editedBody === "string" ? body.editedBody : undefined,
    });

    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that draft";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
