import { adminDb } from "@/lib/firebaseAdmin";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { loadMetaWhatsappConfig, sendMetaWhatsappText, type MetaWhatsappConfig } from "@/lib/metaWhatsapp";
import { loadPlatformWapilotConfig, loadWapilotConfig } from "@/lib/wapilotConfig";
import { normalizeToE164, sendWapilotText } from "@/lib/whatsapp";
import type { WapilotConfig } from "@/types/wapilot";

/**
 * WhatsApp to the clinic's own people: owner alerts, staff alerts, the scheduled reports.
 *
 * A separate sender from the patient one on purpose. Patient messages carry an opt-out footer, a
 * flood ceiling, an outbox for the click-to-send clinics and a thread record; none of that applies
 * to a message the owner asked to receive about their own clinic. And the platform alerts line —
 * Alpha's own number, sold to clinics that have not connected one — must never be reachable from
 * a patient send path, so it is resolved here and nowhere else.
 *
 * Which number an alert leaves from, most specific first:
 *
 *   1. The clinic's official Meta number, if connected. Free: Meta does not bill a service
 *      message inside the 24-hour window, and outside it the text is dropped rather than charged
 *      — the settings page tells the owner to message the number once to open the window.
 *   2. The clinic's own Wapilot number, if connected.
 *   3. The platform alerts line, if the clinic holds the `ownerAlertsLine` add-on and the line is
 *      configured in the superadmin panel. Every message from it starts with the clinic's name,
 *      because one number serves many clinics.
 *   4. Nothing. The caller falls back to push and the bell, and says why on the settings page.
 *
 * A clinic whose own number is connected therefore never needs the add-on, which is the pricing
 * promise: "free once you connect your number".
 */

export type StaffGateway =
  | { kind: "meta"; config: MetaWhatsappConfig }
  | { kind: "wapilot"; config: WapilotConfig; platform: false }
  | { kind: "wapilot"; config: WapilotConfig; platform: true };

export type StaffGatewayReason = "no_gateway" | "platform_not_configured";

export async function resolveStaffGateway(
  clinicId: string,
): Promise<{ gateway: StaffGateway | null; reason?: StaffGatewayReason }> {
  try {
    const meta = await loadMetaWhatsappConfig(clinicId);
    if (meta) return { gateway: { kind: "meta", config: meta } };
  } catch {
    /* fall through to Wapilot */
  }
  try {
    const own = await loadWapilotConfig(clinicId);
    if (own.source === "clinic" && own.instanceId && own.token) {
      return { gateway: { kind: "wapilot", config: own, platform: false } };
    }
  } catch {
    /* fall through to the platform line */
  }
  if (await clinicHasFeature(clinicId, "ownerAlertsLine")) {
    const platform = await loadPlatformWapilotConfig();
    if (platform.source === "platform" && platform.instanceId && platform.token) {
      return { gateway: { kind: "wapilot", config: platform, platform: true } };
    }
    return { gateway: null, reason: "platform_not_configured" };
  }
  return { gateway: null, reason: "no_gateway" };
}

/** What the settings page shows beside the WhatsApp column. */
export type StaffWhatsappVia = "meta" | "wapilot" | "platform" | "none";

export async function staffWhatsappStatus(
  clinicId: string,
): Promise<{ via: StaffWhatsappVia; reason?: StaffGatewayReason }> {
  const { gateway, reason } = await resolveStaffGateway(clinicId);
  if (!gateway) return { via: "none", reason };
  if (gateway.kind === "meta") return { via: "meta" };
  return { via: gateway.platform ? "platform" : "wapilot" };
}

export type StaffSendResult =
  | { sent: true; via: Exclude<StaffWhatsappVia, "none"> }
  | { sent: false; reason: StaffGatewayReason | "invalid_phone" | "gateway_error"; error?: string };

async function clinicDisplayName(clinicId: string): Promise<string> {
  try {
    const snap = await adminDb().collection("clinics").doc(clinicId).get();
    return String(snap.data()?.name || "").trim();
  } catch {
    return "";
  }
}

/**
 * Send one staff message. Never throws: an alert is a courtesy about something that already
 * happened, and a dead gateway must not fail the action that raised it.
 */
export async function sendStaffWhatsApp(args: {
  clinicId: string;
  to: string;
  text: string;
  /** Skip the resolution when the caller already did it for a batch of recipients. */
  gateway?: StaffGateway | null;
}): Promise<StaffSendResult> {
  const to = normalizeToE164(args.to);
  if (!to || to.replace(/\D/g, "").length < 8) return { sent: false, reason: "invalid_phone" };

  let gateway = args.gateway;
  if (gateway === undefined) {
    const resolved = await resolveStaffGateway(args.clinicId);
    gateway = resolved.gateway;
    if (!gateway) return { sent: false, reason: resolved.reason || "no_gateway" };
  }
  if (!gateway) return { sent: false, reason: "no_gateway" };

  let text = args.text.trim();
  if (gateway.kind === "wapilot" && gateway.platform) {
    // One number, many clinics: the reader has to be told whose figures these are before the
    // first line, and a report that already opens with the clinic's name is not stamped twice.
    const name = await clinicDisplayName(args.clinicId);
    if (name && !text.startsWith(name) && !text.startsWith(`*${name}`)) text = `*${name}*\n${text}`;
  }

  try {
    if (gateway.kind === "meta") {
      const result = await sendMetaWhatsappText({ config: gateway.config, to, text });
      if (!result.ok) return { sent: false, reason: "gateway_error", error: result.error || "Meta refused" };
      return { sent: true, via: "meta" };
    }
    await sendWapilotText(gateway.config, to, text);
    return { sent: true, via: gateway.platform ? "platform" : "wapilot" };
  } catch (error) {
    return { sent: false, reason: "gateway_error", error: error instanceof Error ? error.message : String(error) };
  }
}
