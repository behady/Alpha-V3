"use client";

import { useEffect, useMemo, useState } from "react";
import { getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Check, ChevronDown, DollarSign, Loader2, Plus, Stethoscope } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { isDentistStaff } from "@/lib/staffRoles";
import { treatmentsByTooth } from "@/lib/toothTreatments";
import { suggestCategory } from "@/lib/dentalIcons";
import { MoneyApiError, createProcedure, deleteProcedure } from "@/lib/moneyApi";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import ServiceItem from "@/components/clinical-notes/ServiceItem";
import ServiceEditorDrawer from "@/components/clinical-notes/ServiceEditorDrawer";
import type { Note, Service, Staff } from "@/components/clinical-notes/types";

/**
 * The services on a visit, edited from the side panel with the same editor the patient file uses.
 *
 * The panel used to carry a cut-down "add procedure" form and nothing else: a service, a cost, a
 * tick box. Anything past that — a tooth, a discount, a status, a before/after photo, or simply
 * fixing a price typed wrong a minute ago — meant leaving the schedule, opening the patient, and
 * finding the treatment again. So this tab lists what is actually on the visit and hands every row
 * to `ServiceEditorDrawer`, the editor from the patient's own file. The quick form stays for the
 * common case, because a receptionist recording a consultation should not need a teeth chart.
 */
