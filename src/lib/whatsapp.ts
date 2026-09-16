import { normalizeToE164WithCountryCode } from "@/lib/phoneNumber";
import { loadWapilotConfig, wapilotConfigErrorMessage } from "@/lib/wapilotConfig";
import type { WapilotConfig } from "@/types/wapilot";

/**
 * `clinicId` decides which WhatsApp number the message goes out from, and is required for that
 * reason: credentials are per clinic (see lib/wapilotConfig). Before, there was no such argument,
 * which is how every clinic on the platform ended up messaging its patients from one shared
 * number that any clinic Admin could change.
 */
type WhatsAppSendArgs = {
  clinicId: string;
  to: string;
  text: string;
};

type WhatsAppPdfSendArgs = {
  clinicId: string;
  to: string;
  fileUrl?: string;
  pdfBytes?: Uint8Array;
  filename?: string;
  caption?: string;
};

/** Normalize to E.164-style string (leading +). Used by callers that store/display numbers. */
export function normalizeToE164(raw: string): string {
  return normalizeToE164WithCountryCode(raw);
}

/** International number as digits only (no +). */
export function normalizeToInternationalDigits(raw: string): string {
  const e164 = normalizeToE164(raw);
  return e164.replace(/^\+/, "").replace(/\D/g, "");
}

function assertWapilotReady(config: WapilotConfig): void {
  if (!config.instanceId || !config.token) {
    throw new Error(wapilotConfigErrorMessage(config));
  }
}

/**
 * The typing indicator's whole budget. It is decoration in front of a real answer, so it gets a
 * fraction of the time a send would — a slow gateway must never hold up the reply behind it.
 */
const TYPING_TIMEOUT_MS = 3000;

