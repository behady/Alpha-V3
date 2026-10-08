import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser, requireSuperAdmin } from "@/lib/apiStaffAuth";
import { adminClinicCollection, resolveUserClinicId } from "@/lib/adminClinicDb";
import { clearWapilotConfigCache } from "@/lib/wapilotConfig";
import {
  PLATFORM_GATEWAY_INSTANCE_ID,
  gatewayApiRoot,
  gatewayConfigured,
  gatewayCreateInstance,
  gatewayDeleteInstance,
  gatewayInstanceIdForClinic,
  gatewayInstanceStatus,
  gatewayLogout,
  gatewayResume,
  inboundWebhookUrlForClinic,
  isAlphaGatewayCredentials,
} from "@/lib/waGateway";
import { CLINIC_SECRETS_COLLECTION, PLATFORM_SECRETS_DOC, WAPILOT_SECRET_FIELD } from "@/types/wapilot";

/**
 * Connect a WhatsApp number by scanning a QR — on Alpha's own gateway instead of Wapilot.
 *
 * The result is written into the SAME place the Wapilot form writes (`clinic_secrets/{id}.wapilot`)
 * in the same shape, with `apiBaseUrl` pointing at our gateway. Every sender in the app keeps
 * working unchanged; only the host the messages leave through differs.
 *
 * `target` is the clinic on screen (any clinic Admin, scoped as the other admin routes are), or
 * the literal `platform` for Alpha's alerts line (superadmin only; see lib/staffWhatsapp.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Target = { kind: "clinic"; clinicId: string; uid: string } | { kind: "platform"; uid: string };

async function resolveTarget(request: Request, requested: string | undefined, options?: { allowInactive?: boolean }): Promise<Target | NextResponse> {
  if (requested === PLATFORM_SECRETS_DOC) {
    const authz = await requireSuperAdmin(request);
    if (!authz.ok) return authz.response;
    return { kind: "platform", uid: authz.uid };
  }
  // Admin of the requested clinic — the one resolveUserClinicId returns — not of the default.
  const authz = await requireAdminUser(request, requested, options);
  if (!authz.ok) return authz.response;
  const clinicId = await resolveUserClinicId(authz.uid, requested);
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
  return { kind: "clinic", clinicId, uid: authz.uid };
}

/**
 * How many of the clinic's patients have ever written to its WhatsApp.
 *
 * The number that matters most for the number's safety: a message to someone who wrote first is
 * a reply, which WhatsApp never punishes; a message to someone who never did is cold outreach,
 * which is what gets numbers restricted. Two aggregate counts, so it costs the same for a clinic
 * of forty patients and one of four thousand.
 */
async function conversationWarmth(clinicId: string): Promise<{ written: number; patients: number } | null> {
  try {
    const [written, patients] = await Promise.all([
      adminClinicCollection(clinicId, "whatsapp_conversations").where("lastInboundAt", ">", 0).count().get(),
      adminClinicCollection(clinicId, "patients").count().get(),
    ]);
    return { written: written.data().count, patients: patients.data().count };
  } catch {
    return null;
  }
}

const docFor = (t: Target) => adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(t.kind === "platform" ? PLATFORM_SECRETS_DOC : t.clinicId);
const instanceFor = (t: Target) => (t.kind === "platform" ? PLATFORM_GATEWAY_INSTANCE_ID : gatewayInstanceIdForClinic(t.clinicId));

