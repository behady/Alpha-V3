"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FlaskConical, Loader2, Save, Send, Target } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { currentClinicId } from "@/lib/db-utils";

/**
 * Meta ad results — the Conversions API card on the WhatsApp connection tab.
 *
 * What it is for, in the owner's words: when someone taps a click-to-WhatsApp ad and later books
 * and comes in, we tell Meta "that chat became a booking, then a visit". Meta then shows the ads to
 * more people like the ones who actually came, instead of people who only like to chat.
 *
 * It sits right under the Meta WhatsApp card because it borrows that card's WABA id and token when
 * its own are empty — most clinics only ever paste a Dataset ID here. The status pill says exactly
 * what the sender will do (Off / On / On but missing … / Test mode), using the server's own verdict.
 *
 * The token is never in this component's state from the server: the route only answers `tokenSet`.
 * What the owner types goes out once on Save and the field is cleared.
 *
 * The event list is the clinic's own log. Appointments with no ad click behind them are queued too
 * (the trigger cannot know in advance) and skipped with reason "no_click"; there are many of those,
 * so they fold into one counting line and the list shows the events Meta actually got.
 *
 * Test mode gets its own loud notice because it is easy to forget: while a test code is saved the
 * sender holds back every REAL booking and visit (they wait, up to 7 days, and go out once the code
 * is cleared) — only the "Send test event" button uses the code. The server says so with
 * `testMode`; the saved code is the fallback for an older server that does not send it yet.
 */

type EventRow = {
  id: string;
  eventName?: string;
  status?: string;
  reason?: string;
  eventTimeMs?: number;
  createdAt?: number;
  value?: number;
  test?: boolean;
  attempts?: number;
  response?: { httpStatus?: number; eventsReceived?: number; fbtraceId?: string; error?: string; errorCode?: number };
};

type Status = {
  enabled: boolean;
  datasetId: string;
  wabaId: string;
  whatsappWabaId: string;
  tokenSet: boolean;
  whatsappTokenSet: boolean;
  testEventCode: string;
  testMode: boolean;
  ready: boolean;
  missing: string[];
  events: EventRow[];
};

const inputCls =
  "mt-1.5 w-full py-3 px-4 bg-surface-subtle border border-line rounded-xl text-sm font-semibold text-ink outline-none focus:bg-surface focus:border-accent focus:ring-2 focus:ring-accent/15";
const labelCls = "text-[11px] font-bold text-ink-muted uppercase tracking-wider";
const secondaryBtn =
  "inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-line bg-surface text-ink text-xs font-black uppercase tracking-wide hover:bg-surface-muted disabled:opacity-50 transition-colors";

const pad = (n: number) => String(n).padStart(2, "0");
function shortTime(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function asStatus(data: Record<string, unknown>): Status {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    enabled: data.enabled === true,
    datasetId: s(data.datasetId),
    wabaId: s(data.wabaId),
    whatsappWabaId: s(data.whatsappWabaId),
    tokenSet: data.tokenSet === true,
    whatsappTokenSet: data.whatsappTokenSet === true,
    testEventCode: s(data.testEventCode),
    testMode: typeof data.testMode === "boolean" ? data.testMode : s(data.testEventCode) !== "",
    ready: data.ready === true,
    missing: Array.isArray(data.missing) ? data.missing.filter((m): m is string => typeof m === "string") : [],
    events: Array.isArray(data.events) ? (data.events as EventRow[]) : [],
  };
}

