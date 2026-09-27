"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MessageCircle, Save, Send, Trash2 } from "lucide-react";
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
