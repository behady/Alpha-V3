import { randomUUID } from "node:crypto";
import { adminBucket } from "@/lib/firebaseAdmin";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";
import { conversationKey } from "./conversation";

/**
 * A photo, voice note or file a patient sent, kept where staff can open it.
 *
 * Meta does not push the bytes in the webhook — only a media id. The id is good for thirty days,
 * and the download URL it resolves to for five minutes. A swollen face photographed at 1am is
 * exactly the message a dentist opens two days later, so the bytes are fetched as soon as the
 * message lands and copied into the clinic's own bucket. What the thread stores is a download
 * URL of the kind every other <img> in the app renders from.
 *
 * The thread line is written first, text-only, in the webhook's synchronous path; this runs in
 * the background and attaches the file to it afterwards. A failure here leaves the "[image]"
 * placeholder in place — the message is still seen, just without its picture.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

/** Meta's own ceiling for images and audio is 16MB; documents can be 100MB, which is not a chat. */
const MAX_BYTES = 20 * 1024 * 1024;

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

function extFor(mime: string): string {
  const clean = mime.split(";")[0].trim().toLowerCase();
  if (EXT_FOR_MIME[clean]) return EXT_FOR_MIME[clean];
  const sub = clean.split("/")[1] || "bin";
  return sub.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
}

/** Download one Meta media object. Returns null (never throws) when anything about it fails. */
async function fetchMetaMedia(
  token: string,
  mediaId: string
): Promise<{ bytes: Buffer; mime: string } | null> {
  const metaRes = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = (await metaRes.json().catch(() => null)) as { url?: string; mime_type?: string; file_size?: number } | null;
  if (!metaRes.ok || !meta?.url) return null;
  if (typeof meta.file_size === "number" && meta.file_size > MAX_BYTES) return null;

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) return null;
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  return { bytes, mime: meta.mime_type || fileRes.headers.get("content-type") || "application/octet-stream" };
}

/**
 * Copy the patient's media into the clinic's bucket and attach it to its thread line.
 *
 * `lineId` is the thread document written for this message; the URL goes onto it so the bubble
 * that already shows "[image]" fills in with the picture when the download lands.
 */
export async function attachInboundMedia(args: {
  clinicId: string;
  address: string;
  lineId: string;
  mediaId: string;
  messageId: string;
  /** Meta's declared type, used only when the download does not say. */
  mimeHint?: string;
}): Promise<void> {
  const config = await loadMetaWhatsappConfig(args.clinicId);
  if (!config) return;

  const got = await fetchMetaMedia(config.token, args.mediaId);
  if (!got) return;
  const mime = got.mime || args.mimeHint || "application/octet-stream";

  const key = conversationKey(args.address);
  const safeId = (args.messageId || args.mediaId).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  const path = `clinics/${args.clinicId}/whatsapp_media/${key}/${safeId}.${extFor(mime)}`;

  // The same download-URL shape the browser SDK's getDownloadURL() produces. It carries its own
  // token, so it renders in an <img> without consulting Storage rules — which is how every other
  // stored picture in the app is served (see storage.rules).
  const bucket = adminBucket();
  const token = randomUUID();
  await bucket.file(path).save(got.bytes, {
    resumable: false,
    metadata: { contentType: mime, metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

  await adminClinicDoc(args.clinicId, "whatsapp_conversations", key)
    .collection("messages")
    .doc(args.lineId)
    .set({ mediaUrl: url, mime, mediaBytes: got.bytes.length }, { merge: true });
}
