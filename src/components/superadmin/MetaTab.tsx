"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Facebook, Link2, Loader2, Plug, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { auth } from "@/lib/firebase";

/**
 * Facebook page ↔ clinic connections — the two-dropdowns-and-a-button screen.
 *
 * Pages appear here automatically once a customer partner-shares their page and it is
 * assigned to the platform's system user; connecting one takes over from there (page token,
 * webhook subscription, clinic mapping) with no consoles and no scripts.
 */

interface MetaPage {
  id: string;
  name: string;
}
interface MetaConnection {
  pageId: string;
  pageName: string;
  clinicId: string;
  enabled: boolean;
}
interface ClinicOption {
  id: string;
  name: string;
}

export function MetaTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [connections, setConnections] = useState<MetaConnection[]>([]);
  const [clinics, setClinics] = useState<ClinicOption[]>([]);

  const [selPage, setSelPage] = useState("");
  const [selClinic, setSelClinic] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const authedFetch = useCallback(async (init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken();
    return fetch("/api/admin/meta-connections", {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authedFetch();
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Failed to load");
      setPages(body.pages);
      setConnections(body.connections);
      setClinics(body.clinics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (payload: Record<string, string>) => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const res = await authedFetch({ method: "POST", body: JSON.stringify(payload) });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Failed");
      setNotice(payload.action === "disconnect" ? "Connection paused." : `Connected "${body.pageName}" — leads now flow to the selected clinic.`);
      setSelPage("");
      setSelClinic("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const clinicName = (id: string) => clinics.find((c) => c.id === id)?.name || id;
  const unconnectedPages = pages.filter((p) => !connections.some((c) => c.pageId === p.id && c.enabled));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 flex items-center justify-center rounded-xl">
            <Facebook size={20} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900">Facebook Lead Connections</h3>
            <p className="text-xs text-slate-500">
              Pages shared with your business appear here. Connect one to a clinic and its form leads flow into that clinic&apos;s
              Leads inbox.
            </p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold rounded-2xl p-4">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold rounded-2xl p-4">{notice}</div>}

      {/* Connect box */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <PlugZap size={18} className="text-indigo-600" />
          <h4 className="font-bold text-slate-900">Connect a page to a clinic</h4>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <select
            value={selPage}
            onChange={(e) => setSelPage(e.target.value)}
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-indigo-500"
          >
            <option value="">{unconnectedPages.length === 0 ? "No unconnected pages — share one with your business first" : "Choose a Facebook page…"}</option>
            {unconnectedPages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={selClinic}
            onChange={(e) => setSelClinic(e.target.value)}
            className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-indigo-500"
          >
            <option value="">Choose a clinic…</option>
            {clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void act({ action: "connect", pageId: selPage, clinicId: selClinic })}
            disabled={busy || !selPage || !selClinic}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black uppercase tracking-wide transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />} Connect
          </button>
        </div>
        <p className="text-[11px] text-slate-400 font-semibold mt-3">
          New customer? Send them your partner link, then assign their page to the system user in Business settings — it will
          appear here on the next refresh. New forms on a connected page need nothing: every form&apos;s leads arrive automatically.
        </p>
      </div>

      {/* Existing connections */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Link2 size={16} className="text-slate-500" />
          <h4 className="font-bold text-slate-900">Active connections</h4>
        </div>
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-slate-400 font-bold text-center py-10">No pages connected yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {connections.map((c) => (
              <div key={c.pageId} className="flex items-center gap-3 px-5 py-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-slate-800 truncate">{c.pageName || c.pageId}</p>
                  <p className="text-xs text-slate-500 font-semibold">
                    → {clinicName(c.clinicId)}
                    <span className="text-slate-300"> · </span>
                    <span dir="ltr">{c.pageId}</span>
                  </p>
                </div>
                <span
                  className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
                    c.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {c.enabled ? "ACTIVE" : "PAUSED"}
                </span>
                {c.enabled ? (
                  <button
                    onClick={() => void act({ action: "disconnect", pageId: c.pageId })}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
                  >
                    <Unplug size={13} /> Pause
                  </button>
                ) : (
                  <button
                    onClick={() => void act({ action: "connect", pageId: c.pageId, clinicId: c.clinicId })}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                  >
                    <Plug size={13} /> Resume
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
