import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { isMetaId, type ConversionEventName } from "@/lib/metaConversions";
import {
  CAPI_SETTINGS_FIELD,
  listRecentConversionEvents,
  loadCapiConfig,
  processClinicQueue,
  sendTestConversion,
} from "@/lib/metaConversionsServer";
import { CLINIC_SECRETS_COLLECTION } from "@/types/wapilot";

/**
 * A clinic's Meta Conversions API settings — the switch that tells Meta which click-to-WhatsApp
 * ad chats became bookings and visits, so the ads learn to find more people who actually come.
 *
 * Same house rules as `admin/meta-whatsapp-config`, which this sits beside on the Settings page:
 * scoped to the clinic on screen (not the caller's default), Admin or Owner only, stored in
 * `clinic_secrets/{clinicId}` where no client rule reaches, and the access token is NEVER sent
 * back. The UI only ever learns that a token is stored (`tokenSet`) or that the WhatsApp card's
 * token will be borrowed (`whatsappTokenSet`). The dataset id and WABA id are not secrets — they
 * show in Meta's own dashboard URLs — so they come back as typed.
 *
 * Three POST actions besides "save":
 *   - "test" sends one event marked with a Test Events code, so the owner can watch it arrive in
 *     Events Manager → Test Events before trusting the live switch. While a test code is SAVED
 *     (`testMode`), live reporting pauses: real events wait in the queue and none goes out
 *     marked as a test.
 *   - "run" drains this clinic's queue now, so a setup session does not wait for the cron.
 *
 * The event list in the GET is the clinic's own log (`clinic_secrets/{id}/meta_conversion_events`).
 * Its stored `payload` already went through `redactPayload` (anything credential-shaped blanked)
 * and the token travels only in the Authorization header, never in a doc, so passing the rows
 * through is safe. The card only renders a few fields of each row anyway.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The "run" action drains the queue by hand, and processClinicQueue stops claiming new rows 240 s
 * in. Without this the platform default could cut the function off mid-send, after Meta took an
 * event but before its row said so — and Meta does not dedupe, so the next run would count it twice.
 */
export const maxDuration = 300;

const secretDocRef = (clinicId: string) => adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(clinicId);

const EVENT_NAMES: ConversionEventName[] = ["LeadSubmitted", "QualifiedLead", "Purchase"];

/** Meta's test codes look like TEST12345; anything outside this set is a paste mistake. */
const TEST_CODE_RE = /^[A-Za-z0-9_-]{0,64}$/;

/**
 * The shape both GET and a successful save answer with. Built from the resolved config so the
 * card shows exactly what the sender will use: an empty own WABA id with a WhatsApp one beside it
 * means "borrowed", and `ready` / `missing` are the sender's own verdict, not a second opinion.
 */
async function statusFor(clinicId: string) {
  const cfg = await loadCapiConfig(clinicId);
  let events: Array<Record<string, unknown> & { id: string }> = [];
  try {
    events = await listRecentConversionEvents(clinicId, 30);
  } catch (e) {
    // A missing index or an empty collection must not hide the settings themselves.
    console.warn("meta-conversions: event list failed", e);
  }
  return {
    ok: true as const,
    enabled: cfg.settings.enabled,
    datasetId: cfg.settings.datasetId,
    wabaId: cfg.settings.wabaId,
    whatsappWabaId: cfg.whatsappWabaId,
    tokenSet: cfg.settings.token.length > 0,
    whatsappTokenSet: cfg.whatsappTokenSet,
    testEventCode: cfg.settings.testEventCode,
    /** A test code is saved, so live reporting is paused (rows wait) until it is cleared. */
    testMode: cfg.testMode,
    ready: cfg.ready,
    missing: cfg.missing,
    events,
  };
}

export async function GET(request: Request) {
  // The clinic on screen, for the reason spelled out in admin/meta-whatsapp-config: a superadmin
  // setting up a client must read the client's settings, not their own default clinic's. Reading
  // stays open to a lapsed clinic, like every other settings read; every POST below is gated.
  const requested = new URL(request.url).searchParams.get("clinicId") || "";
  const authz = await requireAdminUser(request, requested || undefined, { allowInactive: true });
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requested);
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }
    return NextResponse.json(await statusFor(clinicId));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Meta conversions settings";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