async function storedCredentials(t: Target): Promise<Record<string, unknown> | undefined> {
  const snap = await docFor(t).get();
  return snap.exists ? (snap.data()?.[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined) : undefined;
}

/**
 * What the Settings screen renders. `managed` means this target's credentials point at our
 * gateway — only then is the gateway asked for a state and a QR. A clinic on real Wapilot, or
 * on nothing, is `managed: false` and sees the manual form.
 */
async function describe(t: Target) {
  const available = gatewayConfigured();
  const stored = await storedCredentials(t);
  const managed = available && isAlphaGatewayCredentials(stored);
  if (!managed) return { ok: true, available, managed: false as const };

  const status = await gatewayInstanceStatus(instanceFor(t));
  if (!status) {
    // Credentials say "our gateway" but the gateway has no such instance — its data folder was
    // lost, or the record predates it. Report it so the screen offers a fresh connect.
    return { ok: true, available, managed: true as const, state: "missing" as const, phone: null, qr: null };
  }

  // Keep the display-only sender number current: the channel card and the click-to-send
  // fallback both read it, and the gateway is the one that actually knows it.
  const hint = status.phone ? `+${status.phone}` : "";
  if (hint && stored?.connectedPhoneHint !== hint) {
    await docFor(t)
      .set({ [WAPILOT_SECRET_FIELD]: { connectedPhoneHint: hint } }, { merge: true })
      .catch(() => {});
  }

  return {
    ok: true,
    available,
    managed: true as const,
    state: status.state,
    phone: status.phone,
    qr: status.state === "qr" ? status.qr : null,
    qrAt: status.qrAt,
    lastError: status.lastError,
    connectedAt: status.connectedAt,
    warmth: t.kind === "clinic" ? await conversationWarmth(t.clinicId) : null,
    // Clinic hours, the day's allowance and what is waiting — so the card can say "12 messages
    // waiting, sending resumes at 10:00" instead of leaving the desk to wonder.
    sending: status.sending ?? null,
  };
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("clinicId")?.trim() || undefined;
  const target = await resolveTarget(request, requested, { allowInactive: true });
  if (target instanceof NextResponse) return target;
  try {
    return NextResponse.json(await describe(target));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: string; action?: "connect" | "disconnect" | "relink" | "resume" };
  const target = await resolveTarget(request, typeof body.clinicId === "string" ? body.clinicId.trim() || undefined : undefined);
  if (target instanceof NextResponse) return target;

  if (!gatewayConfigured()) {
    return NextResponse.json({ ok: false, error: "The WhatsApp gateway is not configured on this deployment." }, { status: 400 });
  }

  try {
    const instanceId = instanceFor(target);

    if (body.action === "connect") {
      // A clinic already on real Wapilot keeps it unless it disconnects first: silently
      // replacing working credentials with an unscanned instance would stop its messages.
      const existing = await storedCredentials(target);
      if (existing?.instanceId && existing?.apiToken && !isAlphaGatewayCredentials(existing)) {
        return NextResponse.json(
          { ok: false, error: "This clinic is connected through Wapilot. Remove that connection first, then connect by QR." },
          { status: 409 },
        );
      }

      // The platform line only sends; replies to it are nobody's patient conversation.
      const webhookUrl = target.kind === "clinic" ? inboundWebhookUrlForClinic(target.clinicId) : "";
      const created = await gatewayCreateInstance({
        instanceId,
        webhookUrl,
        label: target.kind === "clinic" ? target.clinicId : "Alpha alerts line",
      });

      await docFor(target).set(
        {
          [WAPILOT_SECRET_FIELD]: {
            provider: "alpha",
            instanceId,
            apiToken: created.token,
            apiBaseUrl: gatewayApiRoot(),
            // Ours can show "typing…"; Wapilot could not, which is why the field exists.
            typingPath: "/{instanceId}/typing",
            updatedAt: new Date().toISOString(),
            updatedBy: target.uid,
          },
        },
        { merge: true },
      );
      clearWapilotConfigCache(target.kind === "clinic" ? target.clinicId : undefined);
      return NextResponse.json(await describe(target));
    }

    if (body.action === "relink") {
      // Same instance, fresh QR — for a phone that logged the device out.
      const existing = await storedCredentials(target);
      if (!isAlphaGatewayCredentials(existing)) return NextResponse.json({ ok: false, error: "Not connected through the gateway" }, { status: 400 });
      await gatewayLogout(instanceId);
      return NextResponse.json(await describe(target));
    }

    if (body.action === "resume") {
      // The gateway's emergency brake has tripped and a person has looked. Same session, no scan.
      const existing = await storedCredentials(target);
      if (!isAlphaGatewayCredentials(existing)) return NextResponse.json({ ok: false, error: "Not connected through the gateway" }, { status: 400 });
      await gatewayResume(instanceId);
      return NextResponse.json(await describe(target));
    }

    if (body.action === "disconnect") {
      const existing = await storedCredentials(target);
      if (existing && !isAlphaGatewayCredentials(existing)) {
        return NextResponse.json({ ok: false, error: "This connection is not on the gateway; remove it from the Wapilot form." }, { status: 400 });
      }
      await gatewayDeleteInstance(instanceId);
      await docFor(target).set({ [WAPILOT_SECRET_FIELD]: FieldValue.delete() }, { merge: true });
      clearWapilotConfigCache(target.kind === "clinic" ? target.clinicId : undefined);
      return NextResponse.json(await describe(target));
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 502 });
  }
}
