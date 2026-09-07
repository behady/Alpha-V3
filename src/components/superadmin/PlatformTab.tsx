"use client";

import React, { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { AlertTriangle, CalendarClock, Check, Eye, Loader2, Save, ShieldAlert, Timer } from "lucide-react";
import { useUI } from "@/context/UIContext";
import {
  DEFAULT_TRIAL_POLICY,
  MAX_TRIAL_DAYS,
  MIN_TRIAL_DAYS,
  PLATFORM_SETTINGS_COLLECTION,
  TRIAL_POLICY_DOC,
  normalizeTrialPolicy,
  type TrialPolicy,
} from "@/lib/trialPolicy";

/**
 * Platform-wide settings: today, the one that decides when a free trial stops accepting writes.
 *
 * This screen is the reason `expiresAt` finally means something. Every enforcement layer has been
 * in place for a while — `firestore.rules` refuses writes past the date, `lib/clinicStatus.ts`
 * mirrors it for the Admin SDK routes that bypass rules, and the dashboard already renders the
 * read-only banner explaining it — but nothing ever wrote the field, so a self-signup trial ran
 * forever. Signup now stamps it from the policy saved here.
 *
 * Written straight from the browser rather than through a route: `platform_settings` is
 * superadmin-WRITE in the rules, which is the same boundary a route would re-derive, and the
 * clinics table on the next tab already writes `clinics` this way. (Reads are open to any
 * signed-in user — the dashboard needs `warnWithinDays` for its countdown banner.)
 *
 * The backfill below is deliberately awkward to do by accident. It reaches clinics that were
 * created when "no expiry" was the honest answer, some of which are real customers working in the
 * system today, so it previews first and applies only on a second, explicit press.
 */

type PlanRow = {
  clinicId: string;
  name: string;
  createdAt: string | null;
  expiresAt: string;
  flooredToGrace: boolean;
};

type BackfillResult = {
  ok: boolean;
  applied: boolean;
  total: number;
  flooredCount: number;
  written?: number;
  graceDays: number;
  plan: PlanRow[];
};

const CARD = "bg-surface rounded-[2rem] border border-slate-200/60 shadow-sm p-6 md:p-8";
const LABEL = "text-xs font-bold text-ink-muted block mb-1.5";
const INPUT =
  "w-full bg-surface border border-line text-slate-700 text-sm font-bold rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500";

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

export function PlatformTab() {
  const { showToast, confirm } = useUI();

  const [policy, setPolicy] = useState<TrialPolicy>(DEFAULT_TRIAL_POLICY);
  const [savedPolicy, setSavedPolicy] = useState<TrialPolicy>(DEFAULT_TRIAL_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /** Nothing has ever been saved — the defaults on screen are code's, not a decision anyone made. */
  const [neverSaved, setNeverSaved] = useState(false);

  const [graceDays, setGraceDays] = useState(7);
  const [backfilling, setBackfilling] = useState(false);
  const [backfill, setBackfill] = useState<BackfillResult | null>(null);

  const policyRef = doc(db, PLATFORM_SETTINGS_COLLECTION, TRIAL_POLICY_DOC);

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDoc(policyRef);
        const next = snap.exists() ? normalizeTrialPolicy(snap.data()) : DEFAULT_TRIAL_POLICY;
        setPolicy(next);
        setSavedPolicy(next);
        setNeverSaved(!snap.exists());
      } catch {
        showToast("Could not read the trial policy — showing defaults.", "error");
      } finally {
        setLoading(false);
      }
    })();
    // Once, on mount. `policyRef` is a fresh object each render and is not a real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = JSON.stringify(policy) !== JSON.stringify(savedPolicy) || neverSaved;

  const savePolicy = useCallback(async () => {
    setSaving(true);
    try {
      // Normalised on the way in as well as on the way out. The clamp is the only thing standing
      // between a mistyped "1400" in the days box and a four-year free trial.
      const clean = normalizeTrialPolicy(policy);
      await setDoc(policyRef, { ...clean, updatedAt: new Date() }, { merge: true });
      setPolicy(clean);
      setSavedPolicy(clean);
      setNeverSaved(false);
      showToast("Trial policy saved. It applies to clinics created from now on.", "success");
    } catch {
      showToast("Could not save the trial policy.", "error");
    } finally {
      setSaving(false);
    }
  }, [policy, policyRef, showToast]);

  const runBackfill = useCallback(
    async (apply: boolean) => {
      setBackfilling(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Session expired. Sign in again.");

        const res = await fetch("/api/admin/backfill-trial-expiry", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ apply, graceDays }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Backfill failed.");

        setBackfill(data as BackfillResult);
        showToast(
          apply
            ? `Gave an end date to ${data.written} trial ${data.written === 1 ? "clinic" : "clinics"}.`
            : `${data.total} trial ${data.total === 1 ? "clinic has" : "clinics have"} no end date.`,
          "success",
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Backfill failed.", "error");
      } finally {
        setBackfilling(false);
      }
    },
    [graceDays, showToast],
  );

  const applyBackfill = useCallback(async () => {
    if (!backfill || backfill.total === 0) return;
    const floored = backfill.flooredCount;
    const ok = await confirm(
      `Give an end date to ${backfill.total} trial ${backfill.total === 1 ? "clinic" : "clinics"}?` +
        (floored > 0
          ? ` ${floored} of them signed up longer ago than the trial length, so they get the ` +
            `${graceDays}-day grace period instead of a date in the past.`
          : "") +
        " After the date passes, these clinics become read-only.",
    );
    if (ok) await runBackfill(true);
  }, [backfill, confirm, graceDays, runBackfill]);

  if (loading) {
    return (
      <div className="p-16 flex justify-center">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* --- The policy ------------------------------------------------------------------- */}
      <div className={CARD}>
        <div className="flex items-start gap-3 mb-6">
          <span className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Timer size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black text-ink tracking-tight">Free trial</h2>
            <p className="text-xs font-semibold text-ink-muted mt-0.5 leading-relaxed max-w-2xl">
              Sets the end date stamped onto every clinic created from now on. Once that date
              passes the clinic goes read-only — records stay readable, new entries stop — and the
              clinic is told why. Per-clinic dates on the Clinics tab always win over this.
            </p>
          </div>
        </div>

        {neverSaved && (
          <p className="mb-5 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            No policy has been saved yet, so these are the built-in defaults. Signup already uses
            them; saving here makes the choice explicit and editable without a deploy.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={LABEL}>Trial length (days)</label>
            <input
              type="number"
              min={MIN_TRIAL_DAYS}
              max={MAX_TRIAL_DAYS}
              value={policy.trialDays}
              disabled={!policy.expireTrials}
              onChange={(e) => setPolicy((p) => ({ ...p, trialDays: Number(e.target.value) }))}
              className={`${INPUT} disabled:opacity-50`}
            />
            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
              {MIN_TRIAL_DAYS}–{MAX_TRIAL_DAYS}. Counted from the moment the clinic is created.
            </p>
          </div>

          <div>
            <label className={LABEL}>Warn the clinic within (days)</label>
            <input
              type="number"
              min={0}
              max={policy.trialDays}
              value={policy.warnWithinDays}
              disabled={!policy.expireTrials}
              onChange={(e) => setPolicy((p) => ({ ...p, warnWithinDays: Number(e.target.value) }))}
              className={`${INPUT} disabled:opacity-50`}
            />
            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
              A countdown banner appears this many days before the end. 0 switches it off.
            </p>
          </div>

          <div>
            <label className={LABEL}>Trials expire</label>
            <button
              type="button"
              onClick={() => setPolicy((p) => ({ ...p, expireTrials: !p.expireTrials }))}
              className={`w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${
                policy.expireTrials
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-line bg-surface-subtle text-ink-muted"
              }`}
            >
              {policy.expireTrials ? "On" : "Off"}
              <span
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  policy.expireTrials ? "bg-emerald-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                    policy.expireTrials ? "left-[1.15rem]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
            <p className="mt-1.5 text-[11px] font-semibold text-slate-400">
              Off means new clinics get no end date at all — trials run indefinitely, as they did
              before this setting existed.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => void savePolicy()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save policy
          </button>
          {!dirty && !saving && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
              <Check size={14} /> Saved
            </span>
          )}
        </div>
      </div>

      {/* --- The backfill ----------------------------------------------------------------- */}
      <div className={CARD}>
        <div className="flex items-start gap-3 mb-6">
          <span className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <CalendarClock size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-black text-ink tracking-tight">
              Trials with no end date
            </h2>
            <p className="text-xs font-semibold text-ink-muted mt-0.5 leading-relaxed max-w-2xl">
              Clinics created before signup started stamping an end date have none, so they never
              expire. Saving a policy above does not reach them — this does. Preview first: some of
              these are real customers who have been working in the system for months.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <label className={LABEL}>Minimum notice (days)</label>
            <input
              type="number"
              min={0}
              max={365}
              value={graceDays}
              onChange={(e) => setGraceDays(Number(e.target.value))}
              className={INPUT}
            />
          </div>
          <button
            onClick={() => void runBackfill(false)}
            disabled={backfilling}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-subtle px-5 py-2.5 text-sm font-bold text-ink-body transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            {backfilling ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
            Preview
          </button>
          {backfill && !backfill.applied && backfill.total > 0 && (
            <button
              onClick={() => void applyBackfill()}
              disabled={backfilling}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-40"
            >
              <ShieldAlert size={16} />
              Apply to {backfill.total} {backfill.total === 1 ? "clinic" : "clinics"}
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] font-semibold text-slate-400">
          Nobody loses access with less than this much warning, however long ago they signed up.
        </p>

        {backfill && (
          <div className="mt-6">
            {backfill.total === 0 ? (
              <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
                <Check size={15} /> Every trial clinic already has an end date. Nothing to do.
              </p>
            ) : (
              <>
                <p
                  className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs font-bold ${
                    backfill.applied
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {backfill.applied ? (
                    <Check size={15} className="mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  )}
                  {backfill.applied
                    ? `Done — ${backfill.written} ${backfill.written === 1 ? "clinic" : "clinics"} now have an end date.`
                    : `${backfill.total} ${backfill.total === 1 ? "clinic has" : "clinics have"} no end date. ` +
                      `Nothing has been changed yet.`}
                  {backfill.flooredCount > 0 &&
                    ` ${backfill.flooredCount} signed up longer ago than the trial length, so ${
                      backfill.flooredCount === 1 ? "it gets" : "they get"
                    } the ${backfill.graceDays}-day minimum notice instead of a date in the past.`}
                </p>

                <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-subtle text-[10px] font-black uppercase tracking-widest text-ink-muted">
                      <tr>
                        <th className="px-4 py-2.5">Clinic</th>
                        <th className="px-4 py-2.5">Signed up</th>
                        <th className="px-4 py-2.5">Would end</th>
                        <th className="px-4 py-2.5">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backfill.plan.map((row) => (
                        <tr key={row.clinicId} className="border-t border-line">
                          <td className="px-4 py-2.5">
                            <span className="font-bold text-ink">{row.name}</span>
                            <span className="ms-2 font-mono text-[10px] text-slate-400">
                              {row.clinicId}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-ink-muted tabular-nums">
                            {shortDate(row.createdAt)}
                          </td>
                          <td className="px-4 py-2.5 font-bold text-ink tabular-nums">
                            {shortDate(row.expiresAt)}
                          </td>
                          <td className="px-4 py-2.5">
                            {row.flooredToGrace && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                grace period
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
