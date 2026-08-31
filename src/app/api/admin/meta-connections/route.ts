import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Facebook page ↔ clinic connections, the superadmin screen's back end.
 *
 * The vendor-side half of Meta lead intake: once a customer partner-shares their page and it
 * is assigned to the platform's system user, GET lists it here; POST wires it to a clinic —
 * derives the page's own token from the stored system-user token, subscribes the app to the
 * page's `leadgen` webhook, and writes the mapping the metaLeadsWebhook function routes by.
 *
 * Config lives in `meta_integrations/config` (server-only; no client rule can reach it):
 * `systemUserToken` never expires, so this route never handles a Facebook login.
 */

const GRAPH = "https://graph.facebook.com/v23.0";

async function requireSuperAdmin(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const snap = await adminDb().collection("users").doc(decoded.uid).get();
    const data = snap.data();
    if (!data || (data.isSuperAdmin !== true && data.isSuperAdmin !== "true")) {
      return {
        ok: false as const,
        response: NextResponse.json({ ok: false, error: "Super admins only" }, { status: 403 }),
      };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 }) };
  }
}

async function getConfig() {
  const snap = await adminDb().doc("meta_integrations/config").get();
  const data = snap.exists ? snap.data()! : {};
  if (!data.systemUserToken) throw new Error("Meta integration is not configured (missing system user token)");
  return data as { systemUserToken: string; businessId?: string };
}

/** Every clinic on the platform, ghosts included — some clinic docs never got created even
 *  though their subcollections are full, so a plain collection .get() would skip them. */
async function listClinics() {
  const db = adminDb();
  const refs = await db.collection("clinics").listDocuments();
  return Promise.all(
    refs.map(async (ref) => {
      const doc = await ref.get();
      let name = doc.exists ? String(doc.data()?.name || "") : "";
      if (!name) {
        // clinic_info holds the clinic's own details now; clinicProfile is only still consulted
        // for clinics that have not saved their profile since the two documents were merged.
        const info = await db.doc(`clinics/${ref.id}/settings/clinic_info`).get();
        name = info.exists ? String(info.data()?.name || info.data()?.clinicName || "") : "";
        if (!name) {
          const legacy = await db.doc(`clinics/${ref.id}/settings/clinicProfile`).get();
          name = legacy.exists ? String(legacy.data()?.clinicName || "") : "";
        }
      }
      return { id: ref.id, name: name || ref.id };
    })
  );
}

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const config = await getConfig();

    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name&limit=100&access_token=${encodeURIComponent(config.systemUserToken)}`
    );
    const pagesBody = await pagesRes.json();
    if (!pagesRes.ok) throw new Error(`Facebook: ${pagesBody.error?.message || "could not list pages"}`);
    const pages = (pagesBody.data || []).map((p: { id: string; name: string }) => ({
      id: String(p.id),
      name: String(p.name || "").trim(),
    }));

    const connSnap = await adminDb().collection("meta_pages").get();
    const millis = (v: unknown) =>
      v && typeof v === "object" && "toMillis" in (v as object) ? (v as { toMillis: () => number }).toMillis() : null;

    const connections = connSnap.docs.map((d) => {
      const data = d.data();
      return {
        pageId: d.id,
        pageName: String(data.pageName || ""),
        clinicId: String(data.clinicId || ""),
        enabled: data.enabled !== false,
        // Health, so a page that quietly stopped delivering is visible here first.
        lastLeadAt: millis(data.lastLeadAt),
        lastEventAt: millis(data.lastEventAt),
        leadsReceived: Number(data.leadsReceived || 0),
        lastError: data.lastError ? String(data.lastError) : null,
        lastErrorAt: millis(data.lastErrorAt),
      };
    });

    // Leads Meta has announced but not yet handed over — the retry sweep is still chasing them.
    const pendingSnap = await adminDb()
      .collection("meta_lead_events")
      .where("status", "in", ["pending", "unmapped"])
      .get();
    const pendingByPage: Record<string, number> = {};
    pendingSnap.docs.forEach((d) => {
      const pageId = String(d.data().pageId || "");
      if (pageId) pendingByPage[pageId] = (pendingByPage[pageId] || 0) + 1;
    });

    return NextResponse.json({
      ok: true,
      pages,
      connections,
      clinics: await listClinics(),
      pendingByPage,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "connect" | "disconnect";
      pageId?: string;
      clinicId?: string;
    };
    const pageId = String(body.pageId || "").trim();
    if (!pageId) return NextResponse.json({ ok: false, error: "pageId is required" }, { status: 400 });

    if (body.action === "disconnect") {
      await adminDb().doc(`meta_pages/${pageId}`).set(
        { enabled: false, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      return NextResponse.json({ ok: true, status: "disconnected" });
    }

    const clinicId = String(body.clinicId || "").trim();
    if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });

    const clinicRefs = await adminDb().collection(`clinics/${clinicId}/leads`).limit(1).get().catch(() => null);
    if (clinicRefs === null) return NextResponse.json({ ok: false, error: "Clinic not found" }, { status: 404 });

    const config = await getConfig();

    // The page's own token is what the webhook stores and uses; deriving it also proves the
    // system user really has access to this page.
    const pageRes = await fetch(
      `${GRAPH}/${pageId}?fields=name,access_token&access_token=${encodeURIComponent(config.systemUserToken)}`
    );
    const pageInfo = await pageRes.json();
    if (!pageRes.ok || !pageInfo.access_token) {
      throw new Error(
        `Facebook: ${pageInfo.error?.message || "cannot access this page — is it assigned to the system user?"}`
      );
    }

    const subRes = await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `subscribed_fields=leadgen&access_token=${encodeURIComponent(pageInfo.access_token)}`,
    });
    const subBody = await subRes.json();
    if (!subRes.ok || !subBody.success) {
      throw new Error(`Facebook: ${subBody.error?.message || "could not subscribe the app to this page"}`);
    }

    await adminDb().doc(`meta_pages/${pageId}`).set(
      {
        clinicId,
        pageAccessToken: pageInfo.access_token,
        pageName: String(pageInfo.name || ""),
        enabled: true,
        connectedBy: authz.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, status: "connected", pageName: pageInfo.name });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