function buildSendUrl(apiRoot: string, instanceId: string, template: string): string {
  const path = template
    .replace(/\{instanceId\}/g, encodeURIComponent(instanceId))
    .replace(/^\//, "");
  return `${apiRoot}/${path}`;
}

/**
 * Send plain text via [Wapilot](https://app.wapilot.net) REST API v2.
 *
 * Uses: `POST {WAPILOT_API_BASE_URL}/{instanceId}/send-message` with header `Token` and JSON body
 * `{ chat_id: "<countrycode+number>@c.us", text: "..." }`.
 *
 * Credentials: `clinic_secrets/{clinicId}.wapilot`, falling back to the shared platform number.
 */
/**
 * A destination that is already a WhatsApp chat id, not a phone number.
 *
 * `@lid` is WhatsApp's anonymised sender id: since their privacy rollout, an inbound message can
 * identify its sender ONLY as `172357054414966@lid`, with no phone anywhere in the payload. Such
 * an id must be used verbatim as the destination — it has no digits worth normalising, and
 * running it through the phone rules is what made the assistant compose a perfect reply and then
 * throw it away with "Invalid destination phone".
 */
export function isWhatsAppChatId(to: string): boolean {
  return /@(lid|c\.us|g\.us)$/i.test(String(to || "").trim());
}

export async function sendWhatsApp({ clinicId, to, text }: WhatsAppSendArgs) {
  const config = await loadWapilotConfig(clinicId);
  assertWapilotReady(config);
  const { instanceId, token, apiRoot, sendUrlOverride, sendPathTemplate } = config;

  let chatId: string;
  if (isWhatsAppChatId(to)) {
    // Verified live 2026-08-29: Wapilot accepts `<lid>@lid` as chat_id and delivers.
    chatId = to.trim();
  } else {
    const digits = normalizeToInternationalDigits(to);
    if (!digits) {
      throw new Error("Invalid destination phone");
    }
    chatId = `${digits}@c.us`;
  }

  const url = sendUrlOverride || buildSendUrl(apiRoot, instanceId, sendPathTemplate);

  const body = {
    chat_id: chatId,
    text,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Token: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Wapilot API failed (${res.status}): ${details}`);
  }

  return res.json().catch(() => ({}));
}

/**
 * "The clinic is typing…", on a gateway that can show it.
 *
 * Does nothing at all unless a typing path has been configured, and that is the normal state:
 * Wapilot has no such endpoint. Probed live 2026-09-16 — `send-message` and `send-file` resolve
 * and then check the instance, while typing, presence and seen answer NOT_FOUND on v1, v2 and v3.
 * A clinic pointing this at its own WAHA instance has `/api/startTyping` and can switch it on by
 * setting `typingPath` in its credentials.
 *
 * Purely cosmetic, so it is held to cosmetic rules: never throws, never delays a reply by more
 * than a moment, and a failure is not worth a log line. The one thing it must not do is become a
 * wasted round trip in front of every answer, which is why an unset path skips the request
 * entirely rather than attempting it and being refused.
 */
export function typingEndpoint(config: WapilotConfig): string | null {
  if (!config.token || !config.instanceId) return null;
  if (config.typingUrlOverride) return config.typingUrlOverride;
  if (!config.typingPathTemplate) return null;
  return buildSendUrl(config.apiRoot, config.instanceId, config.typingPathTemplate);
}

export async function sendWapilotTyping(clinicId: string, to: string): Promise<void> {
  try {
    const config = await loadWapilotConfig(clinicId);
    const url = typingEndpoint(config);
    if (!url) return;

    let chatId: string;
    if (isWhatsAppChatId(to)) {
      chatId = to.trim();
    } else {
      const digits = normalizeToInternationalDigits(to);
      if (!digits) return;
      chatId = `${digits}@c.us`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TYPING_TIMEOUT_MS);
    try {
      await fetch(url, {
        method: "POST",
        headers: { Token: config.token, "Content-Type": "application/json" },
        // Both spellings: Wapilot's own sends use `chat_id`, WAHA uses `chatId`. An extra field
        // is ignored by either, and guessing wrong would make this silently do nothing.
        body: JSON.stringify({ chat_id: chatId, chatId, session: config.instanceId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* cosmetic */
  }
}

/**
 * The gateway's id for a message it just accepted.
 *
 * This is the handle its later delivered/read events arrive under, so without it the ticks in the
 * chat screen can never move off "sent" on this channel — there is nothing to match an ack to.
 *
 * Read defensively for the same reason the inbound route is: the gateway publishes no response
 * schema, and the shape differs between whatsapp-web.js-style ids (`true_201…@c.us_3EB0…`) and a
 * plain `{ data: { id } }` envelope. An id that cannot be found is not an error — the message
 * was still delivered, the ticks simply stay where Meta's would if it had never answered.
 */
export function wapilotMessageId(response: unknown): string | undefined {
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): string | undefined => {
    if (depth > 4 || !node || typeof node !== "object" || seen.has(node)) return undefined;
    seen.add(node);
    const o = node as Record<string, unknown>;

    // `id` may itself be the object whatsapp-web.js serialises ids into.
    for (const key of ["_serialized", "id", "messageId", "message_id", "key", "msgId", "wamid"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v && typeof v === "object") {
        const nested = walk(v, depth + 1);
        if (nested) return nested;
      }
    }
    for (const key of ["data", "message", "result", "payload"]) {
      const nested = walk(o[key], depth + 1);
      if (nested) return nested;
    }
    return undefined;
  };

  return walk(response, 0);
}

/**
 * Best-effort: the phone number behind an anonymised `@lid` sender.
 *
 * Wapilot has the endpoint for this — `GET /{instanceId}/lids/{lid}` — but as of 2026-08-29 it
 * answers 500 ("Unexpected error while resolving LID") for every input, in both directions.
 * Probed live; not a guess. This wrapper exists so that the day their side starts working,
 * patients writing from behind a lid become identifiable again with no code change here —
 * and until then it fails quietly and quickly.
 *
 * Never throws. An unresolved lid is a normal state, not an error.
 */
export async function resolveLidToPhone(clinicId: string, lid: string): Promise<string> {
  try {
    const config = await loadWapilotConfig(clinicId);
    if (!config.instanceId || !config.token) return "";

    const bare = String(lid || "").replace(/@lid$/i, "").replace(/\D/g, "");
    if (!bare) return "";

    const res = await fetch(`${config.apiRoot}/${config.instanceId}/lids/${bare}`, {
      headers: { Token: config.token },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return "";

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) return "";
    // Field name unknown until their side works; accept the plausible spellings.
    const candidate = [data.pn, data.phone, data.phoneNumber, data.number, (data.data as any)?.pn]
      .map((v) => (typeof v === "string" ? v : ""))
      .find((v) => v.replace(/\D/g, "").length >= 10);
    return candidate ? candidate.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Send a PDF as a WhatsApp document by URL.
 * Default endpoint path is `/{instanceId}/send-file` and can be overridden with:
 * `WAPILOT_SEND_DOCUMENT_URL` or `WAPILOT_SEND_DOCUMENT_PATH`.
 */
export async function sendWhatsAppPdfFromUrl({
  clinicId,
  to,
  fileUrl,
  pdfBytes,
  filename,
  caption,
}: WhatsAppPdfSendArgs) {
  const config = await loadWapilotConfig(clinicId);
  assertWapilotReady(config);
  const { instanceId, token, apiRoot, sendDocumentUrlOverride, sendDocumentPathTemplate } = config;

  const digits = normalizeToInternationalDigits(to);
  if (!digits) {
    throw new Error("Invalid destination phone");
  }

  const url = sendDocumentUrlOverride || buildSendUrl(apiRoot, instanceId, sendDocumentPathTemplate);
  const safeFilename = (filename || "prescription.pdf").trim() || "prescription.pdf";
  const trimmedUrl = String(fileUrl || "").trim();
  const captionText = caption || "";
  const chatId = `${digits}@c.us`;

  // Many Wapilot-compatible endpoints require multipart/form-data with an actual file under `media`.
  if (pdfBytes && pdfBytes.length > 0) {
    const pdfArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("chatId", chatId);
    form.set("phone_number", digits);
    form.set("caption", captionText);
    form.set("filename", safeFilename);
    form.set("mimetype", "application/pdf");
    form.set("type", "document");
    form.set("media", new Blob([pdfArrayBuffer], { type: "application/pdf" }), safeFilename);
    if (trimmedUrl) {
      form.set("content", trimmedUrl);
      form.set("file_url", trimmedUrl);
      form.set("media_url", trimmedUrl);
    }

    const multipartRes = await fetch(url, {
      method: "POST",
      headers: {
        Token: token,
      },
      body: form,
    });

    if (multipartRes.ok) {
      return multipartRes.json().catch(() => ({}));
    }

    const multipartDetails = await multipartRes.text();
    throw new Error(`Wapilot document send failed (${multipartRes.status}): ${multipartDetails}`);
  }

  if (!trimmedUrl) {
    throw new Error("PDF content is missing");
  }

  const body = {
    chat_id: chatId,
    media: {
      url: trimmedUrl,
      filename: safeFilename,
      mimetype: "application/pdf",
    },
    media_url: trimmedUrl,
    content: trimmedUrl,
    file: trimmedUrl,
    filename: safeFilename,
    caption: captionText,
    mimetype: "application/pdf",
    type: "document",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Token: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) return res.json().catch(() => ({}));
  const details = await res.text();
  throw new Error(`Wapilot document send failed (${res.status}): ${details}`);
}
