import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { clearWapilotConfigCache, loadPlatformWapilotConfig } from "@/lib/wapilotConfig";
import { normalizeToE164, sendWapilotText } from "@/lib/whatsapp";
import { CLINIC_SECRETS_COLLECTION, PLATFORM_SECRETS_DOC, WAPILOT_SECRET_FIELD } from "@/types/wapilot";

/**
 * The platform's alerts line: Alpha's own Wapilot number, for owner and staff alerts at clinics
 * that have not connected a number of their own.
 *
 * Superadmin only, and stored in `clinic_secrets/platform` — the collection the rules deny to
 * every client — because the token sends messages as Alpha. The response never carries the token;
 * only whether one is set.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const docRef = () => adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(PLATFORM_SECRETS_DOC);

async function status() {
  const live = await loadPlatformWapilotConfig(true);
  let stored: Record<string, unknown> | undefined;
  try {
    const snap = await docRef().get();
    stored = snap.exists ? (snap.data()?.[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined) : undefined;
  } catch {
    stored = undefined;
  }
  return {
    configured: live.source === "platform" && Boolean(live.instanceId && live.token),
    instanceId: live.instanceId,
    tokenSet: Boolean(live.token),
    apiBaseUrl: live.apiRoot,
    // Whether the panel wrote it, or it still comes from the deployment's WAPILOT_* env.
    from: stored?.instanceId ? "panel" : live.instanceId ? "env" : "none",
    connectedPhoneHint: typeof stored?.connectedPhoneHint === "string" ? stored.connectedPhoneHint : "",
    updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : null,
    lastTest: stored?.lastTest ?? null,
  };
}

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;
  try {
    return NextResponse.json({ ok: true, ...(await status()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  const body = (await request.json().catch(() => ({}))) as {
    action?: "save" | "test" | "clear";
    instanceId?: string;
    apiToken?: string;
    apiBaseUrl?: string;
    connectedPhoneHint?: string;
    /** For a test: where to send. */
    to?: string;
    message?: string;
  };

  try {
    if (body.action === "clear") {
      await docRef().set({ [WAPILOT_SECRET_FIELD]: FieldValue.delete() }, { merge: true });
      clearWapilotConfigCache();
      return NextResponse.json({ ok: true, ...(await status()) });
    }

    if (body.action === "test") {
      const to = normalizeToE164(String(body.to || ""));
      if (!to || to.replace(/\D/g, "").length < 8) {
        return NextResponse.json({ ok: false, error: "Enter a valid phone number" }, { status: 400 });
      }
      const config = await loadPlatformWapilotConfig(true);
      if (config.source !== "platform" || !config.instanceId || !config.token) {
        return NextResponse.json({ ok: false, error: "The alerts line is not configured yet" }, { status: 400 });
      }
      const text =
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : "*Alpha Dental*\nThis is a test from the platform alerts line. If you can read it, owner alerts can reach this number.";
      try {
        await sendWapilotText(config, to, text);
        await docRef().set(
          { [WAPILOT_SECRET_FIELD]: { lastTest: { to, ok: true, at: new Date().toISOString() } } },
          { merge: true },
        );
        return NextResponse.json({ ok: true, sent: true });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await docRef()
          .set({ [WAPILOT_SECRET_FIELD]: { lastTest: { to, ok: false, error, at: new Date().toISOString() } } }, { merge: true })
          .catch(() => {});
        return NextResponse.json({ ok: false, error }, { status: 502 });
      }
    }

    // save
    const instanceId = String(body.instanceId || "").trim();
    const apiToken = String(body.apiToken || "").trim();
    if (!instanceId) return NextResponse.json({ ok: false, error: "Instance ID is required" }, { status: 400 });

    const patch: Record<string, unknown> = {
      instanceId,
      updatedAt: new Date().toISOString(),
      updatedBy: authz.uid,
    };
    // An empty token means "keep the one already stored", so the panel can change the instance
    // id without asking for the secret again.
    if (apiToken) patch.apiToken = apiToken;
    if (typeof body.apiBaseUrl === "string") patch.apiBaseUrl = body.apiBaseUrl.trim() || FieldValue.delete();
    if (typeof body.connectedPhoneHint === "string") patch.connectedPhoneHint = body.connectedPhoneHint.trim();

    const current = await docRef().get();
    const hadToken = Boolean((current.data()?.[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined)?.apiToken);
    if (!apiToken && !hadToken) return NextResponse.json({ ok: false, error: "API token is required" }, { status: 400 });

    await docRef().set({ [WAPILOT_SECRET_FIELD]: patch }, { merge: true });
    clearWapilotConfigCache();
    return NextResponse.json({ ok: true, ...(await status()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
