import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET Request: Meta WhatsApp Cloud API Verification Handshake
 *
 * Meta sends a GET request with query parameters to verify the webhook endpoint.
 * - hub.mode: should equal 'subscribe'
 * - hub.verify_token: must match process.env.META_VERIFY_TOKEN
 * - hub.challenge: raw challenge string to return on success
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
    console.log("[WhatsApp Webhook] Handshake verification successful.");
    return new Response(challenge || "", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  console.warn("[WhatsApp Webhook] Handshake verification failed. Token or mode mismatch.");
  return new Response("Forbidden", { status: 403 });
}

/**
 * POST Request: Meta WhatsApp Cloud API Event Receiver
 *
 * Meta posts inbound messages, status updates, and delivery reports here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("[WhatsApp Webhook] Event Received:", JSON.stringify(body, null, 2));

    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) {
    console.error("[WhatsApp Webhook] Error parsing POST payload:", error);
    return new Response("Invalid payload", { status: 400 });
  }
}
