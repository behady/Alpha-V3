import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { conversationKey, markHumanActive } from "@/lib/bot/conversation";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import {
  followupTemplateText,
  loadMetaWhatsappConfig,
  sendMetaWhatsappMedia,
  type MetaMediaKind,
} from "@/lib/metaWhatsapp";
import { sendWhatsAppPdfFromUrl } from "@/lib/whatsapp";
import { recordThreadMessage } from "@/lib/bot/thread";
import { clinicDisplayName } from "@/lib/sms/events";

export const runtime = "nodejs";

/**
 * A person answering a patient, from the clinic's own WhatsApp number.
 *
 * This is the other half of the handoff. The bot raises a flag and says "someone will contact
 * you"; this is how that someone does it without leaving the app — and, on the official channel,
 * it is the ONLY way: the clinic's number lives on Meta's servers, not in a phone, so a
 * receptionist cannot open WhatsApp and type. Replying here also tells the bot to stand down for
 * an hour, so it stops answering the patient's next message over the top of the human.
 *
 * Free-form text on the official channel only delivers inside 24 hours of the patient's last
 * message. Handoffs are raised BY a patient message, so a same-day reply is always in-window;
 * the inbox warns when a row is old enough for that to matter.
 */
async function captureStaffAnswer(clinicId: string, phone: string, answer: string, staffName?: string): Promise<void> {
  const conv = adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(phone));
  const inbound = await conv.collection("messages").where("direction", "==", "in").orderBy("at", "desc").limit(1).get();
  const question = String(inbound.docs[0]?.data()?.text || "").trim();
  if (question.length < 8 || /^\d+$/.test(question) || question.startsWith("[")) return;
  // The same question answered twice by staff is one lesson, not two.
  const dup = await adminClinicCollection(clinicId, "bot_knowledge").where("question", "==", question).limit(1).get();
  if (!dup.empty) return;
  await adminClinicCollection(clinicId, "bot_knowledge").add({
    question: question.slice(0, 300),
    answer: answer.slice(0, 1000),
    status: "pending",
    source: "staff",
    staffName: staffName || null,
    phone,
    atMs: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function POST(request: Request) {
  const requestedClinicId = await request
    .clone()
    .json()
    .then((b) => (typeof b?.clinicId === "string" ? b.clinicId.trim() : ""))
    .catch(() => "");

  const authz = await requireStaffUser(request, requestedClinicId || undefined);
  if (!authz.ok) return authz.response;

  const clinicId = requestedClinicId || (await resolveUserClinicId(authz.uid));
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic" }, { status: 400 });

  const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
  const clinic = clinicSnap.data();
  if (clinic && (clinic.status !== "Active" || (clinic.expiresAt && clinic.expiresAt.toDate() < new Date()))) {
    return NextResponse.json({ ok: false, error: "Subscription expired or suspended. Read-only mode active." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    text?: string;
    patientId?: string;
    patientName?: string;
    /**
     * "followup": send the pre-approved re-engagement template instead of free text. The only
     * thing that delivers on the official channel once 24 hours have passed since the patient's
     * last message; its whole job is to make them write back, which re-opens the window.
     */
    template?: string;
    /**
     * A file the clinic is sending: already uploaded to the clinic's Storage folder by the
     * browser, so what arrives here is a download URL Meta can fetch. `text` becomes the caption.
     */
    media?: { url?: string; mime?: string; kind?: string; filename?: string };
  };

  const phone = normalizeToE164AssumingCountry(String(body.phone || ""));
  if (!phone) return NextResponse.json({ ok: false, error: "A valid phone number is required" }, { status: 400 });

  const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
  const patientName = typeof body.patientName === "string" ? body.patientName.trim() : "";
  const isTemplate = body.template === "followup";

  const media = body.media && typeof body.media === "object" ? body.media : null;
  const mediaKind = media?.kind as MetaMediaKind | undefined;
  const mediaUrl = String(media?.url || "").trim();
  const isMedia = !!media && !!mediaUrl;
  if (isMedia) {
    if (!mediaKind || !["image", "video", "audio", "document"].includes(mediaKind)) {
      return NextResponse.json({ ok: false, error: "Unsupported file kind" }, { status: 400 });
    }
    // Only files the app itself stored. Meta fetches the link server-side, so an arbitrary URL
    // here would make the clinic's number relay anything on the internet.
    if (!/^https:\/\/firebasestorage\.googleapis\.com\//.test(mediaUrl)) {
      return NextResponse.json({ ok: false, error: "File must be uploaded through the app" }, { status: 400 });
    }
  }

  let text = String(body.text || "").trim();
  let metaTemplate: { kind: string; params: string[] } | undefined;
  if (isTemplate) {
    // Template parameters cannot be empty; a nameless number gets a courteous generic.
    const who = patientName || "عميلنا العزيز";
    const clinicName = await clinicDisplayName(clinicId);
    text = followupTemplateText(who, clinicName);
    metaTemplate = { kind: "followup", params: [who, clinicName] };
  } else if (!isMedia) {
    if (!text) return NextResponse.json({ ok: false, error: "Message text is required" }, { status: 400 });
    if (text.length > 1500) return NextResponse.json({ ok: false, error: "Message is too long" }, { status: 400 });
  } else if (text.length > 1000) {
    return NextResponse.json({ ok: false, error: "Caption is too long" }, { status: 400 });
  }

  try {
    let delivery: { mode: "auto" | "queued" | "manual" };
    if (isMedia && mediaKind) {
      /*
       * Files do not pass through deliverWhatsAppMessage: that path composes text and queues
       * for the manual list, neither of which fits a photo. On the official channel Meta fetches
       * the link; the unofficial gateway can only forward documents, so a photo there is refused
       * rather than sent as a broken link.
       */
      const meta = await loadMetaWhatsappConfig(clinicId);
      let waMessageId: string | undefined;
      if (meta) {
        const r = await sendMetaWhatsappMedia({
          config: meta,
          to: phone,
          kind: mediaKind,
          link: mediaUrl,
          caption: text || undefined,
          filename: media?.filename || undefined,
        });
        if (!r.ok) throw new Error(r.error || "Send failed");
        waMessageId = r.messageId;
      } else if (mediaKind === "document") {
        await sendWhatsAppPdfFromUrl({
          clinicId,
          to: phone,
          fileUrl: mediaUrl,
          filename: media?.filename || "file.pdf",
          caption: text || undefined,
        });
      } else {
        return NextResponse.json(
          { ok: false, error: "This clinic's WhatsApp channel can only send documents, not photos or audio" },
          { status: 400 }
        );
      }
      await recordThreadMessage(clinicId, phone, {
        direction: "out",
        author: "staff",
        text,
        media: mediaKind,
        mediaUrl,
        mime: String(media?.mime || "").slice(0, 100) || undefined,
        uid: authz.uid,
        name: authz.name || undefined,
        kind: "staff_media",
        waMessageId,
        channel: meta ? "meta" : "wapilot",
      }).catch(() => {});
      delivery = { mode: "auto" };
    } else {
      delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text,
        audience: "patient",
        queue: {
          key: `reply_${phone.replace(/\D/g, "")}_${Date.now()}`,
          type: "staff_reply",
          ...(patientId ? { patientId } : {}),
          ...(patientName ? { patientName } : {}),
        },
        metaTemplate,
        // Credited by name in the chat thread, so the next person to open it knows who said what.
        thread: {
          author: "staff",
          uid: authz.uid,
          name: authz.name || undefined,
          kind: isTemplate ? "followup_template" : "staff_reply",
        },
      });
    }

    // The thread is a person's now; the bot stays out of it for an hour and the inbox row closes.
    await markHumanActive(clinicId, phone, authz.uid);

    // A conversation the clinic started has no inbound message to learn the patient from, so
    // the name comes from the picker instead — otherwise the new chat lists as a bare number.
    if (patientId || patientName) {
      await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(phone))
        .set({ ...(patientId ? { patientId } : {}), ...(patientName ? { patientName } : {}) }, { merge: true })
        .catch(() => {});
    }

    // Same audit trail the bot writes to, so the Messages history shows both voices in order.
    await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId: patientId || null,
      type: isMedia ? "staff_media" : isTemplate ? "staff_followup_template" : "staff_reply",
      message: isMedia ? `[${mediaKind}] ${text}`.trim() : text,
      status: delivery.mode === "auto" ? "success" : "queued",
      sentBy: authz.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    /*
     * What a person typed back is what the bot could not say. The patient's last message and
     * this reply are saved as a pending Q&A on the Bot tab; one tap of approval and the model
     * uses it next time. Templates, one-liners and replies to a number (a stray "3") are not
     * knowledge and are skipped.
     */
    if (!isTemplate && text.length >= 15) {
      await captureStaffAnswer(clinicId, phone, text, authz.name || undefined).catch(() => {});
    }

    // Keep the patient record's contact trail honest too, when there is a record to keep it on.
    if (patientId) {
      await adminClinicDoc(clinicId, "patients", patientId)
        .set({ lastContactedAt: FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, mode: delivery.mode });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
