import { NextResponse } from "next/server";
import { redeemPairingCode } from "@/lib/sms/devices";

/**
 * A phone exchanging a pairing code for its long-lived device token.
 *
 * Deliberately unauthenticated: the phone has no credentials yet — that is the whole point of
 * pairing. The pairing code IS the credential, which is why it is eight characters, expires in ten
 * minutes, is single-use, and is consumed inside a transaction (see lib/sms/devices).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      code?: string;
      deviceName?: string;
      platform?: string;
    };

    const result = await redeemPairingCode(body.code || "", body.deviceName || "", body.platform || "android");
    if (!result.ok) {
      // 400, not 401: the code is wrong or spent, and the phone should show that to the person
      // holding it rather than silently retrying forever.
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      deviceId: result.deviceId,
      token: result.token,
      clinicId: result.clinicId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Pairing failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
