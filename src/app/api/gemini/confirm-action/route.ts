import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolvePendingAiAction } from "@/lib/aiPendingActions";

/**
 * Second half of the assistant's destructive-action flow.
 *
 * The chat route stages a delete and returns a confirmation prompt; this is what the widget
 * calls once the user answers. It deliberately does not re-run the model — the action to perform
 * was already decided and recorded, so replaying a whole turn would risk the model choosing
 * something different from what the user was shown, and would cost another credit.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { clinicId, actionId, decision } = body as {
    clinicId?: string;
    actionId?: string;
    decision?: "approve" | "reject";
  };

  if (!clinicId || typeof clinicId !== "string") {
    return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });
  }
  if (!actionId || typeof actionId !== "string") {
    return NextResponse.json({ ok: false, error: "actionId is required." }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ ok: false, error: "decision must be 'approve' or 'reject'." }, { status: 400 });
  }

  // Same membership check the chat route performs — the clinicId here is equally caller-supplied.
  const authz = await requireStaffUser(request, clinicId);
  if (!authz.ok) return authz.response;

  // Approving is itself a delete, so it carries the same Admin requirement the tool does. Staging
  // already checks this, but a stored action must not become a way around the gate if the user's
  // role changed in between.
  if (decision === "approve" && authz.role !== "Admin") {
    return NextResponse.json(
      { ok: false, error: "Only a Clinic Admin can confirm a deletion." },
      { status: 403 }
    );
  }

  try {
    const result = await resolvePendingAiAction({
      clinicId,
      actionId,
      decision,
      userId: authz.uid,
      userName: typeof body.userName === "string" ? body.userName : null,
      userRole: authz.role,
    });

    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not complete that action.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
