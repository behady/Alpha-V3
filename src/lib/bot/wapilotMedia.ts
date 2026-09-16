import { loadWapilotConfig } from "@/lib/wapilotConfig";

/**
 * The voice note or photo inside a gateway webhook, and the bytes behind it.
 *
 * The official Meta channel hands out a media id to be exchanged for a short-lived URL. The
 * Wapilot gateway does neither reliably: depending on how the instance is configured it posts the
 * file inline as base64, or a URL to fetch, under one of several field names. None of it is
 * documented anywhere we control — the same reason `candidateMessages` in the inbound route lists
 * every wrapper rather than assuming one. So this reads defensively and reports WHY it found
 * nothing, because "the gateway sent no media" and "the gateway sent media we could not read" are
 * the same silence from outside, and telling them apart is what took a real phone last time.
 *
 * Until this existed, a patient on a Wapilot clinic who sent a voice note got no reply at all:
 * the message carried no text, so the route recorded "no_message" and stopped.
 */

/** WhatsApp voice notes and phone photos are small; past this it is not a message to act on. */
const MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;

export type InboundMedia = {
  kind: "audio" | "image";
  mime: string;
  /** Exactly one of these is set. */
  url?: string;
  base64?: string;
  /** For the flight recorder, so a wrong transcript traces back to its recording. */
  ref: string;
};

export type MediaBytes = { ok: true; bytes: Buffer; mime: string } | { ok: false; reason: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function obj(v: unknown): Record<string, any> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

/**
 * Audio or image, from the mime type when there is one and the gateway's own type word otherwise.
 *
 * "ptt" is a push-to-talk voice note — the shape most patients actually send, and the one a list
 * written from the Meta vocabulary alone would miss.
 */
function classify(mime: string, type: string): "audio" | "image" | null {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";

  const t = type.toLowerCase();
  if (t === "ptt" || t === "audio" || t === "voice") return "audio";
  if (t === "image" || t === "photo" || t === "sticker") return "image";
  return null;
}

/** A base64 payload, whether or not it arrived wearing a `data:` prefix. */
function base64Body(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  // `[\s\S]` rather than the `s` flag: the compile target predates it.
  const dataUri = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(s);
  if (dataUri) return dataUri[2] ? dataUri[3] : "";
  // A long run of base64 characters and nothing else. The length floor keeps short words like a
  // message body of "ok" from being mistaken for a tiny file.
  return s.length > 512 && /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(s) ? s : "";
}

/**
 * Find a voice note or photo among the wrappers the inbound route already unpacked.
 *
 * Takes the same candidate list rather than the raw body, so a gateway wrapper added there is
 * understood here too without a second list to keep in step.
 */
export function extractInboundMedia(candidates: Record<string, any>[]): InboundMedia | null {
  /*
   * The declaration and the file can sit in different wrappers — `payload` naming the type while
   * `payload._data` holds the bytes is an ordinary WAHA shape. So every candidate is examined
   * before giving up, rather than the first one that mentions a type deciding the answer.
   */
  let declared: InboundMedia | null = null;

  for (const m of candidates) {
    const media = obj(m.media) || obj(m._data?.media) || null;

    const mime = str(m.mimetype) || str(m.mimeType) || str(media?.mimetype) || str(media?.mimeType) || str(m._data?.mimetype);
    const type = str(m.type) || str(m._data?.type);
    const kind = classify(mime, type);
    if (!kind) continue;

    const url = str(media?.url) || str(m.mediaUrl) || str(m.media_url) || str(m.fileUrl) || str(m.downloadUrl);
    const inline = base64Body(str(media?.data) || str(m.data) || str(m.base64) || str(m.body));
    const ref = str(m.id) || str(m._data?.id?._serialized) || str(m.messageId) || "wapilot_media";

    if (url) return { kind, mime, url, ref };
    if (inline) return { kind, mime, base64: inline, ref };
    // Remembered, not returned: an instance with media download switched off says "image" and
    // sends no file. Reporting that as "this was a photo we could not fetch" is what lets the
    // patient still be answered — and puts the reason somewhere a person can read it — instead
    // of the whole message being dropped as if it had never arrived.
    if (!declared) declared = { kind, mime, ref };
  }

  return declared;
}

/** Loopback, link-local and RFC1918 literals — a webhook payload must not be able to probe these. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * The bytes, however they arrived.
 *
 * The gateway's API token is attached ONLY when the URL is on the gateway's own host. The URL
 * comes out of a webhook body, and a token that follows it anywhere would be a credential handed
 * to whatever host that body names.
 */
export async function fetchInboundMediaBytes(clinicId: string, media: InboundMedia): Promise<MediaBytes> {
  if (media.base64) {
    const bytes = Buffer.from(media.base64, "base64");
    if (!bytes.length) return { ok: false, reason: "media_empty" };
    if (bytes.length > MAX_BYTES) return { ok: false, reason: "media_too_large" };
    return { ok: true, bytes, mime: media.mime };
  }
  if (!media.url) return { ok: false, reason: "no_media_source" };

  let target: URL;
  try {
    target = new URL(media.url);
  } catch {
    return { ok: false, reason: "media_url_invalid" };
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return { ok: false, reason: "media_url_scheme" };
  if (isPrivateHost(target.hostname)) return { ok: false, reason: "media_url_private" };

  const headers: Record<string, string> = {};
  try {
    const config = await loadWapilotConfig(clinicId);
    const root = config.apiRoot ? new URL(config.apiRoot) : null;
    if (config.token && root && root.hostname.toLowerCase() === target.hostname.toLowerCase()) {
      headers.Authorization = `Bearer ${config.token}`;
    }
  } catch {
    // An unreadable config only means no token is attached; a public media URL still works.
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), { headers, signal: controller.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, reason: `media_download_${res.status}` };

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return { ok: false, reason: "media_too_large" };

    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) return { ok: false, reason: "media_empty" };
    // Checked again after reading: a server may omit content-length or understate it.
    if (bytes.length > MAX_BYTES) return { ok: false, reason: "media_too_large" };

    const mime = media.mime || (res.headers.get("content-type") || "").split(";")[0].trim();
    return { ok: true, bytes, mime };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === "AbortError" ? "media_timeout" : "media_download_failed" };
  } finally {
    clearTimeout(timer);
  }
}
