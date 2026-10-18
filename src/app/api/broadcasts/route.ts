import { NextResponse } from "next/server";
import { reportServerError } from "@/lib/server/reportError";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import {
  BroadcastError,
  broadcastContext,
  broadcastRecipients,
  broadcastLine,
  buildAudience,
  cleanVersions,
  createBroadcast,
  lineProblem,
  listBroadcasts,
  sendBroadcastTest,
  steerBroadcast,
} from "@/lib/broadcast/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Launch writes one row per patient; twelve hundred of them is a few batches. */
export const maxDuration = 120;

/**
 * Patient broadcasts — see lib/broadcast/server.ts.
 *
 * Admin only, like campaigns: every action here either reads the whole patient list or messages
 * it. One POST with an `action` so the page has one door to knock on.
 */

type Body = {
  clinicId?: string;
  action?: "overview" | "list" | "create" | "pause" | "resume" | "cancel" | "test" | "recipients";
  id?: string;
  name?: string;
  versions?: unknown;
  dailyLimit?: number;
  phone?: string;
  text?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;

  if (!(await clinicHasFeature(clinicId, "whatsappIntegration"))) {
    return NextResponse.json(
      { ok: false, upgradeRequired: true, error: "Broadcasts are part of the WhatsApp messages add-on.", errorAr: "الرسائل الجماعية جزء من إضافة رسائل واتساب." },
      { status: 403 }
    );
  }

  try {
    switch (body.action) {
      case "create": {
        const broadcast = await createBroadcast({
          clinicId,
          uid: authz.uid,
          userName: authz.name || null,
          name: String(body.name || ""),
          versions: cleanVersions(body.versions),
          dailyLimit: Number(body.dailyLimit) || 0,
        });
        return NextResponse.json({ ok: true, broadcast });
      }
      case "pause":
      case "resume":
      case "cancel": {
        const broadcast = await steerBroadcast(clinicId, String(body.id || ""), body.action);
        return NextResponse.json({ ok: true, broadcast });
      }
      case "test": {
        await sendBroadcastTest(clinicId, String(body.phone || ""), String(body.text || ""));
        return NextResponse.json({ ok: true });
      }
      case "list": {
        // The refresh while a broadcast runs: no patient scan, which reads the whole list.
        const [line, broadcasts] = await Promise.all([broadcastLine(clinicId), listBroadcasts(clinicId)]);
        return NextResponse.json({ ok: true, line, problem: lineProblem(line), broadcasts });
      }
      case "recipients": {
        return NextResponse.json({ ok: true, rows: await broadcastRecipients(clinicId, String(body.id || "")) });
      }
      default: {
        const [line, audience, broadcasts, context] = await Promise.all([
          broadcastLine(clinicId),
          buildAudience(clinicId),
          listBroadcasts(clinicId),
          broadcastContext(clinicId),
        ]);
        return NextResponse.json({
          ok: true,
          line,
          problem: lineProblem(line),
          // What {{clinic_name}} becomes and the stop line — the preview merges with exactly these.
          clinicName: context.clinicName,
          footer: context.footer,
          audience: {
            count: audience.recipients.length,
            totalPatients: audience.totalPatients,
            excludedOptedOut: audience.excludedOptedOut,
            excludedDuplicates: audience.excludedDuplicates,
            excludedNoPhone: audience.excludedNoPhone,
          },
          broadcasts,
        });
      }
    }
  } catch (e) {
    if (e instanceof BroadcastError) {
      return NextResponse.json({ ok: false, error: e.en, errorAr: e.ar }, { status: e.status });
    }
    reportServerError("[Broadcasts] failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Broadcast request failed" }, { status: 500 });
  }
}
