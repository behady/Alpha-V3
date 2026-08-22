"use client";

/**
 * Asks what should happen to a visit's recorded treatments before the visit is deleted.
 *
 * Deleting a booking is an administrative act. Deleting the record of a tooth being drilled is
 * not, and the two used to be the same button — except the cleanup it attempted was querying a
 * field nothing has ever written, so in practice it deleted the appointment and silently stranded
 * every treatment recorded against it.
 *
 * Now the choice is explicit and the consequence is on screen: each treatment is listed with what
 * it cost and what has been paid, and "delete them too" is offered only when no money has been
 * collected — because a payment pointing at a deleted charge is not something a clinic can
 * reconcile afterwards.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { previewAppointmentDelete, type VisitService } from "@/lib/moneyApi";

type Props = {
  appointmentId: string;
  patientName?: string;
  onCancel: () => void;
  onConfirm: (servicesAction: "keep" | "delete") => void | Promise<void>;
};

export default function DeleteAppointmentDialog({ appointmentId, patientName, onCancel, onConfirm }: Props) {
  const { language } = useLanguage();
  const ar = language === "ar";

  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<VisitService[]>([]);
  const [hasPayments, setHasPayments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"keep" | "delete" | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    previewAppointmentDelete(appointmentId)
      .then((preview) => {
        if (cancelled) return;
        setServices(preview.services);
        setHasPayments(preview.hasPayments);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not check this appointment.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  const txt = {
    title: ar ? "حذف الموعد" : "Delete appointment",
    checking: ar ? "بنشوف الموعد ده فيه إيه…" : "Checking what this visit holds…",
    noServices: ar
      ? "مفيش علاجات متسجلة على الموعد ده. هيتحذف الموعد بس."
      : "No treatments are recorded against this visit. Only the appointment will be deleted.",
    intro: ar
      ? "الموعد ده عليه علاجات متسجلة. عايز تعمل بيها إيه؟"
      : "This visit has treatments recorded against it. What should happen to them?",
    keep: ar ? "احتفظ بالعلاجات" : "Keep the treatments",
    keepHint: ar
      ? "هتفضل في سجل المريض تحت القسم العام، بتاريخها وحسابها."
      : "They stay in the patient's record under the general section, with their dates and charges.",
    deleteToo: ar ? "احذف العلاجات كمان" : "Delete the treatments too",
    deleteTooHint: ar
      ? "هيتشال العلاج وحسابه نهائياً."
      : "The treatments and their charges are removed permanently.",
    blocked: ar
      ? "مش هينفع تتحذف: في مدفوعات متسجلة على العلاجات دي. امسح المدفوعات الأول لو لازم."
      : "Not available: payments have been recorded against these treatments. Delete the payments first if you really need to.",
    deleteOnly: ar ? "احذف الموعد" : "Delete appointment",
    cancel: ar ? "إلغاء" : "Cancel",
    paid: ar ? "مدفوع" : "paid",
    egp: ar ? "ج.م" : "EGP",
  };

  const body = (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" dir={ar ? "rtl" : "ltr"}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h2 className="text-base font-black text-slate-800">{txt.title}</h2>
              {patientName && <p className="text-xs font-medium text-slate-500">{patientName}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={!!submitting}
            aria-label={txt.cancel}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm font-medium text-slate-500">
              <Loader2 size={16} className="animate-spin" /> {txt.checking}
            </p>
          ) : error ? (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>
          ) : services.length === 0 ? (
            <p className="text-sm font-medium text-slate-600">{txt.noServices}</p>
          ) : (
            <>
              <p className="mb-3 text-sm font-medium text-slate-600">{txt.intro}</p>
              <ul className="space-y-2">
                {services.map((s) => (
                  <li key={s.noteId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{s.name}</p>
                      {s.tooth && s.tooth !== "Gen" && (
                        <p className="text-[11px] font-medium text-slate-500">{ar ? "أسنان" : "Teeth"}: {s.tooth}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-black tabular-nums text-slate-700">
                        {s.cost.toLocaleString()} <span className="text-[10px] text-slate-400">{txt.egp}</span>
                      </p>
                      {s.paid > 0 && (
                        <p className="text-[11px] font-bold tabular-nums text-emerald-600">
                          {s.paid.toLocaleString()} {txt.paid}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {hasPayments && (
                <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">{txt.blocked}</p>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
          {services.length === 0 ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={!!submitting}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {txt.cancel}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setSubmitting("keep");
                  try {
                    await onConfirm("keep");
                  } finally {
                    setSubmitting(null);
                  }
                }}
                disabled={loading || !!submitting || !!error}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {submitting === "keep" ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {txt.deleteOnly}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Keep is first and styled as the safe path — the treatments are clinical history. */}
              <button
                type="button"
                onClick={async () => {
                  setSubmitting("keep");
                  try {
                    await onConfirm("keep");
                  } finally {
                    setSubmitting(null);
                  }
                }}
                disabled={loading || !!submitting || !!error}
                className="w-full rounded-xl bg-slate-800 px-4 py-3 text-left text-white transition hover:bg-slate-900 disabled:opacity-50"
              >
                <span className="flex items-center gap-2 text-sm font-bold">
                  {submitting === "keep" && <Loader2 size={14} className="animate-spin" />}
                  {txt.keep}
                </span>
                <span className="mt-0.5 block text-[11px] font-medium text-white/70">{txt.keepHint}</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setSubmitting("delete");
                  try {
                    await onConfirm("delete");
                  } finally {
                    setSubmitting(null);
                  }
                }}
                disabled={loading || !!submitting || !!error || hasPayments}
                title={hasPayments ? txt.blocked : undefined}
                className="w-full rounded-xl border border-rose-200 bg-white px-4 py-3 text-left text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2 text-sm font-bold">
                  {submitting === "delete" && <Loader2 size={14} className="animate-spin" />}
                  {txt.deleteToo}
                </span>
                <span className="mt-0.5 block text-[11px] font-medium text-rose-500">
                  {hasPayments ? txt.blocked : txt.deleteTooHint}
                </span>
              </button>

              <button
                type="button"
                onClick={onCancel}
                disabled={!!submitting}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {txt.cancel}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(body, document.body);
}
