"use client";

/**
 * The driver is here.
 *
 * One screen for the one moment: a lab's driver at the desk. He hands over what came back, usually
 * several pieces, and takes today's bags. Both used to mean finding each case on the board and
 * ticking it alone. Here the lab is chosen once, the returns are ticked together, and what leaves
 * goes out with one list he signs and one message to the lab.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MessageCircle, Phone, Printer, Send, Truck, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { PalmerList } from "@/components/lab/PalmerMark";
import { findLab, labMessagingNumber, type DentalLab } from "@/lib/dentalLabs";
import { labKeyOf } from "@/lib/labBag";
import { dueStateFor, statusLabel, workTypeLabel, type LabCase } from "@/lib/labCases";
import { loadLabOrderClinic, printLabPickup } from "@/lib/labOrderPrint";
import {
  buildPickupMessage,
  caseCountWord,
  draftsWaiting,
  leavingToday,
  outAtLab,
  roundLabs,
} from "@/lib/labRounds";
import { openWhatsAppWithText } from "@/lib/whatsappManual";

export default function LabDriverDialog({
  open,
  onClose,
  cases,
  labs,
  today,
  onReceive,
  onSendDrafts,
}: {
  open: boolean;
  onClose: () => void;
  /** The cases of the branch on screen. */
  cases: LabCase[];
  labs: DentalLab[];
  today: string;
  /** Sign the picked cases back in. Resolves with the ones that went through, in their new state. */
  onReceive: (picked: LabCase[]) => Promise<LabCase[]>;
  /** Mark the picked drafts as sent. */
  onSendDrafts: (picked: LabCase[]) => Promise<void>;
}) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const { clinic } = useClinic();
  const isAr = language === "ar";

  const rounds = useMemo(() => roundLabs(cases, today), [cases, today]);
  const [labKey, setLabKey] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "receive" | "drafts" | "print">("");
  /** What was just signed in, kept on screen so the patients can be called from here. */
  const [arrived, setArrived] = useState<LabCase[]>([]);

  // A fresh visit each time it opens. The lab is picked for the person when there is only one.
  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setArrived([]);
    setLabKey((current) => (rounds.some((r) => r.key === current) ? current : rounds.length === 1 ? rounds[0].key : ""));
    // Only on opening: re-running as cases change would untick what the person is ticking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const round = rounds.find((r) => r.key === labKey) || null;
  const mine = useMemo(() => cases.filter((c) => labKeyOf(c) === labKey), [cases, labKey]);
  const leaving = useMemo(() => leavingToday(mine, today), [mine, today]);
  const drafts = useMemo(() => draftsWaiting(mine), [mine]);
  // Work sent today cannot be what he is bringing back.
  const returnable = useMemo(() => {
    const goingOut = new Set(leaving.map((c) => c.id));
    return outAtLab(mine).filter((c) => !goingOut.has(c.id));
  }, [mine, leaving]);
  const labNumber = labMessagingNumber(findLab(labs, round?.labId || ""));

  if (!open) return null;

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = returnable.length > 0 && returnable.every((c) => picked.has(c.id));

  const receive = async () => {
    const chosen = returnable.filter((c) => picked.has(c.id));
    if (chosen.length === 0) return;
    setBusy("receive");
    try {
      const done = await onReceive(chosen);
      setArrived(done);
      setPicked(new Set());
      if (done.length < chosen.length) {
        showToast(isAr ? "بعض الحالات ماتسجلتش — جرّب تاني" : "Some cases were not saved. Try again.", "error");
      }
    } finally {
      setBusy("");
    }
  };

  const sendDrafts = async () => {
    setBusy("drafts");
    try {
      await onSendDrafts(drafts);
    } finally {
      setBusy("");
    }
  };

  const print = async () => {
    if (!round || leaving.length === 0) return;
    setBusy("print");
    try {
      const header = await loadLabOrderClinic(leaving[0].branchName);
      await printLabPickup({ labName: round.labName, cases: leaving, clinic: header, language, date: today });
    } catch (err) {
      console.error("Lab handover print failed", err);
      showToast(isAr ? "فشلت الطباعة" : "Could not print the list", "error");
    } finally {
      setBusy("");
    }
  };

  // Nothing awaited before the window opens: a browser only allows it during the click itself.
  const whatsapp = () => {
    openWhatsAppWithText(labNumber, buildPickupMessage(leaving, clinic?.name || "", language, today));
  };

  const SECTION = "text-[11px] font-black uppercase tracking-wider text-ink-muted";
  const ACTION =
    "inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-black text-ink transition-colors hover:bg-surface-subtle disabled:opacity-50 sm:w-auto sm:flex-1";

  const caseFacts = (c: LabCase) => (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] font-bold text-ink-muted">
      {c.patientName && <bdi>{c.patientName}</bdi>}
      <span>· {workTypeLabel(c.workType, language)}</span>
      {c.teeth.length > 0 && <PalmerList teeth={c.teeth} />}
    </span>
  );

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm animate-in fade-in sm:items-center sm:p-4">
      <div
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl animate-in slide-in-from-bottom sm:max-w-2xl sm:rounded-[2rem] sm:zoom-in-95"
        dir={isAr ? "rtl" : "ltr"}
        data-tour="lab-driver"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ink-slab text-white">
              <Truck size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black tracking-tight text-ink">
                {isAr ? "المندوب جه" : "The driver is here"}
              </h2>
              <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                {isAr ? "استلم اللي رجع، وسلّم اللي طالع" : "Sign in what came back, hand over what leaves"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-slate-400 transition-colors hover:bg-surface-muted hover:text-slate-700"
            aria-label={isAr ? "إغلاق" : "Close"}
          >
            <X size={18} />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-7">
          {rounds.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-ink-muted">
              {isAr ? "مفيش شغل في المعامل ولا شغل طالع النهارده." : "Nothing is out at a lab and nothing leaves today."}
            </p>
          ) : (
            <div>
              <p className={`${SECTION} mb-2`}>{isAr ? "مندوب أنهي معمل؟" : "Which lab's driver?"}</p>
              <div className="flex flex-wrap gap-2">
                {rounds.map((r) => {
                  const on = r.key === labKey;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setLabKey(r.key);
                        setPicked(new Set());
                        setArrived([]);
                      }}
                      className={`min-h-12 rounded-xl border px-4 py-2 text-start transition-colors ${
                        on ? "border-ink-slab bg-ink-slab text-white" : "border-line bg-surface text-ink hover:border-ink"
                      }`}
                    >
                      <span className="block text-[13px] font-black"><bdi>{r.labName || (isAr ? "معمل" : "Lab")}</bdi></span>
                      <span className={`block text-[11px] font-bold ${on ? "text-white/70" : "text-ink-muted"}`}>
                        {isAr ? `${r.out} برّه · ${r.leaving} طالع النهارده` : `${r.out} out · ${r.leaving} leaving today`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {round && (
            <>
              {/* What he brought back */}
              <section className="space-y-3" data-tour="lab-driver-receive">
                <div className="flex items-center justify-between gap-3">
                  <p className={SECTION}>{isAr ? "جاب معاه إيه؟" : "What did he bring back?"}</p>
                  {returnable.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setPicked(allPicked ? new Set() : new Set(returnable.map((c) => c.id)))}
                      className="inline-flex h-10 items-center rounded-lg px-2 text-[12px] font-black text-ink underline-offset-4 hover:underline"
                    >
                      {allPicked ? (isAr ? "شيل الكل" : "Untick all") : isAr ? "اختار الكل" : "Tick all"}
                    </button>
                  )}
                </div>

                {arrived.length > 0 && (
                  <div className="space-y-2 rounded-2xl bg-ink-slab p-4 text-white" data-tour="lab-driver-arrived">
                    <p className="text-sm font-black">
                      {isAr
                        ? `اتسجّل وصول ${caseCountWord(arrived.length, language)} — كلّم المرضى واحجزلهم`
                        : `${caseCountWord(arrived.length, language)} signed in. Call the patients and book them.`}
                    </p>
                    <ul className="space-y-1.5">
                      {arrived.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px] font-bold">
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                            <span dir="ltr" className="font-black tabular-nums">{c.code}</span>
                            {c.patientName && <bdi>{c.patientName}</bdi>}
                            <span className="text-white/60">· {statusLabel(c.status, language)}</span>
                          </span>
                          {c.patientPhone && (
                            <a
                              href={`tel:${c.patientPhone}`}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-black text-ink"
                            >
                              <Phone size={14} />
                              {isAr ? "اتصل" : "Call"}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {returnable.length === 0 ? (
                  <p className="rounded-xl bg-surface-subtle px-4 py-3 text-[13px] font-bold text-ink-muted">
                    {isAr ? "مفيش شغل قديم برّه عند المعمل ده." : "Nothing from before today is out at this lab."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {returnable.map((c) => {
                      const on = picked.has(c.id);
                      const late = dueStateFor(c, today) === "overdue";
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => toggle(c.id)}
                            className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-start transition-colors ${
                              on ? "border-ink-slab bg-surface-subtle" : "border-line bg-surface hover:border-ink"
                            }`}
                          >
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                on ? "border-ink-slab bg-ink-slab text-white" : "border-line-strong bg-surface"
                              }`}
                            >
                              {on && <Check size={16} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2">
                                <span dir="ltr" className="text-[15px] font-black tabular-nums text-ink">{c.code}</span>
                                {late && (
                                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700">
                                    {isAr ? "متأخرة" : "Overdue"}
                                  </span>
                                )}
                                {c.needsTryIn && (
                                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-black text-ink-muted">
                                    {isAr ? "بروفة" : "Try-in"}
                                  </span>
                                )}
                              </span>
                              {caseFacts(c)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {returnable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void receive()}
                    disabled={picked.size === 0 || busy !== ""}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-slab px-6 text-sm font-black text-white transition-colors hover:bg-ink disabled:opacity-40"
                  >
                    {busy === "receive" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {picked.size === 0
                      ? isAr ? "علّم اللي وصل" : "Tick what arrived"
                      : isAr ? `وصلوا العيادة (${picked.size})` : `Arrived at the clinic (${picked.size})`}
                  </button>
                )}
              </section>

              {/* What he takes */}
              <section className="space-y-3" data-tour="lab-driver-leaving">
                <p className={SECTION}>{isAr ? "هياخد إيه النهارده؟" : "What does he take today?"}</p>

                {drafts.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2.5">
                    <p className="min-w-0 text-[13px] font-bold text-ink">
                      {isAr
                        ? `${caseCountWord(drafts.length, language)} محفوظة ولسه ماتبعتتش.`
                        : `${caseCountWord(drafts.length, language)} saved but not sent yet.`}
                    </p>
                    <button
                      type="button"
                      onClick={() => void sendDrafts()}
                      disabled={busy !== ""}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink-slab px-3 text-[12px] font-black text-white hover:bg-ink disabled:opacity-50"
                    >
                      {busy === "drafts" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      {isAr ? "ابعتهم مع المندوب" : "Send them with him"}
                    </button>
                  </div>
                )}

                {leaving.length === 0 ? (
                  <p className="rounded-xl bg-surface-subtle px-4 py-3 text-[13px] font-bold text-ink-muted">
                    {isAr ? "مفيش شغل طالع للمعمل ده النهارده." : "Nothing leaves for this lab today."}
                  </p>
                ) : (
                  <>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-line">
                      {leaving.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
                          <span dir="ltr" className="text-[15px] font-black tabular-nums text-ink">{c.code}</span>
                          {caseFacts(c)}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button type="button" onClick={() => void print()} disabled={busy !== ""} className={ACTION}>
                        {busy === "print" ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
                        {isAr ? "اطبع قائمة التسليم" : "Print the handover list"}
                      </button>
                      <button type="button" onClick={whatsapp} disabled={!labNumber} className={ACTION}>
                        <MessageCircle size={16} />
                        {isAr ? "واتساب للمعمل" : "WhatsApp the lab"}
                      </button>
                    </div>
                    {!labNumber && (
                      <p className="text-[12px] font-bold text-ink-muted">
                        {isAr
                          ? `مفيش رقم واتساب لـ ${round.labName}. ضيفه من الإعدادات ← المعامل.`
                          : `No WhatsApp number for ${round.labName}. Add one in Settings → Dental Labs.`}
                      </p>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-5 py-3 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-xl border border-line bg-surface px-6 text-sm font-black text-ink transition-colors hover:bg-surface-subtle"
          >
            {isAr ? "تم" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
