import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { respondToPatientMessage } from "@/lib/bot/respond";
import { applyInboundOptOut } from "@/lib/optOutInbound";
import { reportServerError } from "@/lib/server/reportError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound WhatsApp replies from the gateway, for the one purpose of honouring "STOP".
 *
 * Every automated patient message now ends with a line telling the patient how to stop them (see
 * lib/patientMessaging). That line is only worth printing if this endpoint exists: a patient who
 * asks to be left alone and is messaged anyway reports the number, and a reported number is how a
 * clinic loses WhatsApp contact with all of its patients at once.
 *
 * Two things happen to an inbound message, in this order and never the other way round:
 *   1. Is it a stop request? If so it is acted on and nothing else happens.
 *   2. Otherwise, if the clinic has switched the assistant on, it may be answered — see
 *      lib/bot/respond, which re-checks every gate itself and is silent unless enabled.
 *
 * The order is the safety property. Answering "إيقاف" with a menu is how a patient who asked to
 * be left alone becomes a patient who reports the number.
 *
 * ── Routing ──────────────────────────────────────────────────────────────────────────────────
 * The clinic comes from the URL, not the payload: `?clinicId=<id>&token=<secret>`. The gateway's
 * webhook field takes a full URL, so pointing each clinic's instance at its own one costs nothing
 * and removes the need to work out which of the payload's ids identifies the tenant. It also
 * means this keeps working if the gateway changes its body format.
 *
 * ── Payload ──────────────────────────────────────────────────────────────────────────────────
 * The body shape is read defensively, because the gateway's field names are not documented
 * anywhere we control. The first live test failed exactly here: Wapilot is WAHA-shaped and wraps
 * the message in `payload`, which the original reader did not look inside, so a real stop request
 * was parsed as "no message" and silently did nothing. Hence `candidateMessages` below — every
 * known wrapper is tried rather than one assumed chain — and hence the diagnostic trail, so the
 * next unknown shape is a document that can be read rather than a guess.
 */

/** `201012345678@c.us`, `+20 101 234 5678`, `201012345678` — all the same person. */
function cleanPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.split("@")[0].trim();
}

function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function obj(v: unknown): Record<string, any> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

/**
 * Every wrapper a gateway might put the message inside, outermost first.
 *
 * Listed rather than chained, because the chain was the bug: assuming `data` and falling back to
 * the root meant a body under `payload` matched nothing and reported "no message", which reads
 * identically to "no message arrived". Adding a name here is how this survives the next gateway.
 */
function candidateMessages(body: Record<string, any>): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const push = (v: unknown) => {
    const o = obj(v);
    if (o && !out.includes(o)) out.push(o);
  };

  // WAHA / Wapilot.
  push(body.payload);
  push(obj(body.payload)?.message);
  push(obj(body.payload)?._data);
  // Other flat gateways.
  push(body.data);
  push(obj(body.data)?.message);
  push(body.message);
  push(body.msg);
  // The message at the root.
  push(body);

  return out;
}

/**
 * Pull `{ phone, text }` out of whatever arrived.
 *
 * Returns null when nothing fits, which is the signal to record the body and move on.
 */
function extractReply(body: unknown): { phone: string; text: string } | null {
  const b = obj(body);
  if (!b) return null;

  // Meta Cloud API, which nests far enough to be worth its own branch.
  const metaMessage = obj(b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]);
  if (metaMessage) {
    const phone = cleanPhone(metaMessage.from);
    const text = firstString(obj(metaMessage.text)?.body, obj(metaMessage.button)?.text, metaMessage.body);
    if (phone && text) return { phone, text };
  }

  for (const m of candidateMessages(b)) {
    const phone = cleanPhone(
      firstString(m.from, m.chat_id, m.chatId, m.author, m.sender, m.participant, m.number)
    );
    const text = firstString(
      typeof m.body === "string" ? m.body : "",
      typeof m.text === "string" ? m.text : "",
      obj(m.text)?.body,
      typeof m.message === "string" ? m.message : "",
      m.caption
    );
    if (phone && text) return { phone, text };
  }

  return null;
}

/**
 * A message the clinic itself sent must never be read as the patient opting out.
 *
 * Gateways commonly post both directions to the same webhook, and the outgoing copy carries the
 * patient's number as the chat it belongs to. Without this, the opt-out footer on an outgoing
 * message could opt the patient out the moment it was sent.
 */
function isFromMe(body: unknown): boolean {
  const b = obj(body);
  if (!b) return false;
  for (const m of candidateMessages(b)) {
    if (m.fromMe === true || m.fromMe === "true" || m.from_me === true || m.from_me === "true") return true;
  }
  return false;
}

/**
 * Write down what arrived when it could not be read.
 *
 * `console.warn` goes to a log that is awkward to reach, which is why the first failure took a
 * round trip through a real phone to diagnose. A document in the clinic's own data can be read
 * directly the next time something does not fire. Only written on failure and capped in size, so
 * this is a diagnostic trail rather than a transcript of everyone's messages.
 */
async function recordUnparsed(clinicId: string, body: unknown, reason: string): Promise<void> {
  try {
    await adminClinicCollection(clinicId, "whatsapp_inbound_debug").add({
      reason,
      raw: JSON.stringify(body ?? null).slice(0, 4000),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    // Diagnostics must never be the reason a webhook fails.
  }
}

export async function POST(request: NextRequest) {
  const clinicId = request.nextUrl.searchParams.get("clinicId")?.trim() || "";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  const expected = process.env.WHATSAPP_INBOUND_TOKEN?.trim() || "";

  // Fails closed. Without a secret configured, anyone who found the URL could switch a clinic's
  // patients out of their own appointment reminders — reversible by staff, but only once someone
  // notices, and "the reminders stopped" is exactly the failure nobody reports quickly.
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);

    if (isFromMe(body)) return NextResponse.json({ ok: true, ignored: "outgoing" });

    const reply = extractReply(body);
    if (!reply) {
      // Not an error: most posts here are delivery receipts and presence updates. Recorded
      // anyway, because this is also what a changed payload format looks like, and the first
      // real stop request being silently unparsed is the failure that matters.
      await recordUnparsed(clinicId, body, "no_message");
      return NextResponse.json({ ok: true, ignored: "no_message" });
    }

    // Opt-out first, always. A patient asking to be left alone must never be answered by the
    // assistant instead — that is the single most effective way to turn a stop request into a
    // spam report, which is the outcome this whole endpoint exists to avoid.
    const result = await applyInboundOptOut({
      clinicId,
      phone: reply.phone,
      text: reply.text,
      channel: "whatsapp",
    });
    if (result.status !== "ignored") {
      return NextResponse.json({ ok: true, result: result.status });
    }

    // Not a stop request, so it may be a conversation. Off unless the clinic switched it on;
    // respondToPatientMessage re-checks every gate itself and stays silent by default.
    const bot = await respondToPatientMessage({
      clinicId,
      phone: reply.phone,
      text: reply.text,
    });

    return NextResponse.json({ ok: true, result: result.status, bot: bot.status });
  } catch (error) {
    reportServerError("[whatsapp-inbound] Failed to handle payload:", error);
    // Still 200: an error response makes the gateway redeliver, and redelivering a stop request
    // achieves nothing except another failed attempt.
    return NextResponse.json({ ok: true, error: "handled" });
  }
}

/**
 * Some gateways verify a webhook with a GET before they will save it, echoing a challenge
 * parameter. Answering that costs nothing and makes the URL paste-able into more dashboards.
 */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || request.nextUrl.searchParams.get("challenge");
  if (challenge) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  return NextResponse.json({ ok: true });
}