type PostBody = {
  /** The clinic on screen. Same reason as GET. */
  clinicId?: string;
  action?: "save" | "test" | "run";
  // save
  enabled?: boolean;
  datasetId?: string;
  wabaId?: string;
  /** Empty keeps the stored token. Never echoed back. */
  token?: string;
  /** True removes the stored token (the WhatsApp card's token is then borrowed, if there is one). */
  clearToken?: boolean;
  testEventCode?: string;
  // test
  ctwaClid?: string;
  eventName?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as PostBody;
  const authz = await requireAdminUser(
    request,
    typeof body.clinicId === "string" && body.clinicId ? body.clinicId : undefined
  );
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, typeof body.clinicId === "string" ? body.clinicId : "");
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }

    const action = body.action || "save";

    if (action === "run") {
      // Drains only this clinic's due events, the same function the cron calls. An event that is
      // not due yet (a visit still inside its three-hour settle window) stays queued — we send one
      // Purchase per visit and Meta does not dedupe, so an early one cannot be corrected later.
      // A switched-off, half-set-up or test-mode clinic comes back with `summary.paused` and no
      // row touched.
      const summary = await processClinicQueue(clinicId);
      return NextResponse.json({ ok: true, summary });
    }

    if (action === "test") {
      const eventName = EVENT_NAMES.includes(body.eventName as ConversionEventName)
        ? (body.eventName as ConversionEventName)
        : undefined;
      const testEventCode = str(body.testEventCode);
      if (testEventCode && !TEST_CODE_RE.test(testEventCode)) {
        return NextResponse.json({ ok: false, error: "The test event code may only hold letters, digits, - and _." }, { status: 400 });
      }
      const ctwaClid = str(body.ctwaClid);
      const result = await sendTestConversion(clinicId, {
        ...(eventName ? { eventName } : {}),
        ...(ctwaClid ? { ctwaClid: ctwaClid.slice(0, 500) } : {}),
        ...(testEventCode ? { testEventCode } : {}),
      });
      return NextResponse.json({
        ok: result.ok,
        eventId: result.eventId,
        ctwaClid: result.ctwaClid,
        outcome: result.outcome,
        ...(result.error ? { error: result.error } : {}),
      });
    }

    if (action !== "save") {
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }

    // ── save ──
    const datasetId = str(body.datasetId);
    const wabaId = str(body.wabaId);
    const testEventCode = str(body.testEventCode);
    const tokenDraft = str(body.token);
    const clearToken = body.clearToken === true;
    const enabled = body.enabled === true;

    if (datasetId && !isMetaId(datasetId)) {
      return NextResponse.json({ ok: false, error: "The Dataset ID must be digits only, as Meta shows it." }, { status: 400 });
    }
    if (wabaId && !isMetaId(wabaId)) {
      return NextResponse.json({ ok: false, error: "The WhatsApp Business Account ID must be digits only." }, { status: 400 });
    }
    if (!TEST_CODE_RE.test(testEventCode)) {
      return NextResponse.json(
        { ok: false, error: "The test event code may only hold letters, digits, - and _ (64 at most)." },
        { status: 400 }
      );
    }

    // The current state decides what an empty token field means (keep) and what the fallbacks are.
    const current = await loadCapiConfig(clinicId);
    const token = tokenDraft || (clearToken ? "" : current.settings.token);

    if (enabled) {
      const missing: string[] = [];
      if (!datasetId) missing.push("Dataset ID");
      if (!wabaId && !current.whatsappWabaId) missing.push("WhatsApp Business Account ID");
      if (!token && !current.whatsappTokenSet) missing.push("Access token");
      if (missing.length) {
        return NextResponse.json(
          { ok: false, error: `Cannot switch on yet — missing: ${missing.join(", ")}.`, missing },
          { status: 400 }
        );
      }
    }

    // Every field written explicitly: Firestore rejects undefined, and a merge that left an old
    // token behind after "remove" would keep sending with it.
    await secretDocRef(clinicId).set(
      {
        [CAPI_SETTINGS_FIELD]: {
          enabled,
          datasetId,
          wabaId,
          token,
          testEventCode,
          updatedAt: new Date().toISOString(),
          updatedBy: authz.uid,
        },
      },
      { merge: true }
    );

    return NextResponse.json(await statusFor(clinicId));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save Meta conversions settings";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
