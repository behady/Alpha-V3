"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Armchair, Lock, MessageCircle, Plus, X } from "lucide-react";
import ChairNoteCard, { StatusSwitch, type NoteStatus } from "./ChairNoteCard";
import ServiceEditorDrawer, { TeethChartSelector } from "@/components/clinical-notes/ServiceEditorDrawer";
import type { Note, Service, Staff } from "@/components/clinical-notes/types";
import { parseTeethString } from "@/components/clinical-notes/utils";
import { patchClaim } from "@/components/insurance/api";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { approvalLinesForChair, canTouch, groupForChair } from "@/lib/chairPopup";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { suggestCategory } from "@/lib/dentalIcons";
import type { DentistIdentity } from "@/lib/dentistHome";
import type { ToothData } from "@/lib/diagnosisCatalog";
import { isAnyUnlocked } from "@/lib/featureCatalog";
import { cairo } from "@/lib/fonts/arabic";
import { CLAIMS_COLLECTION, parseClaim, type InsuranceClaim, type LineStatus } from "@/lib/insurance/claims";
import { deleteProcedure, updateApprovalProcedure, updateProcedure } from "@/lib/moneyApi";
import { treatmentsByTooth } from "@/lib/toothTreatments";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** Today's visit, when opened from one; null from the search box. */
  appointment: { id: string; branchId?: string | null } | null;
  me: DentistIdentity;
  services: Service[];
  doctors: Staff[];
};

type PatientCard = {
  name: string;
  fileId: string;
  age: string;
  phone: string;
  allergies: string;
  teethData: Record<string, ToothData>;
  defaultPriceListId: string | null;
};

/** Years from a date of birth, or the stored age; "" when neither is known. */
function ageOf(d: Record<string, unknown>): string {
  const dob = typeof d.dateOfBirth === "string" ? d.dateOfBirth : "";
  if (dob) {
    const born = new Date(dob);
    if (!Number.isNaN(born.getTime())) {
      const now = new Date();
      let years = now.getFullYear() - born.getFullYear();
      if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) years -= 1;
      return String(years);
    }
  }
  return d.age ? String(d.age) : "";
}

/**
 * The chair: one patient, every treatment on them, and nothing about money.
 *
 * A dentist opens it from their home (today's visit, or any patient from the search). Their own
 * treatments carry the status switch, edit and delete; other dentists' are shown locked. The
 * patient's approved insurance lines appear by name and teeth only. Adding or editing uses the
 * shared editor in dentist mode, so the treatment is priced from the clinic's list and billed
 * without the dentist seeing a figure (spec 2026-10-08).
 *
 * Full screen on a phone; a window on the desk. Portalled to <body>, so it sets its own
 * direction and Arabic face like the other popups.
 */
