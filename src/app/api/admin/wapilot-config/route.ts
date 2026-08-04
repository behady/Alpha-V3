import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clearWapilotConfigCache, loadWapilotConfig } from "@/lib/wapilotConfig";
import {
  WAPILOT_SETTINGS_DOC_REF,
  type WapilotConfigStatus,
} from "@/types/wapilot";

const getDocRef = () => adminDb()
  .collection(WAPILOT_SETTINGS_DOC_REF.collection)
  .doc(WAPILOT_SETTINGS_DOC_REF.docId);

function statusFromConfig(): WapilotConfigStatus {
  const envInstance = process.env.WAPILOT_INSTANCE_ID?.trim() ?? "";
  const envToken =
    process.env.WAPILOT_API_TOKEN?.trim() ||
    process.env.WAPILOT_ACCESS_TOKEN?.trim() ||
    "";

  return {
    configured: false,
    source: "none",
    instanceId: envInstance,
    tokenSet: Boolean(envToken),
    apiBaseUrl: process.env.WAPILOT_API_BASE_URL?.trim() || undefined,
    sendPath: process.env.WAPILOT_SEND_PATH?.trim() || undefined,
    sendDocumentPath: process.env.WAPILOT_SEND_DOCUMENT_PATH?.trim() || undefined,
  };
}

export async function GET(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
    const snap = await getDocRef().get();
    const base = statusFromConfig();

    if (snap.exists) {
      const d = snap.data() || {};
      const instanceId = typeof d.instanceId === "string" ? d.instanceId.trim() : "";
      const tokenSet = typeof d.apiToken === "string" && d.apiToken.trim().length > 0;

      if (instanceId && tokenSet) {
        return NextResponse.json({
          ok: true,
          configured: true,
          source: "firestore" as const,
          instanceId,
          tokenSet: true,
          apiBaseUrl: typeof d.apiBaseUrl === "string" ? d.apiBaseUrl : undefined,
          sendPath: typeof d.sendPath === "string" ? d.sendPath : undefined,
          sendDocumentPath:
            typeof d.sendDocumentPath === "string" ? d.sendDocumentPath : undefined,
          connectedPhoneHint:
            typeof d.connectedPhoneHint === "string" ? d.connectedPhoneHint : undefined,
          updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : undefined,
        });
      }
    }

    const live = await loadWapilotConfig(true);
    if (live.source === "env" && live.instanceId && live.token) {
      return NextResponse.json({
        ok: true,
        configured: true,
        source: "env",
        instanceId: live.instanceId,
        tokenSet: true,
        apiBaseUrl: live.apiRoot,
        sendPath: live.sendPathTemplate,
        sendDocumentPath: live.sendDocumentPathTemplate,
      });
    }

    return NextResponse.json({
      ok: true,
      ...base,
      configured: false,
      source: "none",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Wapilot config";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
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
      return NextResponse.json(
        { ok: false, error: "Instance ID is required" },
        { status: 400 }
      );
    }

    const existing = await getDocRef().get();
    const existingToken =
      existing.exists && typeof existing.data()?.apiToken === "string"
        ? String(existing.data()?.apiToken).trim()
        : "";

    const newToken =
      typeof body.apiToken === "string" && body.apiToken.trim()
        ? body.apiToken.trim()
        : existingToken;

    if (!newToken) {
      return NextResponse.json(
        { ok: false, error: "API token is required on first save" },
        { status: 400 }
      );
    }

    const patch: Record<string, unknown> = {
      instanceId,
      apiToken: newToken,
      updatedAt: new Date().toISOString(),
      updatedBy: authz.uid,
    };

    const optionalString = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;

    const apiBaseUrl = optionalString(body.apiBaseUrl);
    const sendPath = optionalString(body.sendPath);
    const sendDocumentPath = optionalString(body.sendDocumentPath);
    const connectedPhoneHint = optionalString(body.connectedPhoneHint);

    if (apiBaseUrl) patch.apiBaseUrl = apiBaseUrl;
    else if (existing.exists) patch.apiBaseUrl = FieldValue.delete();

    if (sendPath) patch.sendPath = sendPath;
    else if (existing.exists) patch.sendPath = FieldValue.delete();

    if (sendDocumentPath) patch.sendDocumentPath = sendDocumentPath;
    else if (existing.exists) patch.sendDocumentPath = FieldValue.delete();

    if (connectedPhoneHint) patch.connectedPhoneHint = connectedPhoneHint;
    else if (existing.exists) patch.connectedPhoneHint = FieldValue.delete();

    await getDocRef().set(patch, { merge: true });
    clearWapilotConfigCache();

    return NextResponse.json({
      ok: true,
      configured: true,
      source: "firestore",
      instanceId,
      tokenSet: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save Wapilot config";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
