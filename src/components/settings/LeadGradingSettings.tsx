"use client";

import { useEffect, useMemo, useState } from "react";
import { limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Check, Flame, Loader2, RefreshCw, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { currentClinicId, getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import type { SettingsPanelProps } from "@/components/settings/panels";

/**
 * Lead grading: the AI watches the desk, drafts the clinic's grading flow weekly, an admin
 * approves it — and only then does the AI's grade show on the Leads page.
 *
 * Everything here is read live and written through /api/leads/grading-flow (admin-only, Admin
 * SDK). The card is honest about the learning stage: below the threshold it shows how many
 * graded leads it still needs rather than pretending to have learned.
 */

type Flow = {
  id: string;
  weekKey: string;
  status: "pending" | "approved" | "rejected";
  text: string;
  editedText?: string;
  profile?: string;
  changes?: string;
  stats?: { leads: number; staffGraded: number; agreementPct: number | null; converted: number; byStaffGrade?: { hot: number; warm: number; cold: number } };
  generatedAtMs?: number;
};

type Settings = {
  enabled?: boolean;
  approvedFlow?: { text: string; weekKey: string; approvedAtMs: number; profile?: string } | null;
  stats?: { leads: number; staffGraded: number; agreementPct: number | null; converted: number };
  threshold?: number;
  pendingWeek?: string;
};

const CARD = "rounded-2xl xl:rounded-3xl bg-surface border border-line shadow-sm ring-1 ring-line p-5 xl:p-6 flex flex-col gap-4";
const BTN = "inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition-opacity disabled:opacity-50";

export default function LeadGradingSettings({ canEdit }: SettingsPanelProps) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { showToast } = useUI();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const unsubS = onSnapshot(getClinicDoc("settings", "lead_grading"), (snap) => setSettings((snap.data() as Settings) || {}), () => setSettings({}));
    const unsubF = onSnapshot(
      query(getClinicCollection("lead_flows"), orderBy("generatedAtMs", "desc"), limit(8)),
      (snap) => setFlows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Flow, "id">) }))),
      () => setFlows([])
    );
    return () => { unsubS(); unsubF(); };
  }, []);

  const pending = useMemo(() => flows.find((f) => f.status === "pending") || null, [flows]);
  const history = useMemo(() => flows.filter((f) => f.status !== "pending"), [flows]);
  const enabled = settings?.enabled !== false;
  const approved = settings?.approvedFlow?.text ? settings.approvedFlow : null;
  const threshold = settings?.threshold || 10;
  const graded = settings?.stats?.staffGraded ?? 0;

  const call = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/leads/grading-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId: currentClinicId() || "", ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || "Failed"));
      return data;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", "error");
      return null;
    } finally {
      setBusy("");
    }
  };

  const fmtDate = (ms?: number) => (ms ? new Date(ms).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" }) : "");

  return (
    <div className="space-y-5">
      {/* The switch and where the learning stands. */}
      <section className={CARD}>
        <div className="flex items-center gap-2 text-accent">
          <Flame size={18} />
          <h3 className="text-sm font-black uppercase tracking-wider text-ink">{isAr ? "تقييم العملاء المحتملين" : "Lead grading"}</h3>
        </div>
        <p className="text-xs text-ink-body leading-relaxed">
          {isAr
            ? "الاستقبال بتعلّم على كل عميل ساخن 🔥 / دافي 🌤️ / بارد ❄️ من صفحة العملاء المحتملين. المساعد بيراقب في صمت: بيقيّم نفس العملاء من المحادثة وبيقارن نفسه بالاستقبال. كل أسبوع بيكتب «فلو التقييم» بتاع العيادة دي عشان تعتمده أو تعدّله — وتقييمه ميظهرش لحد ما تعتمد فلو."
            : "The desk marks each lead hot 🔥 / warm 🌤️ / cold ❄️ on the Leads page. The assistant watches silently: it grades the same leads from the chat and compares itself with the desk. Every week it drafts this clinic's own grading flow for you to approve or edit — its grade stays hidden until a flow is approved."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canEdit || busy !== ""}
            onClick={() => void call({ action: "toggle", enabled: !enabled }, "toggle")}
            className={`${BTN} ${enabled ? "bg-surface-subtle border border-line text-ink" : "bg-accent text-ink"}`}
          >
            {busy === "toggle" ? <Loader2 size={14} className="animate-spin" /> : null}
            {enabled ? (isAr ? "اقفل المراقبة" : "Turn off") : isAr ? "شغّل المراقبة" : "Turn on"}
          </button>
          <span className="text-xs font-bold text-ink-muted">
            {enabled
              ? approved
                ? isAr ? `شغال بفلو معتمد (${approved.weekKey}) — تقييم المساعد ظاهر للاستقبال` : `Live with an approved flow (${approved.weekKey}) — the AI grade shows to the desk`
                : isAr ? `بيتعلم — الاستقبال قيّمت ${graded} من ${threshold} عميل محتاجينهم لأول فلو` : `Learning — the desk graded ${graded} of the ${threshold} leads needed for a first draft`
              : isAr ? "مقفول — مفيش تقييم آلي ولا تعلّم" : "Off — no AI grading and no learning"}
          </span>
          {enabled && canEdit && (
            <button type="button" disabled={busy !== ""} onClick={() => void call({ action: "draft" }, "draft").then((r) => r && showToast(r.generated ? (isAr ? "اتكتب فلو جديد ✅" : "A draft was written ✅") : (isAr ? `لسه بدري: ${r.staffGraded} عميل متقيّم بس` : `Too early: only ${r.staffGraded} graded leads`), r.generated ? "success" : "info"))} className={`${BTN} bg-surface-subtle border border-line text-ink`}>
              {busy === "draft" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {isAr ? "اكتب فلو دلوقتي" : "Draft now"}
            </button>
          )}
        </div>
        {settings?.stats && (
          <p className="text-[11px] font-semibold text-ink-muted">
            {isAr
              ? `آخر أسبوع: ${settings.stats.leads} عميل · الاستقبال قيّمت ${settings.stats.staffGraded} · المساعد اتفق معاها ${settings.stats.agreementPct === null ? "—" : `${settings.stats.agreementPct}%`} · ${settings.stats.converted} حجزوا`
              : `Last week: ${settings.stats.leads} leads · desk graded ${settings.stats.staffGraded} · AI agreed ${settings.stats.agreementPct === null ? "—" : `${settings.stats.agreementPct}%`} · ${settings.stats.converted} booked`}
          </p>
        )}
      </section>

      {/* The draft waiting for a decision. */}
      {pending && (
        <section className={`${CARD} border-warn/40`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-black text-ink">{isAr ? `فلو جديد مستني اعتمادك — ${pending.weekKey}` : `A new flow awaits your decision — ${pending.weekKey}`}</h3>
            <span className="text-[11px] font-bold text-ink-muted">{fmtDate(pending.generatedAtMs)}</span>
          </div>
          {pending.changes && <p className="text-xs text-ink-body leading-relaxed rounded-xl bg-warn-tint border border-warn/25 p-3" dir="auto">{pending.changes}</p>}
          {pending.stats && (
            <p className="text-[11px] font-semibold text-ink-muted">
              {isAr
                ? `اتبنى على ${pending.stats.staffGraded} تقييم من الاستقبال (🔥 ${pending.stats.byStaffGrade?.hot ?? 0} · 🌤️ ${pending.stats.byStaffGrade?.warm ?? 0} · ❄️ ${pending.stats.byStaffGrade?.cold ?? 0}) — المساعد كان متفق معاها ${pending.stats.agreementPct === null ? "—" : `${pending.stats.agreementPct}%`}`
                : `Built on ${pending.stats.staffGraded} desk grades (🔥 ${pending.stats.byStaffGrade?.hot ?? 0} · 🌤️ ${pending.stats.byStaffGrade?.warm ?? 0} · ❄️ ${pending.stats.byStaffGrade?.cold ?? 0}) — the AI agreed ${pending.stats.agreementPct === null ? "—" : `${pending.stats.agreementPct}%`} of the time`}
            </p>
          )}
          <textarea
            dir="auto"
            value={draft ?? pending.editedText ?? pending.text}
            onChange={(e) => setDraft(e.target.value)}
            // Edits are kept the moment the box loses focus, so leaving the page mid-edit loses
            // nothing: the draft document carries them until Approve or Reject.
            onBlur={() => { if (canEdit && draft !== null && draft !== (pending.editedText ?? pending.text)) void call({ action: "edit", weekKey: pending.weekKey, text: draft }, "edit"); }}
            disabled={!canEdit}
            rows={14}
            className="w-full rounded-xl border border-line bg-surface-subtle px-4 py-3 text-sm font-medium text-ink leading-relaxed outline-none focus:border-accent focus:bg-surface"
          />
          {pending.profile && (
            <details className="text-xs text-ink-body">
              <summary className="cursor-pointer font-bold text-ink">{isAr ? "شكل الناس اللي بتحجز هنا" : "What the people who book here look like"}</summary>
              <p className="mt-2 whitespace-pre-line leading-relaxed" dir="auto">{pending.profile}</p>
            </details>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== ""} onClick={() => void call({ action: "approve", weekKey: pending.weekKey, text: draft ?? pending.editedText ?? pending.text }, "approve").then((r) => { if (r) { setDraft(null); showToast(isAr ? "اتعتمد ✅ المساعد هيقيّم بيه من دلوقتي" : "Approved ✅ the assistant grades by it from now on", "success"); } })} className={`${BTN} bg-accent text-ink`}>
                {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {draft !== null && draft !== (pending.editedText ?? pending.text) ? (isAr ? "اعتمد بتعديلاتي" : "Approve with my edits") : isAr ? "اعتمد" : "Approve"}
              </button>
              <button type="button" disabled={busy !== ""} onClick={() => void call({ action: "reject", weekKey: pending.weekKey }, "reject").then((r) => { if (r) { setDraft(null); showToast(isAr ? "اترفض — الفلو الحالي زي ما هو" : "Rejected — the current flow stays", "info"); } })} className={`${BTN} bg-surface-subtle border border-line text-ink`}>
                {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                {isAr ? "ارفض" : "Reject"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* The flow in force. */}
      <section className={CARD}>
        <h3 className="text-sm font-black text-ink">{isAr ? "الفلو المعتمد" : "The approved flow"}</h3>
        {approved ? (
          <>
            <p className="text-[11px] font-bold text-ink-muted">{isAr ? `اتعتمد ${fmtDate(approved.approvedAtMs)} (${approved.weekKey})` : `Approved ${fmtDate(approved.approvedAtMs)} (${approved.weekKey})`}</p>
            <p className="text-sm text-ink whitespace-pre-line leading-relaxed rounded-xl bg-surface-subtle border border-line p-4" dir="auto">{approved.text}</p>
            {approved.profile && (
              <details className="text-xs text-ink-body">
                <summary className="cursor-pointer font-bold text-ink">{isAr ? "شكل الناس اللي بتحجز هنا" : "What the people who book here look like"}</summary>
                <p className="mt-2 whitespace-pre-line leading-relaxed" dir="auto">{approved.profile}</p>
              </details>
            )}
          </>
        ) : (
          <p className="text-xs text-ink-muted font-semibold">
            {isAr
              ? "لسه مفيش. أول فلو بييجي يوم الاتنين بعد ما الاستقبال تقيّم كفاية عملاء — أو اضغط «اكتب فلو دلوقتي» فوق."
              : "None yet. The first draft arrives on a Monday once the desk has graded enough leads — or press “Draft now” above."}
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section className={CARD}>
          <h3 className="text-sm font-black text-ink">{isAr ? "الأسابيع اللي فاتت" : "Earlier weeks"}</h3>
          <ul className="divide-y divide-line">
            {history.map((f) => (
              <li key={f.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-ink">{f.weekKey}</span>
                <span className="text-ink-muted">{f.stats ? `${f.stats.staffGraded} ${isAr ? "تقييم" : "graded"} · ${f.stats.agreementPct === null ? "—" : `${f.stats.agreementPct}%`}` : ""}</span>
                <span className={`font-black px-2 py-0.5 rounded-full ${f.status === "approved" ? "bg-ok-tint text-ok" : "bg-surface-muted text-ink-muted"}`}>
                  {f.status === "approved" ? (isAr ? "معتمد" : "approved") : isAr ? "مرفوض" : "rejected"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
