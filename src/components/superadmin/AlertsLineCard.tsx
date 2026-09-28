"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MessageCircle, QrCode, RefreshCw, Save, Send, Trash2, Unplug } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUI } from "@/context/UIContext";

/**
 * The platform's alerts line: Alpha's own Wapilot number, used for owner and staff alerts at
 * clinics that have not connected a number of their own (the `ownerAlertsLine` add-on).
 *
 * Staff only, by construction — the sender that reads these credentials (lib/staffWhatsapp.ts) is
 * not reachable from any patient message path, so a mistake here can annoy an owner but cannot
 * message a patient from the wrong number. The token is never sent back to the browser.
 */

type Status = {
  configured: boolean;
  instanceId: string;
  tokenSet: boolean;
  apiBaseUrl: string;
  from: "panel" | "env" | "none";
  connectedPhoneHint: string;
  updatedAt: string | null;
  lastTest: { to: string; ok: boolean; error?: string; at: string } | null;
};

/** What the QR-connect panel knows about the line on Alpha's own gateway (see lib/waGateway). */
type GatewayView = {
  available: boolean;
  managed: boolean;
  state?: string;
  phone?: string | null;
  qr?: string | null;
  lastError?: string | null;
  /** Clinic hours and the queue, as the gateway reports them (whatsapp-gateway/src/policy.js). */
  sending?: { windowOpen: boolean; nextOpenAt: number | null; waiting: number; dailyCap: number; sentToday: number } | null;
};

function readGateway(data: Record<string, unknown>): GatewayView {
  const s = data.sending && typeof data.sending === "object" ? (data.sending as Record<string, unknown>) : null;
  return {
    available: data.available === true,
    managed: data.managed === true,
    state: typeof data.state === "string" ? data.state : undefined,
    phone: typeof data.phone === "string" ? data.phone : null,
    qr: typeof data.qr === "string" ? data.qr : null,
    lastError: typeof data.lastError === "string" ? data.lastError : null,
    sending: s
      ? {
          windowOpen: s.windowOpen === true,
          nextOpenAt: typeof s.nextOpenAt === "number" ? s.nextOpenAt : null,
          waiting: Number(s.waiting) || 0,
          dailyCap: Number(s.dailyCap) || 0,
          sentToday: Number(s.sentToday) || 0,
        }
      : null,
  };
}

const CARD = "bg-surface rounded-[2rem] border border-slate-200/60 shadow-sm p-6 md:p-8";
const LABEL = "text-xs font-bold text-ink-muted block mb-1.5";
const INPUT =
  "w-full bg-surface border border-line text-slate-700 text-sm font-bold rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500";

