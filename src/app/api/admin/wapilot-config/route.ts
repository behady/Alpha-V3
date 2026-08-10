import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { clearWapilotConfigCache, loadWapilotConfig } from "@/lib/wapilotConfig";
import {
  CLINIC_SECRETS_COLLECTION,
  WAPILOT_SECRET_FIELD,
  type WapilotConfigStatus,
} from "@/types/wapilot";

/**
 * A clinic's own WhatsApp connection.
 *
 * This route used to read and write ONE platform-wide document. Since it is reachable by any
 * clinic Admin, that meant every clinic Admin could read whether the shared token was set, point
 * the whole platform's WhatsApp at their own gateway instance, or break messaging for every other
 * clinic by saving bad credentials. Now everything is scoped to the caller's own clinic and
 * stored in `clinic_secrets/{clinicId}`, which no client can read at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const secretDocRef = (clinicId: string) =>
  adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(clinicId);

/** Never returns the token itself — only whether one is stored. */
function statusFromStored(data: Record<string, unknown> | undefined): WapilotConfigStatus | null {
  if (!data) return null;
  const instanceId = typeof data.instanceId === "string" ? data.instanceId.trim() : "";
  const tokenSet = typeof data.apiToken === "string" && data.apiToken.trim().length > 0;
  if (!instanceId || !tokenSet) return null;

  const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    configured: true,
    source: "clinic",
    instanceId,
    tokenSet: true,
    apiBaseUrl: opt(data.apiBaseUrl),
    sendPath: opt(data.sendPath),
    sendDocumentPath: opt(data.sendDocumentPath),
    connectedPhoneHint: opt(data.connectedPhoneHint),
    updatedAt: opt(data.updatedAt),
  };
}

export async function GET(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid);
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }

    const snap = await secretDocRef(clinicId).get();
    const own = statusFromStored(
      snap.exists ? (snap.data()?.[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined) : undefined
    );
    if (own) return NextResponse.json({ ok: true, ...own });

    // No connection of its own. Say plainly whether a shared platform number is carrying this
    // clinic's messages, because "configured" and "configured as you" are different answers and
    // the clinic owner needs to know which one applies to them.
    const live = await loadWapilotConfig(clinicId, true);
    if (live.source === "platform" && live.instanceId && live.token) {
      return NextResponse.json({
        ok: true,
        configured: true,
        source: "platform",
        instanceId: live.instanceId,
        tokenSet: true,
        apiBaseUrl: live.apiRoot,
        sendPath: live.sendPathTemplate,
        sendDocumentPath: live.sendDocumentPathTemplate,
      } satisfies WapilotConfigStatus & { ok: true });
    }

    return NextResponse.json({
      ok: true,
      configured: false,
      source: "none",
      instanceId: "",
      tokenSet: false,
    } satisfies WapilotConfigStatus & { ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load WhatsApp connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid);
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      instanceId?: string;
      apiToken?: string;
      apiBaseUrl?: string;
      sendPath?: string;
      sendDocumentPath?: string;
      connectedPhoneHint?: string;
    };

    const instanceId = typeof body.instanceId === "string" ? body.instanceId.trim() : "";
    if (!instanceId) {
      return NextResponse.json({ ok: false, error: "Instance ID is required" }, { status: 400 });
    }

    const ref = secretDocRef(clinicId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists
      ? ((existingSnap.data()?.[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined) ?? {})
      : {};

    const existingToken = typeof existing.apiToken === "string" ? existing.apiToken.trim() : "";
    // An empty token field means "leave the stored one alone" — the UI never shows it back, so
    // re-saving any other field must not wipe the credential.
    const newToken =
      typeof body.apiToken === "string" && body.apiToken.trim() ? body.apiToken.trim() : existingToken;

    if (!newToken) {
      return NextResponse.json(
        { ok: false, error: "API token is required on first save" },
        { status: 400 }
      );
    }

    const optionalString = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const hadSecret = Object.keys(existing).length > 0;

    const wapilot: Record<string, unknown> = {
      instanceId,
      apiToken: newToken,
      updatedAt: new Date().toISOString(),
      updatedBy: authz.uid,
    };

    const assign = (key: string, value: string | undefined) => {
      if (value) wapilot[key] = value;
      else if (hadSecret) wapilot[key] = FieldValue.delete();
    };

    assign("apiBaseUrl", optionalString(body.apiBaseUrl));
    assign("sendPath", optionalString(body.sendPath));
    assign("sendDocumentPath", optionalString(body.sendDocumentPath));
    assign("connectedPhoneHint", optionalString(body.connectedPhoneHint));

    // Merged at the nested-field level so other secrets in this document are untouched.
    await ref.set({ [WAPILOT_SECRET_FIELD]: wapilot }, { merge: true });
    clearWapilotConfigCache(clinicId);

    return NextResponse.json({
      ok: true,
      configured: true,
      source: "clinic",
      instanceId,
      tokenSet: true,
    } satisfies WapilotConfigStatus & { ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save WhatsApp connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
