/**
 * Click-to-send WhatsApp, browser side.
 *
 * When the server reports that a message could not be sent automatically — no gateway configured,
 * or the clinic chose manual delivery — it hands back the finished text instead of failing. This
 * module turns that into an offer: a confirm dialog, then WhatsApp opens with the message already
 * typed and the staff member presses send.
 *
 * Two constraints shaped the design:
 *
 * 1. Browsers block window.open unless it happens during a real click. The sends that produce
 *    these messages are triggered deep inside async save flows, long after the click that started
 *    them. So the window is opened from the confirm dialog's own button, which IS a user gesture.
 *
 * 2. The functions that call this (sendPatientAppointmentWhatsApp and friends) run in dozens of
 *    places and have no access to React context. Rather than thread a callback through every call
 *    site, UIProvider registers one handler here at startup and everything routes through it.
 */

export type ManualWhatsAppMessage = {
  phone: string;
  text: string;
  /** Shown in the prompt so the user knows who they are about to message. */
  patientName?: string;
};

type ManualHandler = (message: ManualWhatsAppMessage) => void;

let handler: ManualHandler | null = null;

/** Called once by UIProvider. Later registrations replace earlier ones. */
export function registerWhatsAppManualHandler(fn: ManualHandler | null): void {
  handler = fn;
}

/**
 * Routes a manual message to the UI.
 *
 * Silently does nothing if no handler is registered — that only happens outside the dashboard
 * shell, where there is no dialog to show and nothing useful to do.
 */
export function handleManualWhatsApp(message: ManualWhatsAppMessage): void {
  if (!handler) return;
  handler(message);
}

/**
 * Opens WhatsApp with the message pre-filled.
 *
 * wa.me works with the desktop app, the web client and the phone, and needs a plain international
 * number with no plus sign or separators. Must be called from inside a click handler.
 */
export function openWhatsAppWithText(phone: string, text: string): void {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return;
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Reads an API response and, when it says the message needs a human, offers to open WhatsApp.
 * Anything else is left alone, so callers can pass every response through this unconditionally.
 */
export function handleWhatsAppApiResult(
  data: unknown,
  patientName?: string
): void {
  if (!data || typeof data !== "object") return;
  const d = data as { manual?: unknown; phone?: unknown; text?: unknown };
  if (d.manual !== true) return;
  const phone = typeof d.phone === "string" ? d.phone : "";
  const text = typeof d.text === "string" ? d.text : "";
  if (!phone || !text) return;
  handleManualWhatsApp({ phone, text, patientName });
}
