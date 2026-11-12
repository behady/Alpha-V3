"use client";

/**
 * The patient file's Lab tab.
 *
 * The Lab page answers "where is every case"; this answers "where is THIS patient's crown" for
 * whoever has the file open — the desk with the patient on the phone, the dentist with them in the
 * chair. Same records, same moves (sent → back → fitted), same order form; nothing is stored here
 * that the Lab page does not already own.
 *
 * Cancelling and remaking stay on the Lab page on purpose: both are rare, both need a second
 * thought, and a phone-width row is the wrong place for a button that undoes a case.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDoc, onSnapshot, query, where } from "firebase/firestore";
import { Check, ChevronRight, FlaskConical, Loader2, Pencil, Plus, Printer } from "lucide-react";
import LabCaseModal from "@/components/lab/LabCaseModal";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { localYmd } from "@/lib/clinicDate";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { LABS_SETTINGS_DOC, labsWithCaseLabs, parseDentalLabs, parseLabPaper, type DentalLab } from "@/lib/dentalLabs";
import {
  DEFAULT_LAB_PAPER,
  LAB_CASES_COLLECTION,
  dueStateFor,
  formatPalmer,
  nextStatuses,
  patientLabView,
  statusFor,
  statusLabel,
  toLabCase,
  workTypeLabel,
  type LabCase,
  type LabCaseSeed,
  type LabCaseStatus,
  type LabOrderPaper,
} from "@/lib/labCases";
import { advanceLabCase } from "@/lib/labCaseWrite";
import { notifyLabCaseReady } from "@/lib/labNotify";
import { loadLabOrderClinic, printLabOrder } from "@/lib/labOrderPrint";

/** A clinic date as people here write it: day first. */
const dmy = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function PatientLabTab({
  patientId,
  patient,
  hideMoney = false,
}: {
  patientId: string;
  patient: { name?: string; phone?: string };
  /** Chair mode: the dentist sees where the work is, not what the lab charges. */
  hideMoney?: boolean;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { clinic, clinicId } = useClinic();
  const { showToast } = useUI();
  const { branches, activeBranchId } = useActiveBranch();

  const [cases, setCases] = useState<LabCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [directoryLabs, setLabs] = useState<DentalLab[]>([]);
  const [paper, setPaper] = useState<LabOrderPaper>(DEFAULT_LAB_PAPER);
  const [busyId, setBusyId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LabCase | null>(null);

  const today = localYmd();

  useEffect(() => {
    const stop = onSnapshot(
      query(getClinicCollection(LAB_CASES_COLLECTION), where("patientId", "==", patientId)),
      (snap) => {
        setCases(snap.docs.map((d) => toLabCase(d.id, d.data() as Record<string, unknown>)));
        setFailed(false);
        setLoading(false);
      },
      (err) => {
        console.error("Patient lab cases subscription failed", err);
        setFailed(true);
        setLoading(false);
      }
    );
    return () => stop();
  }, [patientId]);

  useEffect(() => {
    getDoc(getClinicDoc("settings", LABS_SETTINGS_DOC))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : null;
        setLabs(parseDentalLabs(data));
        setPaper(parseLabPaper(data));
      })
      .catch(() => {
        /* Without the directory the list still renders; only the order form's suggestions are thinner. */
      });
  }, []);

  const labs = useMemo(() => labsWithCaseLabs(directoryLabs, cases), [directoryLabs, cases]);
  const view = useMemo(() => patientLabView(cases, today), [cases, today]);
  const seed = useMemo<LabCaseSeed>(
    () => ({ patientId, patientName: patient.name || "", patientPhone: patient.phone || "" }),
    [patientId, patient.name, patient.phone]
  );

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleAdvance = useCallback(
    async (labCase: LabCase, next: LabCaseStatus) => {
      setBusyId(labCase.id);
      try {
        await advanceLabCase(labCase, next, { by: user?.name });
        if (next === "back") void notifyLabCaseReady(labCase, language, clinic?.alertPreferences, clinicId);
        showToast(`${labCase.code} · ${statusLabel(next, language)}`, "success");
      } catch (err) {
        console.error("Lab case status change failed", err);
        showToast(isAr ? "فشل التحديث" : "Could not update the case", "error");
      } finally {
        setBusyId("");
      }
    },
    [user, language, clinic, clinicId, showToast, isAr]
  );

  const handlePrint = useCallback(
    async (labCase: LabCase) => {
      setBusyId(labCase.id);
      try {
        const clinicHeader = await loadLabOrderClinic(labCase.branchName);
        await printLabOrder({ labCase, clinic: clinicHeader, language, paper });
      } catch (err) {
        console.error("Lab order print failed", err);
        showToast(isAr ? "فشلت الطباعة" : "Could not print the order", "error");
      } finally {
        setBusyId("");
      }
    },
    [language, paper, showToast, isAr]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-ink-muted" size={28} />
      </div>
    );
  }

  const newButton = (
    <button
      type="button"
      onClick={openNew}
      data-tour="patient-lab-new"
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-ink-slab px-4 text-[13px] font-bold text-white transition-colors hover:bg-ink"
    >
      <Plus size={16} />
      {isAr ? "أمر معمل جديد" : "New lab order"}
    </button>
  );

  const stat = (value: number, label: string, alert = false) => (
    <div className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3 py-3 text-center">
      <p className={`text-xl font-black tabular-nums ${alert && value > 0 ? "text-rose-600" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-bold text-ink-muted">{label}</p>
    </div>
  );

  return (
    <div className="space-y-4" data-tour="patient-lab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-black text-ink">
            <FlaskConical size={20} />
            {isAr ? "شغل المعمل" : "Lab work"}
          </h3>
          <p className="mt-0.5 text-[12px] font-semibold text-ink-muted">
            {isAr ? "كل حاجة اتبعتت للمعمل للمريض ده، وهي فين دلوقتي." : "Everything sent to a lab for this patient, and where it is now."}
          </p>
        </div>
        {newButton}
      </div>

      {failed && (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] font-semibold text-rose-700">
          {isAr ? "مقدرناش نحمّل شغل المعمل. جرّب تاني." : "Could not load the lab work. Try again."}
        </p>
      )}

      {!failed && cases.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface-subtle px-5 py-10 text-center">
          <p className="text-[14px] font-black text-ink">{isAr ? "مفيش شغل معمل للمريض ده" : "No lab work for this patient yet"}</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] font-semibold text-ink-muted">
            {isAr
              ? "دوس «أمر معمل جديد»، أو سجّل علاج محتاج معمل وهيتعمل الأمر من هناك."
              : "Press “New lab order”, or save a treatment that needs a lab and raise the order from there."}
          </p>
        </div>
      )}

      {cases.length > 0 && (
        <>
          <div className="flex gap-2">
            {stat(view.open, isAr ? "شغالة" : "In progress")}
            {stat(view.waiting, isAr ? "مستنية تركيب" : "Waiting to fit")}
            {stat(view.overdue, isAr ? "متأخرة" : "Late", true)}
          </div>

          <ul className="space-y-3">
            {view.rows.map((c) => {
              const status = statusFor(c.status);
              const due = dueStateFor(c, today);
              const late = due === "overdue";
              const moves = nextStatuses(c.status, c.needsTryIn).filter((s) => s !== "cancelled" && s !== "draft").slice(0, 2);
              // Each part is isolated: an English description beside Arabic text and Palmer brackets reorders itself otherwise.
              const workParts = [workTypeLabel(c.workType, language), c.workDescription].filter(Boolean) as string[];
              const teeth = c.teeth?.length ? formatPalmer(c.teeth) : "";
              const dates: Array<[string, string, boolean]> = [
                [isAr ? "اتبعتت" : "Sent", dmy(c.sentAt), false],
                [isAr ? "ميعاد الاستلام" : "Due", dmy(c.dueDate), late],
                [isAr ? "وصلت" : "Back", dmy(c.receivedAt), false],
                [isAr ? "اتركبت" : "Fitted", dmy(c.fittedAt), false],
              ];
              return (
                <li key={c.id} id={`lab-p-${c.id}`} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-black tabular-nums text-ink" dir="ltr">{c.code}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-black ${status.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                      {isAr ? status.ar : status.en}
                    </span>
                    {late && (
                      <span className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-700">
                        {isAr ? "متأخرة" : "Late"}
                      </span>
                    )}
                    {c.remakeOfCode && (
                      <span className="rounded-lg border border-line bg-surface-subtle px-2.5 py-1 text-[11px] font-black text-ink-muted">
                        {isAr ? "إعادة لـ" : "Remake of"} <span dir="ltr">{c.remakeOfCode}</span>
                      </span>
                    )}
                  </div>

                  {/* Every line starts at the same edge. Separators sit at the END of a part, never
                      the start, so a wrapped line can't open with a stray dot; the teeth are a chip
                      in left-to-right order, the way the dentist reads the chart. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] font-bold text-ink">
                    {workParts.length === 0
                      ? <span>{isAr ? "شغل معمل" : "Lab work"}</span>
                      : workParts.map((part, i) => (
                          <span key={i}>
                            <bdi>{part}</bdi>
                            {i < workParts.length - 1 && <span className="ms-1.5 text-ink-faint">·</span>}
                          </span>
                        ))}
                    {teeth && (
                      <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[12px] font-black tabular-nums text-ink" dir="ltr">
                        {teeth}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] font-semibold text-ink-muted">
                    {[c.labName, c.doctorName].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {!hideMoney && c.agreedPrice > 0 && (
                    <p className="mt-1 text-[12px] font-bold text-ink-muted" data-film="price">
                      {isAr ? "سعر المعمل" : "Lab price"}{" "}
                      <span className="text-[13px] font-black tabular-nums text-ink" dir="ltr">{money(c.agreedPrice)}</span>
                    </p>
                  )}

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4" data-film="dates">
                    {dates.map(([label, value, alert]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[11px] font-bold text-ink-muted">{label}</dt>
                        {/* dir="ltr" on the dd itself pushed every date to the LEFT edge under a
                            right-aligned label in Arabic. Only the digits need the direction. */}
                        <dd className={`text-[13px] font-black tabular-nums ${alert ? "text-rose-600" : value ? "text-ink" : "text-ink-faint"}`}>
                          <span dir="ltr">{value || "—"}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                    {busyId === c.id ? (
                      <Loader2 size={16} className="mx-3 animate-spin text-ink-muted" />
                    ) : (
                      <>
                        {moves.map((next) => (
                          <button
                            key={next}
                            type="button"
                            onClick={() => handleAdvance(c, next)}
                            className="inline-flex h-9 items-center gap-1 rounded-xl bg-surface-muted px-2.5 text-[12px] font-black text-ink transition-colors hover:bg-ink-slab hover:text-white"
                          >
                            {next === "back" || next === "fitted" ? <Check size={14} /> : <ChevronRight size={14} className={isAr ? "rotate-180" : ""} />}
                            {statusLabel(next, language)}
                          </button>
                        ))}
                        <span className="ms-auto inline-flex">
                        <button
                          type="button"
                          onClick={() => handlePrint(c)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                          aria-label={isAr ? "طباعة الأمر" : "Print the order"}
                        >
                          <Printer size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(c);
                            setModalOpen(true);
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                          aria-label={isAr ? "تعديل" : "Edit"}
                        >
                          <Pencil size={16} />
                        </button>
                        </span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <Link href="/lab" className="inline-block text-[12px] font-bold text-ink-muted underline underline-offset-4 hover:text-ink">
            {isAr ? "افتح صفحة المعمل (إلغاء، إعادة عمل، حساب المعمل)" : "Open the Lab page (cancel, remake, lab account)"}
          </Link>
        </>
      )}

      <LabCaseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        existing={editing}
        seed={editing ? null : seed}
        labs={labs}
        branches={branches}
        defaultBranchId={activeBranchId && activeBranchId !== "__all__" ? activeBranchId : ""}
        currentUserName={user?.name}
        onSaved={() => setModalOpen(false)}
      />
    </div>
  );
}
