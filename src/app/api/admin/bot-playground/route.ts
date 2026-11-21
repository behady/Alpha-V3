import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { respondToPatientMessage } from "@/lib/bot/respond";
import { playgroundChatId } from "@/lib/bot/conversation";
import { recordThreadMessage } from "@/lib/bot/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The brain may run its full 25 s; the pacing and a second bubble add a few more.
export const maxDuration = 120;

/**
 * Talk to your own bot without a phone.
 *
 * The same engine, the same settings, the same model and the same credits — only the WhatsApp
 * send, the staff notifications, the lead records and the handoff inbox are skipped. Each
 * staff member gets a private conversation keyed `play_<uid>`, hidden from the Chats page, and
 * can wipe it to start over. This is where coaching notes get tested before a patient sees them.
 */

/** A stable fake phone per user: a stranger to the clinic, so the new-patient path is exercised. */
function fakePhone(uid: string): string {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `+20100${String(h % 10_000_000).padStart(7, "0")}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: string; text?: string; reset?: boolean; proLayer?: "draft" };
  // Authorised against the clinic it will act on, not whichever one the account defaults to.
  const authz = await requireStaffUser(request, typeof body.clinicId === "string" ? body.clinicId : undefined);
  if (!authz.ok) return authz.response;
  try {
    const clinicId = await resolveUserClinicId(authz.uid, body.clinicId);
    const chatId = playgroundChatId(authz.uid);

    if (body.reset) {
      const ref = adminClinicDoc(clinicId, "whatsapp_conversations", chatId);
      const msgs = await ref.collection("messages").get();
      await Promise.all(msgs.docs.map((d) => d.ref.delete()));
      await ref.delete().catch(() => {});
      return NextResponse.json({ ok: true, reset: true });
    }

    const text = String(body.text || "").trim().slice(0, 1000);
    if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });

    // Into the private thread first, so sales mode sees its own history the way it would live.
    await recordThreadMessage(clinicId, chatId, { direction: "in", author: "patient", text, channel: "meta" }).catch(() => {});
    // "Use the draft layer": rehearse the rules the onboarding chat has drafted but not published.
    const out = await respondToPatientMessage({ clinicId, chatId, phone: fakePhone(authz.uid), text, dryRun: true, ...(body.proLayer === "draft" ? { proLayer: "draft" as const } : {}) });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
