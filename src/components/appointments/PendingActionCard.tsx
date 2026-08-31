"use client";

import { AlertTriangle, ArrowRight, CalendarClock, Loader2, MessageCircle, Wallet } from "lucide-react";

/**
 * The confirmation card for something the assistant has prepared but not done.
 *
 * Every field shown here was read back from the database (or, for a message, merged from the
 * clinic's own template) at the moment the action was staged — none of it is the model's
 * description of what it intends. That distinction is the whole point of the card: if the
 * assistant picked the wrong appointment, the user reads the wrong appointment's real details
 * rather than a confident summary of the right one.
 *
 * The shape is declared locally rather than imported from lib/aiPendingActions, which pulls in
 * firebase-admin — the same approach AiChatWidget takes.
 */

export interface PendingAction {
  id: string;
  kind: "delete" | "appointment_update" | "payment" | "whatsapp";
  collection: string;
  documentId: string;
  summary: Record<string, unknown>;
  title?: string;
  changes?: Array<{ label: string; from: string; to: string }>;
  messageBody?: string;
  recipient?: string;
  amount?: number;
  /** Plain-language explainer for an action whose mechanic isn't obvious from the diff alone. */
  note?: string;
}

const KIND_META = {
  appointment_update: { icon: CalendarClock, tone: "teal" },
  payment: { icon: Wallet, tone: "emerald" },
  whatsapp: { icon: MessageCircle, tone: "sky" },
  delete: { icon: AlertTriangle, tone: "rose" },
} as const;

const TONES = {
  teal: { ring: "border-teal-200", head: "bg-teal-50 border-teal-100", text: "text-teal-700", btn: "bg-teal-600 hover:bg-teal-700" },
  emerald: { ring: "border-emerald-200", head: "bg-emerald-50 border-emerald-100", text: "text-emerald-700", btn: "bg-emerald-600 hover:bg-emerald-700" },
  sky: { ring: "border-sky-200", head: "bg-sky-50 border-sky-100", text: "text-sky-700", btn: "bg-sky-600 hover:bg-sky-700" },
  rose: { ring: "border-rose-200", head: "bg-rose-50 border-rose-100", text: "text-rose-600", btn: "bg-rose-600 hover:bg-rose-700" },
} as const;

export default function PendingActionCard({
  action,
  isAr,
  resolving,
  onResolve,
}: {
  action: PendingAction;
  isAr: boolean;
  resolving: boolean;
  onResolve: (decision: "approve" | "reject") => void;
}) {
  const meta = KIND_META[action.kind] || KIND_META.delete;
  const tone = TONES[meta.tone];
  const Icon = meta.icon;

  const patientName = String(action.summary?.patientName || action.summary?.name || "");

  return (
    <div className={`bg-surface border ${tone.ring} rounded-2xl shadow-sm overflow-hidden`}>
      <div className={`px-4 py-2.5 border-b ${tone.head} flex items-center gap-2`}>
        <Icon size={14} className={tone.text} />
        <p className={`text-[11px] font-black uppercase tracking-widest ${tone.text}`}>
          {action.title || (isAr ? "تأكيد" : "Confirm")}
        </p>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {patientName && (
          <p className="text-[13px] font-black text-slate-800">{patientName}</p>
        )}

        {/* Appointment change — the diff is the point, so it gets the most room */}
        {action.kind === "appointment_update" && action.changes?.length ? (
          <div className="space-y-1.5">
            {action.changes.map((c) => (
              <div key={c.label} className="flex items-center gap-2 text-[12px]">
                <span className="text-slate-400 font-bold w-16 shrink-0">{c.label}</span>
                <span className="text-ink-muted line-through">{c.from}</span>
                <ArrowRight size={12} className="text-slate-300 shrink-0" />
                <span className="font-black text-slate-800">{c.to}</span>
              </div>
            ))}
          </div>
        ) : null}

        {action.note && (
          <p className="text-[11px] text-ink-muted bg-surface-subtle border border-slate-200/60 rounded-lg px-2.5 py-2 leading-relaxed">
            {action.note}
          </p>
        )}

        {/* Payment */}
        {action.kind === "payment" && (
          <div>
            <p className="text-2xl font-black text-ink leading-none">
              {Number(action.amount || 0).toLocaleString()}{" "}
              <span className="text-xs text-slate-400 font-bold">{isAr ? "ج.م" : "EGP"}</span>
            </p>
            {action.summary?.description ? (
              <p className="text-[12px] text-ink-muted font-bold mt-1">{String(action.summary.description)}</p>
            ) : null}
          </div>
        )}

        {/* WhatsApp — the exact text that will be sent, verbatim */}
        {action.kind === "whatsapp" && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-400">
              {isAr ? "إلى" : "To"} <span className="text-ink-body font-black" dir="ltr">{action.recipient}</span>
            </p>
            <div className="rounded-xl bg-surface-subtle border border-slate-200/60 px-3 py-2">
              <p className="text-[12px] text-slate-700 whitespace-pre-wrap leading-relaxed">{action.messageBody}</p>
            </div>
          </div>
        )}

        {/* Delete / anything else — identifying fields of the real record */}
        {action.kind === "delete" && (
          <div className="rounded-xl bg-surface-subtle border border-slate-200/60 px-3 py-2 space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{action.collection}</p>
            {Object.entries(action.summary || {}).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[12px]">
                <span className="text-slate-400 shrink-0">{key}</span>
                <span className="font-bold text-slate-700 break-all">{String(value)}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] font-bold text-slate-400 pt-0.5">
          {isAr ? "لن يحدث شيء حتى تؤكد." : "Nothing happens until you confirm."}
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onResolve("approve")}
            disabled={resolving}
            className={`flex-1 ${tone.btn} disabled:opacity-50 text-white px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-1.5`}
          >
            {resolving ? <Loader2 size={12} className="animate-spin" /> : null}
            {isAr ? "تأكيد" : "Confirm"}
          </button>
          <button
            onClick={() => onResolve("reject")}
            disabled={resolving}
            className="flex-1 bg-surface hover:bg-surface-subtle disabled:opacity-50 text-ink-body border border-line px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