async function call(body: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch("/api/admin/platform-wapilot", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error(String(json.error || `HTTP ${res.status}`));
  return json;
}

export function AlertsLineCard() {
  const { showToast, confirm } = useUI();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [phoneHint, setPhoneHint] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const json = (await call(null)) as unknown as Status & { ok: true };
      setStatus(json);
      setInstanceId(json.instanceId || "");
      setPhoneHint(json.connectedPhoneHint || "");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not read the alerts line", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    setBusy("save");
    try {
      await call({ action: "save", instanceId, apiToken, connectedPhoneHint: phoneHint });
      setApiToken("");
      showToast("Alerts line saved.", "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await call({ action: "test", to: testTo });
      showToast(`Test sent to ${testTo}.`, "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Test failed", "error");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    const ok = await confirm(
      "Clinics on the Alerts line add-on stop receiving WhatsApp alerts until a new instance is saved. Push and the bell keep working.",
      { title: "Disconnect the alerts line?", confirmLabel: "Disconnect", tone: "danger" },
    );
    if (!ok) return;
    setBusy("clear");
    try {
      await call({ action: "clear" });
      showToast("Alerts line disconnected.", "success");
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not disconnect", "error");
    } finally {
      setBusy(null);
    }
  };

  /*
   * Alpha's own gateway (whatsapp-gateway/): the alerts line can be a number scanned by QR
   * instead of a Wapilot instance. Same route the clinic Settings card uses, with `platform`
   * as the target. `available` — this deployment has a gateway; `managed` — the line is on it.
   */
  const [gw, setGw] = useState<GatewayView | null>(null);
  const [gwBusy, setGwBusy] = useState(false);

  const loadGw = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/wapilot-config/gateway?clinicId=platform", {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && json.ok) setGw(readGateway(json));
      else setGw((g) => g ?? { available: false, managed: false });
    } catch {
      setGw((g) => g ?? { available: false, managed: false });
    }
  }, []);

  useEffect(() => {
    void loadGw();
  }, [loadGw]);

  // The QR rotates and the state flips the moment the phone scans, so poll while not connected.
  useEffect(() => {
    if (!gw?.managed || gw.state === "open") return;
    const timer = setInterval(() => void loadGw(), 3000);
    return () => clearInterval(timer);
  }, [gw?.managed, gw?.state, loadGw]);

  const gwAction = async (action: "connect" | "disconnect" | "relink" | "resume") => {
    if (action === "disconnect") {
      const ok = await confirm(
        "Clinics on the Alerts line add-on stop receiving WhatsApp alerts until the line is connected again.",
        { title: "Disconnect the alerts line?", confirmLabel: "Disconnect", tone: "danger" },
      );
      if (!ok) return;
    }
    setGwBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/wapilot-config/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token || ""}` },
        body: JSON.stringify({ clinicId: "platform", action }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok === false) throw new Error(String(json.error || `HTTP ${res.status}`));
      setGw(readGateway(json));
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Gateway request failed", "error");
    } finally {
      setGwBusy(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-start gap-3 mb-6">
        <span className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <MessageCircle size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black text-ink tracking-tight">Alerts line (WhatsApp)</h2>
          <p className="text-xs font-semibold text-ink-muted mt-0.5 leading-relaxed max-w-2xl">
            Alpha&apos;s own Wapilot number. Carries owner and staff alerts and the daily reports for
            clinics on the <b>Alerts line</b> add-on that have not connected a number of their own.
            Never messages a patient. A clinic whose own number is connected does not use it.
          </p>
        </div>
        {loading ? (
          <Loader2 size={18} className="animate-spin text-slate-400" />
        ) : status?.configured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
            <Check size={14} /> Connected{status.from === "env" ? " (from env)" : ""}
          </span>
        ) : (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
            Not connected
          </span>
        )}
      </div>

      {gw?.available && (
        <div className="mb-5 rounded-2xl border border-line bg-surface-subtle p-4">
          {!gw.managed ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold text-ink-muted leading-relaxed max-w-xl">
                Or connect a number on Alpha&apos;s own gateway by scanning a QR — no Wapilot subscription for this line.
              </p>
              <button
                type="button"
                onClick={() => void gwAction("connect")}
                disabled={gwBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {gwBusy ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
                Connect by QR
              </button>
            </div>
          ) : gw.state === "open" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700" dir="ltr">
                <Check size={15} /> Connected on Alpha&apos;s gateway{gw.phone ? ` · +${gw.phone}` : ""}
              </span>
              <button
                type="button"
                onClick={() => void gwAction("disconnect")}
                disabled={gwBusy}
                className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink-muted transition hover:text-red-600 disabled:opacity-50"
              >
                {gwBusy ? <Loader2 size={15} className="animate-spin" /> : <Unplug size={15} />}
                Disconnect
              </button>
            </div>
          ) : gw.state === "qr" && gw.qr ? (
            <div className="flex flex-col sm:flex-row items-center gap-5">
              {/* A data URL that changes every few seconds; next/image has nothing to optimise here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={gw.qr} alt="WhatsApp QR" width={208} height={208} className="rounded-xl border border-line bg-white p-2 shrink-0" />
              <ol className="text-xs font-semibold text-ink-muted leading-relaxed list-decimal ps-4 space-y-1.5">
                <li>Open WhatsApp on the phone that will be the alerts line.</li>
                <li>Settings → Linked devices → Link a device.</li>
                <li>Scan this code. It refreshes on its own if it expires.</li>
              </ol>
            </div>
          ) : gw.state === "restricted" ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 leading-relaxed">
                Sending is paused: WhatsApp refused the connection or logged this device out repeatedly, which is what a
                restriction looks like. Owner alerts on this line are held. Check WhatsApp on the phone, then Resume.
                {gw.lastError ? ` (${gw.lastError})` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void gwAction("resume")} disabled={gwBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">
                  {gwBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Resume
                </button>
                <button type="button" onClick={() => void gwAction("relink")} disabled={gwBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-muted disabled:opacity-50">
                  <QrCode size={14} /> New QR
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs font-bold text-ink-muted">
                <Loader2 size={14} className="animate-spin" />
                {gw.state === "missing"
                  ? "The connection is gone from the gateway — connect again."
                  : gw.state === "logged_out"
                    ? "The phone logged this device out — a new QR is coming."
                    : "Connecting…"}
              </span>
              <div className="flex gap-2">
                {gw.state === "missing" ? (
                  <button type="button" onClick={() => void gwAction("connect")} disabled={gwBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                    <QrCode size={14} /> Connect by QR
                  </button>
                ) : (
                  <button type="button" onClick={() => void gwAction("relink")} disabled={gwBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-muted disabled:opacity-50">
                    <RefreshCw size={14} /> New QR
                  </button>
                )}
                <button type="button" onClick={() => void gwAction("disconnect")} disabled={gwBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-muted hover:text-red-600 disabled:opacity-50">
                  <Unplug size={14} /> Disconnect
                </button>
              </div>
            </div>
          )}
          {gw.managed && gw.state === "open" && gw.sending && (
            <p className="mt-3 text-[11px] font-bold text-ink-muted">
              {gw.sending.waiting > 0 && gw.sending.nextOpenAt
                ? `${gw.sending.waiting} message${gw.sending.waiting === 1 ? "" : "s"} waiting — sending resumes at ${new Date(gw.sending.nextOpenAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })} Cairo`
                : `Today: ${gw.sending.sentToday} of ${gw.sending.dailyCap} first-contact messages allowed`}
            </p>
          )}
        </div>
      )}

      {/* The Wapilot form. Hidden while the line is on our gateway: the fields would only show
          the gateway's own instance id and a token nobody should re-type. */}
      {!gw?.managed && (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className={LABEL}>Wapilot instance ID</label>
          <input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className={INPUT} placeholder="instance id" dir="ltr" />
        </div>
        <div>
          <label className={LABEL}>API token {status?.tokenSet ? "(stored — leave blank to keep)" : ""}</label>
          <input
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            className={INPUT}
            placeholder={status?.tokenSet ? "••••••••" : "token"}
            type="password"
            autoComplete="off"
            dir="ltr"
          />
        </div>
        <div>
          <label className={LABEL}>Number on this line (for your own reference)</label>
          <input value={phoneHint} onChange={(e) => setPhoneHint(e.target.value)} className={INPUT} placeholder="+2010…" dir="ltr" />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null || !instanceId.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save
        </button>
        {status?.configured && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink-muted transition hover:text-red-600 disabled:opacity-50"
          >
            {busy === "clear" ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Disconnect
          </button>
        )}
      </div>
      </>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <label className={LABEL}>Send a test to</label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className={`${INPUT} sm:w-64`}
            placeholder="+2015…"
            dir="ltr"
          />
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy !== null || !status?.configured || testTo.trim().length < 8}
            className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-ink transition hover:border-indigo-500 disabled:opacity-50"
          >
            {busy === "test" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Send test
          </button>
          {status?.lastTest && (
            <span className={`text-xs font-bold ${status.lastTest.ok ? "text-emerald-700" : "text-red-600"}`}>
              Last test {status.lastTest.ok ? "delivered to" : "failed for"} {status.lastTest.to}
              {status.lastTest.error ? ` — ${status.lastTest.error}` : ""} ({status.lastTest.at.slice(0, 16).replace("T", " ")})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