export default function AppointmentServicesTab({
  appointment,
  doctorsList = [],
  servicesList = [],
}: {
  appointment: any;
  doctorsList?: any[];
  servicesList?: any[];
}) {
  const { language } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";

  const patientId = appointment?.patientId as string | undefined;
  const appointmentId = appointment?.id as string | undefined;

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [teethData, setTeethData] = useState<Record<string, any>>({});

  /**
   * Lookups the panel may or may not have been handed.
   *
   * Three of the four screens that mount the side panel pass `servicesList`; the appointments page
   * passes none at all, and no screen passes dentists in the shape the editor wants. Fetching what
   * is missing here means the tab works the same wherever the panel is opened, instead of showing
   * an empty service picker on one page and a full one on another.
   */
  const [fetchedServices, setFetchedServices] = useState<Service[] | null>(null);
  const [fetchedDoctors, setFetchedDoctors] = useState<Staff[] | null>(null);

  // Quick add
  const [procServiceId, setProcServiceId] = useState("");
  const [procCost, setProcCost] = useState<number | "">("");
  const [addProcToLedger, setAddProcToLedger] = useState(true);
  const [addingProcedure, setAddingProcedure] = useState(false);

  // Full editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editorApptId, setEditorApptId] = useState<string | null>(null);

  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setNotes([]);
      setNotesLoading(false);
      return;
    }
    setNotesLoading(true);
    const unsub = onSnapshot(
      query(getClinicCollection("clinical_notes"), where("patientId", "==", patientId)),
      (snap) => {
        setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Note)));
        setNotesLoading(false);
      },
      () => setNotesLoading(false)
    );
    return () => unsub();
  }, [patientId]);

  // The charted mouth, so the editor's teeth chart shows this patient's history and not a healthy
  // one. Read once per patient, not per render.
  useEffect(() => {
    if (!patientId) return;
    getDoc(getClinicDoc("patients", patientId))
      .then((snap) => setTeethData(snap.exists() ? snap.data().teethData || {} : {}))
      .catch(() => setTeethData({}));
  }, [patientId]);

  useEffect(() => {
    if (servicesList.length > 0 || fetchedServices) return;
    getDocs(getClinicCollection("services"))
      .then((snap) =>
        setFetchedServices(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Service))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      )
      .catch(() => setFetchedServices([]));
  }, [servicesList.length, fetchedServices]);

  useEffect(() => {
    if (fetchedDoctors) return;
    getDocs(getClinicCollection("staff"))
      .then((snap) =>
        setFetchedDoctors(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staff)).filter((s) => isDentistStaff(s)))
      )
      .catch(() => setFetchedDoctors([]));
  }, [fetchedDoctors]);

  const services: Service[] = useMemo(
    () => (servicesList.length > 0 ? (servicesList as Service[]) : fetchedServices || []),
    [servicesList, fetchedServices]
  );
  const doctors: Staff[] = fetchedDoctors && fetchedDoctors.length > 0
    ? fetchedDoctors
    : (doctorsList as Staff[]);

  const treatments = useMemo(() => {
    const categoryById = new Map(services.map((s) => [s.id, s.category]));
    return treatmentsByTooth(notes, (id) => categoryById.get(id) || undefined, (name) => suggestCategory(name));
  }, [notes, services]);

  const visitNotes = useMemo(
    () => notes.filter((n) => n.appointmentId === appointmentId),
    [notes, appointmentId]
  );
  const otherNotes = useMemo(
    () =>
      notes
        .filter((n) => n.appointmentId !== appointmentId)
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)),
    [notes, appointmentId]
  );

  const visitTotal = visitNotes.reduce((sum, n) => sum + (Number(n.cost) || 0), 0);

  const openEditor = (note: Note | null) => {
    setEditingNote(note);
    setEditorApptId(note ? note.appointmentId || null : appointmentId || null);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingNote(null);
    setEditorApptId(null);
  };

  const handleDelete = async (note: Note) => {
    const ok = await confirm(
      isAr
        ? "حذف الإجراء ده؟ هيتشال كمان من السجل المالي."
        : "Delete this service? Its charge is removed from the ledger too."
    );
    if (!ok) return;
    try {
      // One call: the charge goes with the treatment, and the server refuses the delete outright
      // once money has been collected against it.
      await deleteProcedure(note.id);
      showToast(isAr ? "تم الحذف" : "Deleted", "info");
    } catch (e) {
      showToast(
        e instanceof MoneyApiError ? e.message : isAr ? "خطأ في الحذف" : "Could not delete that service",
        "error"
      );
    }
  };

  const handleQuickAdd = async () => {
    const svc = services.find((s) => String(s.id) === String(procServiceId));
    if (!svc) {
      showToast(isAr ? "اختر خدمة" : "Select a service", "error");
      return;
    }
    // Attribution follows the appointment's dentist, never whoever is clicking — a receptionist
    // recording a procedure must not become the person it pays out to.
    if (!appointment?.doctorId) {
      showToast(
        isAr
          ? "الموعد ده مش متسجل عليه دكتور — عدّل الموعد الأول"
          : "This visit has no dentist assigned. Set one on the appointment first.",
        "error"
      );
      return;
    }

    setAddingProcedure(true);
    try {
      const today = new Date();
      const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split("T")[0];

      await createProcedure({
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        procedures: [svc.name],
        selectedTeeth: [],
        tooth: "Gen",
        unitCost: Number(procCost) || 0,
        doctorId: appointment.doctorId,
        status: "Completed",
        date: localDate,
        addToLedger: addProcToLedger,
      });

      showToast(
        addProcToLedger
          ? isAr
            ? "تمت إضافة الإجراء للسجل المالي والملاحظات"
            : "Service added to ledger & notes"
          : isAr
          ? "تمت إضافة الإجراء للملاحظات السريرية"
          : "Service added to clinical notes",
        "success"
      );
      setProcServiceId("");
      setProcCost("");
      setAddProcToLedger(true);
    } catch (err) {
      showToast(
        err instanceof MoneyApiError ? err.message : isAr ? "خطأ في إضافة الإجراء" : "Error adding service",
        "error"
      );
    } finally {
      setAddingProcedure(false);
    }
  };

  if (!patientId) {
    return (
      <p className="text-sm text-center text-slate-400 italic py-6">
        {isAr ? "الموعد ده مش مربوط بمريض" : "This appointment has no patient on file"}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* This visit */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-light text-slate-800 text-base uppercase tracking-widest flex items-center gap-2">
            <Stethoscope size={16} className="text-slate-400" /> {isAr ? "خدمات الزيارة" : "This Visit"}
          </h3>
          {visitTotal > 0 && (
            <span className="text-sm font-black text-ink-body">
              {visitTotal.toLocaleString()} <span className="text-[10px] text-slate-400">EGP</span>
            </span>
          )}
        </div>

        {notesLoading ? (
          <div className="flex justify-center p-4">
            <Loader2 className="animate-spin text-slate-300" size={22} />
          </div>
        ) : visitNotes.length === 0 ? (
          <p className="text-sm text-center text-slate-400 italic py-3">
            {isAr ? "مفيش خدمات متسجلة على الزيارة دي" : "No services recorded on this visit yet"}
          </p>
        ) : (
          <div className="space-y-2">
            {visitNotes.map((note) => (
              <ServiceItem
                key={note.id}
                note={note}
                compact
                onEdit={openEditor}
                onDelete={handleDelete}
                onMove={() => {}}
                onContinue={() => {}}
              />
            ))}
          </div>
        )}
      </div>

      {/* Quick add — service, cost, ledger. Everything else is one button away. */}
      <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100">
        <label className="text-xs font-extrabold text-ink-muted uppercase tracking-wider block mb-1.5">
          {isAr ? "إضافة سريعة" : "Quick Add"}
        </label>
        <div className="flex flex-col gap-3">
          <ServiceCombobox
            services={services}
            value={procServiceId}
            onChange={(val: string, svc: any) => {
              setProcServiceId(val);
              if (svc?.price) setProcCost(Number(svc.price));
            }}
            valueKey="id"
            placeholder={isAr ? "اختر الخدمة..." : "Select service..."}
            language={language}
            className="w-full text-sm py-2 font-bold border border-line rounded-lg bg-surface"
          />
          <div className="relative">
            <div className="absolute inset-y-0 start-0 ps-2.5 flex items-center pointer-events-none text-slate-400">
              <DollarSign size={14} />
            </div>
            <input
              type="number"
              value={procCost}
              onChange={(e) => setProcCost(e.target.value ? Number(e.target.value) : "")}
              className="w-full ps-9 pe-3 py-2.5 text-sm font-black text-slate-800 border border-line rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 bg-surface"
              placeholder="0"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={addProcToLedger}
              onChange={(e) => setAddProcToLedger(e.target.checked)}
              className="w-4 h-4 rounded border-line-strong text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm font-bold text-ink-body">{isAr ? "إضافة للسجل المالي" : "Add to Ledger"}</span>
          </label>
          <div className="flex gap-2">
            <button
              disabled={addingProcedure || !procServiceId || (!procCost && procCost !== 0)}
              onClick={handleQuickAdd}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-[38px] px-4 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {addingProcedure ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {isAr ? "تأكيد" : "Confirm"}
            </button>
            <button
              onClick={() => openEditor(null)}
              className="text-sm font-bold text-ink-body bg-surface border border-line hover:bg-surface-muted rounded-lg h-[38px] px-4 flex items-center justify-center gap-1.5 transition-colors"
              title={isAr ? "أسنان، خصم، حالة، صور" : "Teeth, discount, status, photos"}
            >
              <Plus size={16} /> {isAr ? "تفاصيل أكتر" : "Full editor"}
            </button>
          </div>
        </div>
      </div>

      {/* The rest of the patient's treatments, so a price typed wrong last week is fixable here. */}
      {otherNotes.length > 0 && (
        <div>
          <button
            onClick={() => setShowOther((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-black text-ink-muted uppercase tracking-widest py-2"
          >
            <span>
              {isAr ? "زيارات تانية" : "Other visits"} ({otherNotes.length})
            </span>
            <ChevronDown size={16} className={`transition-transform ${showOther ? "rotate-180" : ""}`} />
          </button>
          {showOther && (
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 animate-in slide-in-from-top-2 duration-200">
              {otherNotes.map((note) => (
                <ServiceItem
                  key={note.id}
                  note={note}
                  compact
                  onEdit={openEditor}
                  onDelete={handleDelete}
                  onMove={() => {}}
                  onContinue={() => {}}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {editorOpen && (
        <ServiceEditorDrawer
          isOpen={editorOpen}
          inline={false}
          onClose={closeEditor}
          patientId={patientId}
          patientName={appointment?.patientName || ""}
          appointmentId={editorApptId}
          branchId={appointment?.branchId || null}
          initialNote={editingNote}
          servicesList={services}
          teethData={teethData}
          treatments={treatments}
          doctors={doctors}
          onSaved={closeEditor}
        />
      )}
    </div>
  );
}
