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