export default function ChairPopup({ isOpen, onClose, patientId, appointment, me, services, doctors }: Props) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { clinicId, clinic } = useClinic();
  const { showToast, confirm } = useUI();
  const insuranceOn = !!clinic && isAnyUnlocked(clinic, "insurance");

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const [patient, setPatient] = useState<PatientCard | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [visitDates, setVisitDates] = useState<Record<string, string>>({});
  const [chartTeeth, setChartTeeth] = useState<string[]>([]);
  /** The editor, when open: a new treatment, or one of mine being edited. */
  const [editor, setEditor] = useState<{ note: Note | null } | null>(null);
  /** One write at a time per note (or per approval line), so a double tap cannot race itself. */
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (!isOpen || !clinicId || !patientId) return;
    setPatient(null);
    setEditor(null);
    setChartTeeth([]);
    let live = true;
    getDoc(getClinicDoc("patients", patientId))
      .then((snap) => {
        if (!live) return;
        const d = (snap.data() || {}) as Record<string, unknown>;
        setPatient({
          name: String(d.name || ""),
          fileId: String(d.fileId || ""),
          age: ageOf(d),
          phone: String(d.phone || ""),
          allergies: String(d.allergies || ""),
          teethData: (d.teethData as Record<string, ToothData> | undefined) || {},
          defaultPriceListId: typeof d.defaultPriceListId === "string" ? d.defaultPriceListId : null,
        });
      })
      .catch((e) => console.error("Chair: patient load failed", e));
    getDocs(query(getClinicCollection("appointments"), where("patientId", "==", patientId)))
      .then((snap) => {
        if (!live) return;
        const dates: Record<string, string> = {};
        snap.docs.forEach((d) => {
          dates[d.id] = String(d.data().date || "");
        });
        setVisitDates(dates);
      })
      .catch(() => undefined);
    const stopNotes = onSnapshot(
      query(getClinicCollection("clinical_notes"), where("patientId", "==", patientId)),
      (snap) => setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Note)),
      () => setNotes([]),
    );
    const stopClaims = insuranceOn
      ? onSnapshot(
          query(getClinicCollection(CLAIMS_COLLECTION), where("patientId", "==", patientId)),
          (snap) => setClaims(snap.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is InsuranceClaim => c !== null)),
          () => setClaims([]),
        )
      : undefined;
    return () => {
      live = false;
      stopNotes();
      stopClaims?.();
    };
  }, [isOpen, clinicId, patientId, insuranceOn]);

  const treatments = useMemo(() => {
    const categoryById = new Map(services.map((s) => [s.id, s.category]));
    return treatmentsByTooth(notes, (id) => categoryById.get(id) || undefined, (name) => suggestCategory(name));
  }, [notes, services]);

  const groups = useMemo(() => groupForChair(notes, appointment?.id ?? null, visitDates), [notes, appointment?.id, visitDates]);
  const approvalLines = useMemo(() => approvalLinesForChair(claims, me), [claims, me]);
  const dentistName = (note: Note) => {
    const byId = note.doctorId ? doctors.find((d) => d.id === note.doctorId)?.name : "";
    return byId || note.doctor || "";
  };

  const setStatus = async (note: Note, next: NoteStatus) => {
    if (busyId || !canTouch(note, me)) return;
    setBusyId(note.id);
    try {
      if ((note as { claimId?: string }).claimId) {
        await updateApprovalProcedure(note.id, {
          patientId,
          appointmentId: note.appointmentId ?? null,
          status: next,
          doctorId: me.staffId,
          note: note.note ?? "",
        });
      } else {
        await updateProcedure(note.id, {
          patientId,
          appointmentId: note.appointmentId ?? null,
          procedures: [String(note.procedure || "")],
          selectedTeeth: parseTeethString(note.tooth || ""),
          tooth: note.tooth,
          doctorId: me.staffId,
          status: next,
          note: note.note ?? "",
          date: note.date,
          addToLedger: true,
        });
      }
    } catch (e) {
      console.error("Chair: status failed", e);
      showToast(isAr ? "ماتحفظش — جرّب تاني" : "Not saved — try again", "error");
    } finally {
      setBusyId("");
    }
  };

  const removeNote = async (note: Note) => {
    if (busyId || !canTouch(note, me)) return;
    const yes = await confirm(isAr ? `تحذف «${note.procedure}»؟` : `Delete "${note.procedure}"?`, {
      title: isAr ? "حذف العلاج" : "Delete treatment",
      confirmLabel: isAr ? "احذف" : "Delete",
      cancelLabel: isAr ? "لا" : "No",
    });
    if (!yes) return;
    setBusyId(note.id);
    try {
      await deleteProcedure(note.id);
      showToast(isAr ? "اتحذف" : "Deleted", "success");
    } catch (e) {
      console.error("Chair: delete failed", e);
      showToast(isAr ? "ماتحذفش — جرّب تاني" : "Not deleted — try again", "error");
    } finally {
      setBusyId("");
    }
  };

  const setLineStatus = async (claimId: string, lineIndex: number, next: LineStatus) => {
    if (busyId || !clinicId) return;
    const key = `${claimId}#${lineIndex}`;
    setBusyId(key);
    try {
      const error = await patchClaim(clinicId, claimId, { lineStatus: { [lineIndex]: next } });
      if (error) showToast(error, "error");
    } catch (e) {
      console.error("Chair: line status failed", e);
      showToast(isAr ? "ماتحفظش — جرّب تاني" : "Not saved — try again", "error");
    } finally {
      setBusyId("");
    }
  };

  const openWhatsApp = (phone: string) => {
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) cleaned = "2" + cleaned;
    else if (!cleaned.startsWith("20") && cleaned.length >= 10) cleaned = "20" + cleaned;
    window.open(`https://wa.me/${cleaned}`, "_blank");
  };

  if (!isOpen || !mounted) return null;

  const eyebrow = "text-[12px] font-black uppercase tracking-wider text-ink-muted";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center md:items-center md:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        dir={isAr ? "rtl" : "ltr"}
        role="dialog"
        aria-labelledby="chair-title"
        className={`${cairo.variable} ${isAr ? "arabic-ui" : ""} relative z-10 flex h-full w-full flex-col overflow-hidden bg-surface shadow-2xl md:h-auto md:max-h-[92vh] md:max-w-5xl md:rounded-[2rem]`}
      >
        {/* Header: the patient, in the clinic's black and yellow. */}
        <div className="flex shrink-0 items-center justify-between gap-3 bg-ink-slab px-5 py-3 text-white md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-ink-on-accent">
              <Armchair size={20} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h2 id="chair-title" className="truncate text-lg font-black leading-tight text-[#FACC15]">{patient?.name || "…"}</h2>
              <p className="truncate text-[13px] font-bold text-white/85">
                {isAr ? "الكرسي" : "The chair"} · د. {me.name}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={isAr ? "إغلاق" : "Close"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/5 text-white transition-colors hover:bg-white/15">
            <X size={18} />
          </button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 md:px-6">
          {/* Patient strip: who they are and what to watch for. No balance. */}
          {patient && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-[14px] font-bold text-ink-body">
              {patient.fileId && (
                <span>
                  {isAr ? "رقم الملف" : "File"} <bdi dir="ltr" className="font-figure text-ink">{patient.fileId}</bdi>
                </span>
              )}
              {patient.age && (
                <span>
                  <span className="font-figure text-ink">{patient.age}</span> {isAr ? "سنة" : "y"}
                </span>
              )}
              {patient.phone && (
                <button type="button" onClick={() => openWhatsApp(patient.phone)} className="inline-flex items-center gap-1.5 text-ink hover:text-emerald-700">
                  <MessageCircle size={14} className="text-emerald-600" /> <bdi dir="ltr" className="font-figure">{patient.phone}</bdi>
                </button>
              )}
              {patient.allergies && (
                <span className="text-rose-700">
                  {isAr ? "حساسية" : "Allergies"}: {patient.allergies}
                </span>
              )}
            </div>
          )}

          {/* The chart: what is in the mouth, and the teeth for the next treatment. */}
          {patient && (
            <TeethChartSelector
              selected={chartTeeth}
              onToggle={(code) => setChartTeeth((prev) => (prev.includes(code) ? prev.filter((t) => t !== code) : [...prev, code]))}
              onSetSelected={setChartTeeth}
              teethData={patient.teethData}
              treatments={treatments}
              isAr={isAr}
              narrow={false}
              patientId={patientId}
            />
          )}

          {/* The editor, when adding or editing — right under the chart that feeds it. */}
          {editor && patient && (
            <div className="rounded-2xl border-2 border-accent">
              <ServiceEditorDrawer
                isOpen={true}
                inline={true}
                onClose={() => setEditor(null)}
                patientId={patientId}
                patientName={patient.name}
                patientDefaultPriceListId={patient.defaultPriceListId}
                branchId={appointment?.branchId ?? null}
                appointmentId={editor.note ? (editor.note.appointmentId ?? null) : (appointment?.id ?? null)}
                initialNote={editor.note}
                servicesList={services}
                doctors={doctors}
                hideTeethSelector
                selectedTeethOverride={chartTeeth}
                onSelectedTeethChange={setChartTeeth}
                teethData={patient.teethData}
                treatments={treatments}
                dentistMode
                meStaffId={me.staffId}
                onSaved={() => {
                  setEditor(null);
                  setChartTeeth([]);
                  showToast(isAr ? "اتحفظ" : "Saved", "success");
                }}
              />
              <div className="px-4 pb-3 text-end">
                <button type="button" onClick={() => setEditor(null)} className="text-[13px] font-bold text-ink-muted underline-offset-4 hover:underline">
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
              </div>
            </div>
          )}

          {/* Every treatment on the patient, today's visit first. */}
          <section className="space-y-4">
            <p className={eyebrow}>{isAr ? "علاجات المريض" : "This patient's treatments"}</p>
            {groups.length === 0 && (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[14px] font-semibold text-ink-muted">
                {isAr ? "مفيش علاجات متسجلة لسه." : "No treatments recorded yet."}
              </p>
            )}
            {groups.map((g) => (
              <div key={g.key} className="space-y-2">
                <p className={`text-[14px] font-black ${g.isToday ? "text-ink" : "text-ink-muted"}`}>{isAr ? g.title.ar : g.title.en}</p>
                {g.notes.length === 0 && g.isToday && (
                  <p className="text-[13px] font-semibold text-ink-muted">{isAr ? "لسه مفيش حاجة النهارده — أضف علاج من الزرار اللي تحت." : "Nothing yet today — add a treatment with the button below."}</p>
                )}
                {g.notes.map((n) => (
                  <ChairNoteCard
                    key={n.id}
                    note={n}
                    mine={canTouch(n, me)}
                    busy={busyId === n.id}
                    dentistName={dentistName(n)}
                    onStatus={(s) => void setStatus(n, s)}
                    onEdit={() => {
                      setChartTeeth(parseTeethString(n.tooth || ""));
                      setEditor({ note: n });
                    }}
                    onDelete={() => void removeNote(n)}
                    isAr={isAr}
                  />
                ))}
              </div>
            ))}
          </section>

          {/* Approved insurance lines: name, teeth and state. The money is reception's. */}
          {approvalLines.length > 0 && (
            <section className="space-y-2">
              <p className={eyebrow}>{isAr ? "موافقات التأمين" : "Insurance approvals"}</p>
              {approvalLines.map((l) => {
                const key = `${l.claimId}#${l.lineIndex}`;
                return (
                  <div key={key} className={`rounded-2xl border p-4 ${l.mine ? "border-line bg-surface" : "border-line bg-surface-subtle"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[16px] font-black text-ink">
                        {l.name}
                        {l.teeth && (
                          <span className="ms-3 text-[13px] font-bold text-ink-body">
                            {isAr ? "الأسنان" : "Teeth"} <bdi dir="ltr" className="font-figure text-ink">{l.teeth}</bdi>
                          </span>
                        )}
                      </p>
                      {!l.mine && (
                        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-ink-muted">
                          <Lock size={12} /> {isAr ? "مش عليك" : "Not yours"}
                        </span>
                      )}
                    </div>
                    {l.mine && (
                      <div className="mt-3 max-w-md">
                        <StatusSwitch value={l.status} busy={busyId === key} onChange={(s) => void setLineStatus(l.claimId, l.lineIndex, s)} isAr={isAr} />
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-surface px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => {
              setEditor({ note: null });
            }}
            disabled={!patient || !!editor}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[17px] font-black text-ink-on-accent transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            <Plus size={20} strokeWidth={3} /> {isAr ? "أضف علاج" : "Add treatment"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
