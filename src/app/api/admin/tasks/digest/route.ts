import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { DIGEST_DOC, runTasksDigest } from "@/lib/server/tasksDigest";
import { digestFromDoc } from "@/lib/platformTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Tasks tab's "Morning WhatsApp" card. Superadmins only.
 *
 *   GET                                         → { settings, lastResult }
 *   POST { action: "save", enabled, phone, hour }
 *   POST { action: "send" }                     → sends now, whatever the hour
 */
function view(data: Record<string, unknown> | undefined) {
  const s = digestFromDoc(data);
  const last = data?.lastResult as { ok?: boolean; error?: string; at?: string } | undefined;
  return {
    enabled: s.enabled,
    phone: s.phone,
    hour: s.hour,
    lastSentDay: s.lastSentDay,
    lastResult: last && typeof last.at === "string" ? { ok: last.ok === true, error: last.error || "", at: last.at } : null,
  };
}

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...view((await DIGEST_DOC().get()).data()) });
  } catch (error) {
    reportServerError("tasks digest read error:", error);
    return NextResponse.json({ ok: false, error: "Could not read the settings" }, { status: 500 });
  }
}

const REASONS: Record<string, string> = {
  no_phone: "Save a phone number first.",
  line_not_configured: "The platform alerts line is not set up (Platform settings).",
  send_failed: "WhatsApp refused the message.",
};

export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });

  try {
    if (body.action === "save") {
      const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 30) : "";
      if (phone) {
        const e164 = normalizeToE164AssumingCountry(phone);
        if (!e164 || e164.replace(/\D/g, "").length < 8) {
          return NextResponse.json({ ok: false, error: "That phone number does not look right" }, { status: 400 });
        }
      }
      const hour = Number(body.hour);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ ok: false, error: "Pick an hour" }, { status: 400 });
      }
      const enabled = body.enabled === true && !!phone;
      await DIGEST_DOC().set({ enabled, phone, hour, updatedAt: new Date().toISOString() }, { merge: true });
      return NextResponse.json({ ok: true, ...view((await DIGEST_DOC().get()).data()) });
    }

    if (body.action === "send") {
      const result = await runTasksDigest({ force: true });
      if (!result.sent) {
        return NextResponse.json(
          { ok: false, error: (REASONS[result.reason] || "Not sent") + (result.error ? ` ${result.error}` : "") },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: true, sent: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    reportServerError("tasks digest write error:", error);
    return NextResponse.json({ ok: false, error: "Could not save" }, { status: 500 });
  }
}
