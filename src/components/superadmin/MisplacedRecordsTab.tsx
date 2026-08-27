"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Search, ShieldCheck } from "lucide-react";
import { auth } from "@/lib/firebase";

type Finding = {
  verdict: "misplaced" | "orphaned";
  heldByClinicName: string;
  belongsToClinicNames: string[];
  collection: string;
  documentId: string;
  patientId: string;
  type: string;
  date: string;
  amount: number | null;
};

type Report = {
  headline: string;
  summary: { checked: number; ok: number; misplaced: number; orphaned: number; unjudgeable: number };
  clinics: number;
  findings: Finding[];
};

/**
 * Finds ledger rows and clinical notes sitting in the wrong clinic's books.
 *
 * It reads and never writes, and there is no repair button here on purpose. Moving a payment
 * between clinics changes two clinics' revenue, two dentists' commission and a patient's balance on
 * both sides — an accounting decision with a paper trail behind it, made row by row by somebody who
 * can see both, not something to automate from a summary screen.
 */
export default function MisplacedRecordsTab() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("You are signed out. Sign in and try again.");
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/find-misplaced-records", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error || "Could not complete the check.");
      setReport(payload as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the check.");
    } finally {
      setRunning(false);
    }
  };

  const misplaced = report?.findings.filter((f) => f.verdict === "misplaced") ?? [];
  const orphaned = report?.findings.filter((f) => f.verdict === "orphaned") ?? [];

  return (
    <div className="space-y-6">
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
        <h3 className="text-lg font-black text-white flex items-center gap-2">
          <Search size={18} className="text-indigo-400" /> Records in the wrong clinic
        </h3>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Until 2026-08-26, most money and clinical writes did not tell the server which clinic they
          meant, so it fell back to the signed-in user&apos;s default one. Nearly all of those saves
          failed rather than landing wrong — a treatment checks the patient and the dentist belong to
          the clinic before it writes. What could slip through is a payment not tied to a treatment,
          which checks neither.
        </p>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          This looks for the fingerprint: a row naming a patient who does not exist in the clinic
          holding it, while another clinic has exactly that patient. It only reads.
        </p>
        <button
          onClick={run}
          disabled={running}
          className="mt-5 inline-flex items-center gap-2 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl transition-colors"
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {running ? "Checking every clinic…" : "Run the check"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 text-rose-200 text-sm font-semibold">
          {error}
        </div>
      )}

      {report && (
        <>
          <div
            className={`rounded-2xl p-5 border flex items-start gap-3 ${
              report.summary.misplaced > 0
                ? "bg-amber-500/10 border-amber-500/30 text-amber-100"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-100"
            }`}
          >
            {report.summary.misplaced > 0 ? (
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck size={18} className="shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-bold text-sm">{report.headline}</p>
              <p className="text-xs mt-1 opacity-80">
                {report.summary.checked} rows across {report.clinics} clinic(s) ·{" "}
                {report.summary.ok} in the right place · {report.summary.orphaned} patient not found ·{" "}
                {report.summary.unjudgeable} not checkable
              </p>
            </div>
          </div>

          {misplaced.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-700 text-xs font-black uppercase tracking-widest text-slate-400">
                In the wrong books ({misplaced.length})
              </div>
              <div className="divide-y divide-slate-700/60 max-h-[420px] overflow-y-auto">
                {misplaced.map((f) => (
                  <div key={`${f.collection}-${f.documentId}`} className="px-5 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-bold text-white">
                        {f.type || f.collection} {f.amount !== null && `· ${f.amount}`}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums">{f.date}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      sitting in <span className="text-rose-300 font-bold">{f.heldByClinicName}</span>
                      {" · belongs to "}
                      <span className="text-emerald-300 font-bold">{f.belongsToClinicNames.join(" / ")}</span>
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5 font-mono">
                      {f.collection}/{f.documentId} · patient {f.patientId}
                    </p>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-slate-700 text-xs text-slate-400 leading-relaxed">
                There is no move button, on purpose. Shifting a payment between clinics changes both
                clinics&apos; revenue, the dentist&apos;s commission and the patient&apos;s balance on
                each side. Decide these one at a time.
              </div>
            </div>
          )}

          {orphaned.length > 0 && (
            <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-5">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                Patient not found ({orphaned.length})
              </p>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                These name a patient no clinic has. Almost always a patient deleted since — the
                recycle bin removes the patient and leaves the ledger alone — so this is a loose end
                worth a look, not a clinic mix-up.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
