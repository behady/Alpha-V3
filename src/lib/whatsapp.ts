import { normalizeToE164WithCountryCode } from "@/lib/phoneNumber";
import { loadWhatsAppConfig, whatsappConfigErrorMessage } from "@/lib/whatsappCloudConfig";
import { GRAPH_API_VERSION, type WhatsAppCloudConfig } from "@/types/whatsappCloud";

/**
 * Meta WhatsApp Cloud API sender.
 *
 * Replaces the previous Wapilot gateway. Two rules from Meta shape every call site:
 *
 *  1. Business-initiated messages MUST use a pre-approved template. Free-form text is only
 *     delivered inside the 24-hour customer service window that opens when the patient messages
 *     the clinic. Sending text outside that window fails with code 131047 — so reminders and
 *     other outbound-first messages need sendWhatsAppTemplate(), not sendWhatsAppText().
 *  2. Credentials are per clinic (each tenant connects its own number), so every send takes an
 *     optional clinicId. Omitting it falls back to the shared env number — fine for testing,
 *     wrong for production traffic.
 */

type WhatsAppSendArgs = {
  to: string;
  text: string;
  /** Which clinic is sending. Falls back to the shared env number when omitted. */
  clinicId?: string | null;
};

type WhatsAppTemplateArgs = {
  to: string;
  templateName: string;
  /** Meta language code, e.g. "en_US" or "ar". Must match the approved template exactly. */
  languageCode?: string;
  /** Ordered {{1}}, {{2}} … substitutions for the template body. */
  bodyParams?: string[];
  clinicId?: string | null;
};

type WhatsAppPdfSendArgs = {
  to: string;
  fileUrl?: string;
  pdfBytes?: Uint8Array;
  filename?: string;
  caption?: string;
  clinicId?: string | null;
};

/** Normalize to E.164-style string (leading +). Used by callers that store/display numbers. */
export function normalizeToE164(raw: string): string {
  return normalizeToE164WithCountryCode(raw);
}

/** International number as digits only (no +) — the format Meta's `to` field expects. */
export function normalizeToInternationalDigits(raw: string): string {
  const e164 = normalizeToE164(raw);
  return e164.replace(/^\+/, "").replace(/\D/g, "");
}

function assertReady(config: WhatsAppCloudConfig): void {
  if (!config.phoneNumberId || !config.accessToken) {
    throw new Error(whatsappConfigErrorMessage(config));
  }
}

function graphUrl(config: WhatsAppCloudConfig, path: string): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${config.phoneNumberId}/${path}`;
}

/**
 * Turn Meta's error envelope into something a clinic admin can act on. The raw messages are
 * written for developers ("Re-engagement message") and don't say what to actually do.
 */
function explainMetaError(status: number, payload: unknown): Error {
  const err = (payload as { error?: Record<string, unknown> })?.error;
  const code = typeof err?.code === "number" ? err.code : undefined;
  const raw = typeof err?.message === "string" ? err.message : `HTTP ${status}`;

  const guidance: Record<number, string> = {
    131030:
      "Recipient is not in the test number's allowed list. Add it under WhatsApp → API Setup in the Meta console (test numbers allow up to 5 recipients).",
    131047:
      "The 24-hour customer service window has closed for this contact. Send an approved template instead of free-form text.",
    131026:
      "Message undeliverable — the recipient may not have WhatsApp, or the number is wrong.",
    132000: "Template parameter count doesn't match the approved template.",
    132001: "That template doesn't exist, or isn't approved for this language yet.",
    133010: "This phone number isn't registered on the Cloud API yet.",
    190: "The access token is invalid or expired. Console tokens last ~24 hours — generate a System User token for anything permanent.",
    100: "Meta rejected a parameter. Check the phone number format (digits only, with country code, no +).",
    368: "Temporarily blocked for policy violations.",
    80007: "Rate limit reached. Slow down sending and retry.",
  };

  const hint = code !== undefined ? guidance[code] : undefined;
  const detail = hint ? `${hint} (Meta code ${code}: ${raw})` : `${raw}${code ? ` (code ${code})` : ""}`;
  const error = new Error(`WhatsApp send failed: ${detail}`);
  (error as Error & { metaCode?: number }).metaCode = code;
  return error;
}

async function postToGraph(config: WhatsAppCloudConfig, body: Record<string, unknown>) {
  const res = await fetch(graphUrl(config, "messages"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw explainMetaError(res.status, payload);
  return payload;
}

function requireDigits(to: string): string {
  const digits = normalizeToInternationalDigits(to);
  if (!digits) throw new Error("Invalid destination phone");
  return digits;
}

/**
 * Free-form text. Only delivered inside the 24-hour customer service window — use
 * sendWhatsAppTemplate() for anything the clinic initiates.
 */
export async function sendWhatsAppText({ to, text, clinicId }: WhatsAppSendArgs) {
  const config = await loadWhatsAppConfig(clinicId);
  assertReady(config);

  return postToGraph(config, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: requireDigits(to),
    type: "text",
    text: { preview_url: false, body: text },
  });
}

/** Backwards-compatible alias — existing call sites still import `sendWhatsApp`. */
export const sendWhatsApp = sendWhatsAppText;

/**
 * Send an approved message template. This is the only way to open a conversation the patient
 * didn't start, so appointment reminders and payment notices must go through here.
 */
export async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode = "en_US",
  bodyParams = [],
  clinicId,
}: WhatsAppTemplateArgs) {
  const config = await loadWhatsAppConfig(clinicId);
  assertReady(config);

  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })) }]
    : undefined;

  return postToGraph(config, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: requireDigits(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  });
}

/**
 * Upload bytes to Meta and return a media ID.
 * The messages endpoint can't take raw bytes, so in-memory PDFs (generated prescriptions, lab
 * orders) have to be uploaded first and then referenced by ID.
 */
async function uploadMedia(
  config: WhatsAppCloudConfig,
  bytes: Uint8Array,
  filename: string,
  mimeType = "application/pdf"
): Promise<string> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mimeType);
  form.set("file", new Blob([arrayBuffer], { type: mimeType }), filename);

  const res = await fetch(graphUrl(config, "media"), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}` },
    body: form,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw explainMetaError(res.status, payload);

  const id = (payload as { id?: string }).id;
  if (!id) throw new Error("WhatsApp media upload succeeded but returned no media ID");
  return id;
}

/**
 * Send a PDF as a document. Accepts either raw bytes (uploaded first) or a public URL.
 * Note Meta must be able to fetch a `link` itself — signed URLs that expire quickly, or anything
 * behind auth, will fail on their side rather than ours.
 */
export async function sendWhatsAppPdfFromUrl({
  to,
  fileUrl,
  pdfBytes,
  filename,
  caption,
  clinicId,
}: WhatsAppPdfSendArgs) {
  const config = await loadWhatsAppConfig(clinicId);
  assertReady(config);

  const digits = requireDigits(to);
  const safeFilename = (filename || "document.pdf").trim() || "document.pdf";
  const captionText = caption || "";

  let documentPayload: Record<string, unknown>;

  if (pdfBytes && pdfBytes.length > 0) {
    const mediaId = await uploadMedia(config, pdfBytes, safeFilename);
    documentPayload = { id: mediaId, filename: safeFilename };
  } else {
    const trimmedUrl = String(fileUrl || "").trim();
    if (!trimmedUrl) throw new Error("PDF content is missing");
    documentPayload = { link: trimmedUrl, filename: safeFilename };
  }

  if (captionText) documentPayload.caption = captionText;

  return postToGraph(config, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digits,
    type: "document",
    document: documentPayload,
  });
}
