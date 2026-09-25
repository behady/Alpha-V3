import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { isFullAccessRole } from "@/lib/permissions";
import { deliverClinicNotification } from "@/lib/notificationDelivery";
import { notifyEvent } from "@/lib/notificationCatalog";

/**
 * Raise one catalogued alert, from the browser.
 *
 * Most alerts are raised by the server or by a Cloud Function, which is right — they are reactions
 * to things happening. Two cases genuinely start in somebody's hands, and both need this route:
 *
 *  - **A lab case marked received.** The event IS a person's click, so there is nothing to poll
 *    for. It used to write into `notifications` straight from the browser, which meant it wrote a
 *    row in a shape nothing else uses: no audience (so the bell could not tell who it was for) and
 *    a single shared `read` flag. Going through the same gate as everything else gives it proper
 *    targeting, the clinic's own on/off answer, and a push — which it never had.
 *  - **"Send me a test" on the settings page.** A notification centre where you cannot prove a
 *    switch works is a notification centre you have to trust. Admins only, and the title says so.
 *
 * Nothing else may raise alerts from a browser. `CLIENT_RAISABLE` is an allowlist, not a filter:
 * a route that accepted any event id would let any signed-in member of any clinic manufacture a
 * "paid lead abandoned" alert for their owner, or push arbitrary text to every phone in the
 * building.
 */

/** Alerts a non-admin member of the clinic may raise, because their own action is the trigger. */
const CLIENT_RAISABLE = new Set(["labCaseBack"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      clinicId?: string;
      event?: string;
      title?: string;
      body?: string;
      actionUrl?: string;
      data?: Record<string, string>;
      test?: boolean;
    };

    const clinicId = String(body.clinicId || "").trim();
    const eventId = String(body.event || "").trim();
    if (!clinicId || !eventId) {
      return NextResponse.json({ ok: false, error: "clinicId and event are required" }, { status: 400 });
    }

    // Membership is proven against the clinic named in the body, so a member of one clinic cannot
    // raise an alert inside another.
    const staff = await requireStaffUser(request, clinicId);
    if (!staff.ok) return staff.response;

    const meta = notifyEvent(eventId);
    if (!meta) return NextResponse.json({ ok: false, error: "Unknown event" }, { status: 400 });

    const isAdmin = isFullAccessRole(staff.role) || staff.isSuperAdmin;
    if (!isAdmin && !CLIENT_RAISABLE.has(eventId)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const test = body.test === true;
    if (test && !isAdmin) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // A test is addressed to the person who asked for it and nobody else. Sending the clinic's
    // whole staff a fake "a patient is waiting" to prove a switch works is how a team learns to
    // ignore the alert that matters.
    const title = test ? `🧪 ${String(body.title || meta.en).slice(0, 120)}` : String(body.title || meta.en).slice(0, 200);
    const text = test
      ? `This is a test, sent only to you. ${String(body.body || meta.whenEn)}`.slice(0, 400)
      : String(body.body || meta.whenEn).slice(0, 400);

    const result = await deliverClinicNotification(
      clinicId,
      { title, body: text },
      {
        event: eventId,
        ...(test ? { uids: [staff.uid] } : {}),
        ...(body.actionUrl ? { actionUrl: String(body.actionUrl).slice(0, 300) } : {}),
        ...(body.data ? { data: body.data } : {}),
      },
    );

    return NextResponse.json({ ok: true, ...result, event: undefined, raised: result.raised });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
