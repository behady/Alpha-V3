import { NextResponse } from "next/server";
import { authenticateDevice, touchDevice } from "@/lib/sms/devices";
import { ackSms, claimSms, type SmsAck } from "@/lib/sms/outbox";

/**
 * The paired phone's only two calls: "what should I send?" and "here is what happened".
 *
 * Both are authenticated with the device token, never a staff login — the phone runs unattended in
 * a drawer at 07:00, with nobody signed in to it.
 */

/** GET — claim the next batch of messages for this phone. */
export async function GET(request: Request) {
  const device = await authenticateDevice(request);
  if (!device.ok) return NextResponse.json({ ok: false, error: device.error }, { status: 401 });

  try {
    const messages = await claimSms(device.clinicId, device.deviceId);
    // Recorded even when the batch is empty: a phone that polls and finds nothing is still a
    // healthy phone, and the settings screen needs to be able to say so.
    await touchDevice(device.deviceId);

    return NextResponse.json({
      ok: true,
      messages: messages.map((m) => ({ id: m.id, to: m.to, text: m.text })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read the queue";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** POST — report which of the claimed messages actually went out. */
export async function POST(request: Request) {
  const device = await authenticateDevice(request);
  if (!device.ok) return NextResponse.json({ ok: false, error: device.error }, { status: 401 });

  try {
    const body = (await request.json().catch(() => ({}))) as { results?: SmsAck[] };
    const results = Array.isArray(body.results) ? body.results : [];
    if (results.length === 0) return NextResponse.json({ ok: true, sent: 0, failed: 0, requeued: 0 });

    const outcome = await ackSms(device.clinicId, device.deviceId, results);
    await touchDevice(device.deviceId, outcome.sent > 0 ? { lastSentAt: new Date().toISOString() } : {});

    return NextResponse.json({ ok: true, ...outcome });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not record the results";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