async function authedFetch(input: string, init?: RequestInit): Promise<{ res: Response; data: Record<string, unknown> }> {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  const idToken = await u.getIdToken();
  const res = await fetch(input, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${idToken}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const data = ((await res.json().catch(() => ({}))) || {}) as Record<string, unknown>;
  return { res, data };
}

export default function MetaConversionsCard() {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [testCode, setTestCode] = useState("");

  const txt = useMemo(
    () => ({
      title: ar ? "نتايج إعلانات ميتا" : "Meta ad results (Conversions API)",
      hint: ar
        ? "بنقول لميتا أنهي محادثة جاية من إعلان بقت حجز وزيارة، علشان الإعلانات تجيب ناس أكتر بتيجي فعلاً."
        : "Tells Meta which ad chats became bookings and visits, so your ads find more real patients.",
      off: ar ? "مقفول" : "Off",
      on: ar ? "شغال" : "On",
      onMissing: ar ? "شغال بس ناقص:" : "On but missing:",
      testMode: ar ? "وضع التجربة" : "Test mode",
      dataset: ar ? "رقم الـ Dataset" : "Dataset ID",
      datasetHint: ar ? "من Events Manager في ميتا (أرقام بس)." : "From Meta Events Manager (digits only).",
      waba: ar ? "رقم حساب واتساب للأعمال (WABA)" : "WhatsApp Business Account ID",
      wabaFallback: ar ? "فاضي = هنستخدم رقم كارت واتساب اللي فوق" : "Empty = using the WhatsApp card's ID",
      token: ar ? "توكن الدخول (Access token)" : "Access token",
      tokenKept: ar ? "متسجل — سيبه فاضي علشان يفضل زي ما هو" : "Saved — leave empty to keep it",
      tokenFromWa: ar ? "فاضي = هنستخدم توكن كارت واتساب" : "Empty = using the WhatsApp card's token",
      removeToken: ar ? "امسح التوكن المتسجل" : "Remove saved token",
      testCode: ar ? "كود التجربة (Test event code)" : "Test event code",
      testWarn: ar
        ? "طول ما الكود ده متسجل، الحجوزات والزيارات الحقيقية مش بتتبعت لميتا — بتستنى لحد ما تمسحه. زرار «ابعت حدث تجربة» بس هو اللي بيستخدمه. امسحه بعد ما تخلص تجربة."
        : "While this is saved, real bookings and visits are not sent to Meta — they wait until you clear it. Only “Send test event” uses it. Clear it after testing.",
      testModeNotice: ar
        ? "وضع التجربة: الحجوزات والزيارات الحقيقية مستنية، وهتتبعت لميتا بعد ما تمسح كود التجربة."
        : "Test mode: real bookings and visits are waiting and will go to Meta after you clear the test code.",
      switchLabel: ar ? "ابعت النتايج لميتا" : "Send results to Meta",
      save: ar ? "حفظ" : "Save",
      saved: ar ? "اتحفظ" : "Saved",
      sendTest: ar ? "ابعت حدث تجربة" : "Send test event",
      testNeedsCode: ar ? "اكتب كود التجربة الأول" : "Enter a test event code first",
      testOk: ar ? "ميتا استلمت حدث التجربة" : "Meta received the test event",
      testFail: ar ? "حدث التجربة فشل" : "Test event failed",
      runNow: ar ? "ابعت المتأخر دلوقتي" : "Send pending now",
      runDone: ar ? "اتبعت" : "Sent",
      runRetry: ar ? "هيتعاد" : "to retry",
      runFailed: ar ? "فشل" : "failed",
      runNothing: ar ? "مفيش حاجة مستنية دلوقتي" : "Nothing waiting right now",
      eventsTitle: ar ? "آخر الأحداث" : "Recent events",
      noEvents: ar ? "لسه مفيش أحداث." : "No events yet.",
      colTime: ar ? "الوقت" : "Time",
      colEvent: ar ? "الحدث" : "Event",
      colStatus: ar ? "الحالة" : "Status",
      colValue: ar ? "القيمة" : "Value",
      colNote: ar ? "ملاحظة" : "Note",
      testTag: ar ? "تجربة" : "Test",
      egp: ar ? "ج.م" : "EGP",
      loadFail: ar ? "مقدرناش نحمّل الإعدادات" : "Could not load the settings",
    }),
    [ar]
  );

  const eventLabel = (name?: string) =>
    name === "LeadSubmitted" ? (ar ? "حجز" : "Booked")
    : name === "QualifiedLead" ? (ar ? "تأكيد" : "Confirmed")
    : name === "Purchase" ? (ar ? "زيارة" : "Visit")
    : name || "—";

  const statusLabel = (s?: string) =>
    s === "sent" ? (ar ? "اتبعت" : "Sent")
    : s === "pending" ? (ar ? "مستني" : "Pending")
    : s === "retry" ? (ar ? "هيتعاد" : "Retry")
    : s === "failed" ? (ar ? "فشل" : "Failed")
    : s === "skipped" ? (ar ? "اتساب" : "Skipped")
    : s || "—";

  const statusChip = (s?: string) =>
    s === "sent" ? "text-ok bg-ok-tint border-ok/25"
    : s === "failed" ? "text-warn bg-warn-tint border-warn/25"
    : "text-ink-muted bg-surface-subtle border-line";

  const reasonLabel = (r?: string) =>
    r === "no_click" ? (ar ? "مفيش ضغطة إعلان" : "No ad click")
    : r === "too_old" ? (ar ? "قديم أوي على ميتا" : "Too old for Meta")
    : r === "disabled" ? (ar ? "الخاصية كانت مقفولة" : "Feature was off")
    : r === "not_configured" ? (ar ? "الإعدادات ناقصة" : "Settings incomplete")
    : r === "out_of_attempts" ? (ar ? "خلصت المحاولات" : "Out of attempts")
    : r === "no_patient" ? (ar ? "مفيش ملف مريض" : "No patient file")
    : r === "test_failed" ? (ar ? "التجربة ما نجحتش" : "Test did not go through")
    : r === "meta_rejected" ? (ar ? "ميتا رفضته" : "Meta refused it")
    : r === "already_credited" ? (ar ? "الإعلان ده اتحسب قبل كده" : "Already reported for this ad")
    : r === "appointment_gone" ? (ar ? "الميعاد اتمسح" : "Appointment deleted")
    : r === "cancelled" ? (ar ? "اتلغى قبل ما يتبعت" : "Cancelled before sending")
    : r === "unknown_event" ? (ar ? "حدث مش معروف" : "Unknown event")
    : r || "";

  /** The server's `missing` entries, worded for the owner whatever key style they arrive in. */
  const missingLabel = (m: string) => {
    const k = m.toLowerCase();
    if (k.includes("dataset")) return txt.dataset;
    if (k.includes("waba") || k.includes("business account")) return ar ? "رقم WABA" : "WABA ID";
    if (k.includes("token")) return ar ? "التوكن" : "access token";
    return m;
  };

  const applyStatus = useCallback((s: Status) => {
    setStatus(s);
    setEnabled(s.enabled);
    setDatasetId(s.datasetId);
    setWabaId(s.wabaId);
    setTestCode(s.testEventCode);
    setTokenDraft("");
  }, []);

  const load = useCallback(async () => {
    try {
      const { res, data } = await authedFetch(
        `/api/admin/meta-conversions?clinicId=${encodeURIComponent(currentClinicId() || "")}`
      );
      if (res.ok && data.ok) applyStatus(asStatus(data));
    } catch {
      /* the card simply shows Off */
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    (body: Record<string, unknown>) =>
      authedFetch("/api/admin/meta-conversions", {
        method: "POST",
        body: JSON.stringify({ clinicId: currentClinicId() || "", ...body }),
      }),
    []
  );

  const save = async (opts?: { clearToken?: boolean }) => {
    setSaving(true);
    try {
      const { res, data } = await post({
        action: "save",
        enabled,
        datasetId: datasetId.trim(),
        wabaId: wabaId.trim(),
        token: opts?.clearToken ? "" : tokenDraft.trim(),
        testEventCode: testCode.trim(),
        ...(opts?.clearToken ? { clearToken: true } : {}),
      });
      if (res.ok && data.ok) {
        applyStatus(asStatus(data));
        showToast(txt.saved, "success");
      } else {
        showToast(typeof data.error === "string" ? data.error : txt.loadFail, "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : txt.loadFail, "error");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const code = testCode.trim() || status?.testEventCode || "";
    if (!code) {
      showToast(txt.testNeedsCode, "error");
      return;
    }
    setTesting(true);
    try {
      const { data } = await post({ action: "test", testEventCode: code });
      const outcome = (data.outcome || null) as EventRow["response"] & { kind?: string } | null;
      if (data.ok === true) {
        const n = typeof outcome?.eventsReceived === "number" ? ` (events_received: ${outcome.eventsReceived})` : "";
        showToast(`${txt.testOk}${n}`, "success");
      } else {
        const why = (typeof data.error === "string" && data.error) || outcome?.error || "";
        showToast(why ? `${txt.testFail}: ${why}` : txt.testFail, "error");
      }
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : txt.testFail, "error");
    } finally {
      setTesting(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { res, data } = await post({ action: "run" });
      const s = (data.summary || {}) as { sent?: number; retried?: number; failed?: number; examined?: number };
      if (res.ok && data.ok) {
        if (!s.examined) showToast(txt.runNothing, "info");
        else
          showToast(
            `${txt.runDone}: ${s.sent ?? 0} · ${txt.runRetry}: ${s.retried ?? 0} · ${txt.runFailed}: ${s.failed ?? 0}`,
            (s.failed ?? 0) > 0 ? "error" : "success"
          );
        void load();
      } else {
        showToast(typeof data.error === "string" ? data.error : txt.loadFail, "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : txt.loadFail, "error");
    } finally {
      setRunning(false);
    }
  };

  const events = status?.events ?? [];
  const noClickCount = events.filter((e) => e.status === "skipped" && e.reason === "no_click").length;
  const shown = events.filter((e) => !(e.status === "skipped" && e.reason === "no_click"));
  const busy = loading || saving || testing || running;
  const testAvailable = Boolean(testCode.trim() || status?.testEventCode);
  const testActive = status?.testMode === true;

  return (
    <section className="rounded-2xl xl:rounded-3xl bg-surface border border-line shadow-sm ring-1 ring-line p-5 xl:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-ok">
          <Target size={18} />
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-ink">{txt.title}</h3>
            <p className="text-xs text-ink-muted font-medium mt-0.5 max-w-xl">{txt.hint}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Test mode wins over On: while a test code is saved nothing real is sent, so "On" would mislead. */}
          {loading ? (
            <Loader2 size={18} className="animate-spin text-ok" />
          ) : testActive ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warn bg-warn-tint border border-warn/25 px-3 py-1.5 rounded-full">
              <FlaskConical size={14} />
              {txt.testMode}
            </span>
          ) : !status?.enabled ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-muted bg-surface-subtle border border-line px-3 py-1.5 rounded-full">
              {txt.off}
            </span>
          ) : status.ready ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ok bg-ok-tint border border-ok/25 px-3 py-1.5 rounded-full">
              <CheckCircle2 size={14} />
              {txt.on}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-warn bg-warn-tint border border-warn/25 px-3 py-1.5 rounded-full">
              <AlertCircle size={14} />
              {txt.onMissing} {status.missing.map(missingLabel).join("، ")}
            </span>
          )}
        </div>
      </div>

      {testActive && !loading && (
        <div
          role="status"
          dir="auto"
          className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn-tint px-4 py-3 text-xs font-bold text-warn"
        >
          <FlaskConical size={16} className="mt-0.5 shrink-0" />
          <span>{txt.testModeNotice}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>{txt.dataset}</span>
          <input
            type="text"
            inputMode="numeric"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            placeholder="1234567890123456"
            dir="ltr"
            className={inputCls}
          />
          <span className="mt-1 block text-[11px] text-ink-muted">{txt.datasetHint}</span>
        </label>
        <label className="block">
          <span className={labelCls}>{txt.waba}</span>
          <input
            type="text"
            inputMode="numeric"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value)}
            placeholder={status?.whatsappWabaId || ""}
            dir="ltr"
            className={inputCls}
          />
          {!wabaId.trim() && status?.whatsappWabaId && (
            <span className="mt-1 block text-[11px] text-ink-muted">{txt.wabaFallback}</span>
          )}
        </label>
      </div>

      <label className="block">
        <span className={labelCls}>{txt.token}</span>
        <input
          type="password"
          value={tokenDraft}
          onChange={(e) => setTokenDraft(e.target.value)}
          placeholder={status?.tokenSet ? txt.tokenKept : status?.whatsappTokenSet ? txt.tokenFromWa : "EAA..."}
          autoComplete="off"
          dir="ltr"
          className={inputCls}
        />
        {status?.tokenSet && (
          <button
            type="button"
            onClick={() => void save({ clearToken: true })}
            disabled={busy}
            className="mt-1.5 text-[11px] font-bold text-warn underline underline-offset-2 disabled:opacity-50"
          >
            {txt.removeToken}
          </button>
        )}
      </label>

      <label className="block">
        <span className={labelCls}>{txt.testCode}</span>
        <input
          type="text"
          value={testCode}
          onChange={(e) => setTestCode(e.target.value)}
          placeholder="TEST12345"
          maxLength={64}
          autoComplete="off"
          dir="ltr"
          className={inputCls}
        />
        <span dir="auto" className="mt-1.5 block text-[11px] font-bold rounded-lg px-3 py-2 bg-warn-tint text-warn border border-warn/25">
          {txt.testWarn}
        </span>
      </label>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled((v) => !v)}
        disabled={busy}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-subtle px-4 py-3 text-start text-sm font-bold text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{txt.switchLabel}</span>
        <span
          className={`relative inline-flex h-[24px] w-[42px] shrink-0 items-center rounded-full transition-colors ${
            enabled ? "bg-accent" : "bg-surface-muted border border-line"
          }`}
        >
          <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${enabled ? "start-[21px]" : "start-[3px]"}`} />
        </span>
      </button>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent text-ink-on-accent text-xs font-black uppercase tracking-widest hover:bg-accent-strong disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {txt.save}
        </button>
        <button type="button" onClick={() => void sendTest()} disabled={busy || !testAvailable} className={secondaryBtn}>
          {testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
          {txt.sendTest}
        </button>
        <button type="button" onClick={() => void runNow()} disabled={busy || !status?.enabled} className={secondaryBtn}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {txt.runNow}
        </button>
      </div>

      <div className="space-y-2 pt-2">
        <p className={labelCls}>{txt.eventsTitle}</p>
        {noClickCount > 0 && (
          <p className="text-xs text-ink-muted">
            {ar
              ? `${noClickCount} ميعاد مكانش وراه ضغطة على إعلان — مااتبعتش حاجة عنهم`
              : `${noClickCount} appointment${noClickCount === 1 ? "" : "s"} had no ad click — nothing sent`}
          </p>
        )}
        {!loading && shown.length === 0 ? (
          <p className="text-xs text-ink-muted">{txt.noEvents}</p>
        ) : (
          <ul className="space-y-2 sm:space-y-0 sm:divide-y sm:divide-line sm:rounded-xl sm:border sm:border-line">
            <li className="hidden sm:grid sm:grid-cols-[6.5rem_5.5rem_6rem_6.5rem_1fr] gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              <span>{txt.colTime}</span>
              <span>{txt.colEvent}</span>
              <span>{txt.colStatus}</span>
              <span>{txt.colValue}</span>
              <span>{txt.colNote}</span>
            </li>
            {shown.map((e) => {
              const note = e.response?.error || reasonLabel(e.reason);
              const value =
                e.eventName === "Purchase" && typeof e.value === "number"
                  ? `${e.value.toLocaleString(ar ? "ar-EG" : "en-US")} ${txt.egp}`
                  : "";
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-subtle p-3 text-xs sm:grid sm:grid-cols-[6.5rem_5.5rem_6rem_6.5rem_1fr] sm:rounded-none sm:border-0 sm:bg-transparent sm:px-3 sm:py-2"
                >
                  <span dir="ltr" className="font-semibold text-ink-muted tabular-nums">{shortTime(e.eventTimeMs || e.createdAt)}</span>
                  <span className="font-bold text-ink">
                    {eventLabel(e.eventName)}
                    {e.test && (
                      <span className="ms-1.5 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">{txt.testTag}</span>
                    )}
                  </span>
                  <span>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusChip(e.status)}`}>
                      {statusLabel(e.status)}
                    </span>
                  </span>
                  <span className="font-semibold text-ink tabular-nums">{value}</span>
                  <span
                    dir="auto"
                    title={e.response?.fbtraceId ? `fbtrace_id: ${e.response.fbtraceId}` : undefined}
                    className="basis-full sm:basis-auto truncate text-ink-muted"
                  >
                    {note.length > 120 ? `${note.slice(0, 117)}…` : note}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
