"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, getDocs, doc, updateDoc, serverTimestamp, deleteDoc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { treatmentsByTooth } from "@/lib/toothTreatments";
import { suggestCategory } from "@/lib/dentalIcons";
import { useAuth } from "@/context/AuthContext";
import { isDentistStaff } from "@/lib/staffRoles";
import { Note, RelatedAppointment, Staff, Service } from "./types";
import TimelineCard from "./TimelineCard";
import ServiceEditorDrawer from "./ServiceEditorDrawer";
import ChartWorkspace from "./ChartWorkspace";
import TransferServiceModal from "./TransferServiceModal";
import { parseTeethString } from "./utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { MoneyApiError, continueProcedure, deleteProcedure, moveProcedure } from "@/lib/moneyApi";
import type { ToothData } from "@/lib/diagnosisCatalog";
import { FlaskConical, X } from "lucide-react";
import LabCaseModal from "@/components/lab/LabCaseModal";
import { useActiveBranch, ALL_BRANCHES } from "@/lib/useActiveBranch";
import { LABS_SETTINGS_DOC, parseDentalLabs, type DentalLab } from "@/lib/dentalLabs";
import type { LabCaseSeed } from "@/lib/labCases";
import { getDoc } from "firebase/firestore";

export default function ClinicalNotesContainer({
  patientId,
  teethData,
  onWriteRx,
}: {
  patientId: string;
  teethData?: Record<string, ToothData>;
  onWriteRx?: () => void;
}) {
  const { language } = useLanguage();
  const { showToast, confirm, clinicalEditorMode, clinicalEditorModeChosen } = useUI();
  const { user } = useAuth();

  const [notes, setNotes] = useState<Note[]>([]);
  const [appointments, setAppointments] = useState<RelatedAppointment[]>([]);
  const [patientName, setPatientName] = useState<string>("Unknown Patient");
  
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [servicesList, setServicesList] = useState<Service[]>([]);

  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkIsDesktop = () => setIsDesktop(window.innerWidth >= 1024);
    checkIsDesktop();
    window.addEventListener("resize", checkIsDesktop);
    return () => window.removeEventListener("resize", checkIsDesktop);
  }, []);

  /**
   * Which editor this screen actually uses.
   *
   * This used to be `isDesktop` alone, and that is why the Interface setting appeared broken:
   * any window wider than 1024px got the chart-first workspace and `clinicalEditorMode` was never
   * read at all. Choosing "Pop-up Modal" on a laptop did nothing, with no way to tell whether the
   * setting or the feature was at fault.
   *
   * An explicit choice now wins at every width. Someone who has never opened the setting keeps
   * exactly what they have today — the workspace on a wide screen, the sheet on a phone — because
   * a layout should not rearrange itself because a preference grew a third option.
   */
  /**
   * What has been done to each tooth, read off the notes this screen already has.
   *
   * Derived here rather than stored on the patient: `teethData` is written wholesale with no
   * per-tooth history, so a note later edited to a different tooth or deleted outright would leave
   * a treatment painted on the chart with nothing behind it — and nobody would notice for months.
   * Recomputing from the notes cannot drift from them, because it is them.
   */
  const treatments = useMemo(() => {
    const categoryById = new Map(servicesList.map((s) => [s.id, s.category]));
    return treatmentsByTooth(
      notes,
      (id) => categoryById.get(id) || undefined,
      // A clinic that types procedures instead of picking them off the price list still gets a
      // chart, using the same keyword guess the price list itself uses when a service is created.
      (name) => suggestCategory(name)
    );
  }, [notes, servicesList]);

  const useInlineWorkspace = clinicalEditorModeChosen
    ? clinicalEditorMode === "inline"
    : isDesktop;

  // Drawer state (mobile, and any desktop user who has not been switched over yet)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerContextApptId, setDrawerContextApptId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  /**
   * Chart-first desktop workspace. The tooth selection lives here rather than inside the editor
   * because the chart sits above the form — clicking teeth is the first thing you do, before the
   * form has been touched at all.
   */
  const [workspaceTeeth, setWorkspaceTeeth] = useState<string[]>([]);
  /** Bumped after saving a new procedure, to remount the inline form back to a blank one. */
  const [workspaceFormNonce, setWorkspaceFormNonce] = useState(0);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Transfer state
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferAction, setTransferAction] = useState<"move" | "continue">("move");
  const [transferNote, setTransferNote] = useState<Note | null>(null);

  /**
   * The lab-order prompt, owned here rather than by the editor that raises it.
   *
   * The editor is gone by the time this matters: on mobile a successful save closes the drawer,
   * and on desktop the inline form is remounted with a new `key` to reset it. State held there
   * would be destroyed in the same tick it was set. This container survives both.
   */
  const [labSeed, setLabSeed] = useState<LabCaseSeed | null>(null);
  const [labModalOpen, setLabModalOpen] = useState(false);
  const [labs, setLabs] = useState<DentalLab[]>([]);
  const { branches: labBranches, activeBranchId: labActiveBranchId } = useActiveBranch();

  /**
   * Offer the order, and say what it is for.
   *
   * A prompt rather than opening the form outright: not every crown goes to a lab the same day,
   * and a modal that appears unbidden over a screen someone is still working in gets dismissed
   * on reflex — including the times it was right.
   */
  const offerLabOrder = (seed?: LabCaseSeed) => {
    if (!seed) return;
    setLabSeed(seed);
  };

  /**
   * The lab directory, loaded only once a lab order has actually been offered.
   *
   * Every patient file mounts this container, and almost none of them lead to a lab case — so the
   * read is deferred until the prompt appears rather than paid on every visit.
   */
  useEffect(() => {
    if (!labSeed || labs.length > 0) return;
    getDoc(getClinicDoc("settings", LABS_SETTINGS_DOC))
      .then((snap) => setLabs(parseDentalLabs(snap.exists() ? snap.data() : null)))
      .catch(() => {
        /* An unreadable directory leaves the picker empty and the modal explains why. */
      });
  }, [labSeed, labs.length]);

  useEffect(() => {
    if (!patientId) return;

    // Fetch Patient Name
    getDocs(query(getClinicCollection("patients"), where("__name__", "==", patientId))).then((snap) => {
      if (!snap.empty) {
        setPatientName(snap.docs[0].data().name || "Unknown Patient");
      }
    });

    // Fetch Notes
    const qNotes = query(getClinicCollection("clinical_notes"), where("patientId", "==", patientId));
    const unsubNotes = onSnapshot(qNotes, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note));
      setNotes(data);
    });

    // Fetch Appointments
    const qAppts = query(getClinicCollection("appointments"), where("patientId", "==", patientId));
    const unsubAppts = onSnapshot(qAppts, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RelatedAppointment));
      // Sort appointments newest first
      data.sort((a, b) => {
        const aMs = a.createdAt?.toMillis?.() || 0;
        const bMs = b.createdAt?.toMillis?.() || 0;
        return bMs - aMs;
      });
      setAppointments(data);
    });

    // Fetch Lookups
    getDocs(getClinicCollection("staff")).then(snap => {
        setDoctors(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Staff).filter(s => isDentistStaff(s)));
    });
    getDocs(getClinicCollection("services")).then(snap => {
        setServicesList(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Service).sort((a,b) => a.name.localeCompare(b.name)));
    });

    return () => { unsubNotes(); unsubAppts(); };
  }, [patientId]);

  // Derived State
  const generalNotes = notes.filter(n => !n.appointmentId && !appointments.some(a => a.clinicalNoteId === n.id));
  
  const scrollToWorkspace = () => {
    workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Handlers for Services
  const handleAddGeneral = () => {
    setDrawerContextApptId(null);
    setEditingNote(null);
    if (useInlineWorkspace) {
      // Nothing to open — the form is already on the page. Clear it and take the user to it.
      setWorkspaceTeeth([]);
      setWorkspaceFormNonce((n) => n + 1);
      scrollToWorkspace();
      return;
    }
    setIsDrawerOpen(true);
  };

  const handleAddAppointmentService = (apptId: string) => {
    setDrawerContextApptId(apptId);
    setEditingNote(null);
    if (useInlineWorkspace) {
      setWorkspaceTeeth([]);
      setWorkspaceFormNonce((n) => n + 1);
      scrollToWorkspace();
      return;
    }
    setIsDrawerOpen(true);
  };

  const handleEditService = (note: Note) => {
    setEditingNote(note);
    setDrawerContextApptId(note.appointmentId || null);
    if (useInlineWorkspace) {
      // Load the note's teeth back onto the chart so the edit reads the same as the entry did.
      setWorkspaceTeeth(parseTeethString(note.tooth || ""));
      scrollToWorkspace();
      return;
    }
    setIsDrawerOpen(true);
  };

  const handleWorkspaceCancelEdit = () => {
    setEditingNote(null);
    setDrawerContextApptId(null);
    setWorkspaceTeeth([]);
    setWorkspaceFormNonce((n) => n + 1);
  };

  const handleWorkspaceSaved = (seed?: LabCaseSeed) => {
    setEditingNote(null);
    setDrawerContextApptId(null);
    setWorkspaceTeeth([]);
    setWorkspaceFormNonce((n) => n + 1);
    offerLabOrder(seed);
  };

  const handleDeleteService = async (note: Note) => {
    if (!(await confirm("Delete this record? Any linked finance rows will also be removed."))) return;

    try {
      // Deleting a treatment takes its charge with it, in both link directions — and is refused
      // outright when money has been collected against it. That last rule is new here: this screen
      // never checked, so a paid-for treatment could be removed from the timeline while its
      // payments stayed behind pointing at nothing.
      await deleteProcedure(note.id);
      showToast("Record deleted", "info");
    } catch (error) {
      showToast(error instanceof MoneyApiError ? error.message : "Could not delete that record", "error");
    }
  };

  /**
   * Persist a hand-arranged order.
   *
   * Only the notes whose position actually moved are written, and the onSnapshot listener above
   * brings the new order back — so there is no local copy of the list to keep in step, and two
   * people arranging the same patient converge on whatever was saved last rather than each seeing
   * their own version.
   */
  const handleReorder = async (changes: { id: string; sortIndex: number }[]) => {
    if (changes.length === 0) return;
    try {
      await Promise.all(
        changes.map((change) => updateDoc(getClinicDoc("clinical_notes", change.id), { sortIndex: change.sortIndex }))
      );
    } catch (error) {
      console.error("Failed to save the new order", error);
      showToast("Could not save the new order", "error");
    }
  };

  const openTransferModal = (note: Note, action: "move" | "continue") => {
    setTransferNote(note);
    setTransferAction(action);
    setTransferModalOpen(true);
  };

  const handleConfirmTransfer = async (targetApptId: string) => {
    if (!transferNote) return;

    try {
      if (transferAction === "move") {
        // The charge follows the treatment so their dates stay in step; doing it in two client
        // writes meant a failure between them left the ledger dated to the old visit.
        await moveProcedure(transferNote.id, targetApptId);
        showToast("Service moved to appointment", "success");
      } else {
        // A continuation is the same treatment across two visits. The clone carries no cost and no
        // ledger link, because the work was already invoiced once.
        await continueProcedure(transferNote.id, targetApptId);
        showToast("Service continued in appointment", "success");
      }
      setTransferModalOpen(false);
    } catch (error) {
      showToast(error instanceof MoneyApiError ? error.message : "Could not move that service", "error");
    }
  };

  const timeline = (
    <TimelineCard
      services={notes}
      appointments={appointments}
      onAddService={handleAddGeneral}
      onEditService={handleEditService}
      onDeleteService={handleDeleteService}
      onMoveService={(note) => openTransferModal(note, "move")}
      onContinueService={(note) => openTransferModal(note, "continue")}
      onReorder={handleReorder}
    />
  );

  const transferModal = transferNote ? (
    <TransferServiceModal
      isOpen={transferModalOpen}
      onClose={() => setTransferModalOpen(false)}
      onConfirm={handleConfirmTransfer}
      service={transferNote}
      appointments={appointments}
      actionType={transferAction}
    />
  ) : null;

  /**
   * The lab-order prompt and its form, built once and rendered by BOTH layouts.
   *
   * This container returns early for the desktop chart-first workspace, which is the DEFAULT on
   * a desktop browser. Holding this JSX only in the second return meant a dentist saving a crown
   * there set the seed and saw nothing at all — the whole prompt was dead on the layout most of
   * them use. Extracted the same way `transferModal` already is, for the same reason.
   */
  const labOrderUi = (
    <>
      {labSeed && !labModalOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-4 sm:p-6 pointer-events-none animate-in slide-in-from-bottom">
          <div className="max-w-lg mx-auto bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 p-4 flex items-start gap-3 pointer-events-auto">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center shrink-0">
              <FlaskConical size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black tracking-tight">
                {language === "ar" ? "الشغل ده محتاج معمل" : "This work needs a lab"}
              </p>
              <p className="text-xs font-semibold text-slate-400 mt-0.5 leading-relaxed">
                {language === "ar"
                  ? "اعمل أمر معمل دلوقتي — المريض والأسنان والطبيب متملّيين بالفعل."
                  : "Raise the lab order now — patient, teeth and dentist are already filled in."}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => setLabModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-white text-slate-900 text-[11px] font-black uppercase tracking-wide hover:bg-slate-200 transition-colors"
                >
                  {language === "ar" ? "اعمل أمر معمل" : "Create lab order"}
                </button>
                <button
                  onClick={() => setLabSeed(null)}
                  className="px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide text-slate-400 hover:text-white transition-colors"
                >
                  {language === "ar" ? "مش دلوقتي" : "Not now"}
                </button>
              </div>
            </div>
            <button
              onClick={() => setLabSeed(null)}
              className="p-1 text-slate-500 hover:text-white transition-colors shrink-0"
              aria-label={language === "ar" ? "إغلاق" : "Dismiss"}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <LabCaseModal
        open={labModalOpen}
        onClose={() => {
          setLabModalOpen(false);
          setLabSeed(null);
        }}
        seed={labSeed}
        labs={labs}
        branches={labBranches}
        defaultBranchId={
          // The inline desktop editor never receives a branchId, so the seed usually carries none.
          // The branch the person is standing in is the honest fallback; "All branches" is not a
          // place a case can physically be, so it resolves to none rather than to the first branch.
          labSeed?.branchId ||
          (labActiveBranchId && labActiveBranchId !== ALL_BRANCHES ? labActiveBranchId : "")
        }
        currentUserName={user?.name}
        onSaved={() => {
          setLabModalOpen(false);
          setLabSeed(null);
        }}
      />
    </>
  );

  /**
   * Desktop: chart on top, form under it, work done below that — no pop-up anywhere. The editor
   * modal/drawer preference still governs phones and tablets, where a full arch chart cannot sit
   * above a form and the sheet is the only thing that fits.
   */
  if (useInlineWorkspace) {
    return (
      <div className="w-full space-y-6 pb-6">
        <div ref={workspaceRef} className="scroll-mt-24">
          <ChartWorkspace
            patientId={patientId}
            patientName={patientName}
            teethData={teethData || {}}
            treatments={treatments}
            servicesList={servicesList}
            doctors={doctors}
            editingNote={editingNote}
            appointmentId={drawerContextApptId}
            selectedTeeth={workspaceTeeth}
            onSelectedTeethChange={setWorkspaceTeeth}
            onCancelEdit={handleWorkspaceCancelEdit}
            onSaved={handleWorkspaceSaved}
            formKey={editingNote?.id || `new-${workspaceFormNonce}`}
          />
        </div>

        {timeline}
        {labOrderUi}
        {transferModal}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Left Column: Cards */}
      <div className="flex-1 min-w-0 space-y-6 w-full pb-24 md:pb-6">
        {timeline}
      </div>

      {/* Mobile editor. The component portals itself as a sheet or a modal depending on the
          user's Interface setting; desktop never reaches this branch. */}
      {isDrawerOpen && (
        <ServiceEditorDrawer
          isOpen={isDrawerOpen}
          inline={false}
          onClose={() => {
            setIsDrawerOpen(false);
            setEditingNote(null);
            setDrawerContextApptId(null);
          }}
          patientId={patientId}
          patientName={patientName}
          appointmentId={drawerContextApptId}
          branchId={appointments.find((a) => a.id === drawerContextApptId)?.branchId || null}
          initialNote={editingNote}
          servicesList={servicesList}
          teethData={teethData || {}}
          treatments={treatments}
          doctors={doctors}
          onSaved={(seed) => {
            setIsDrawerOpen(false);
            setEditingNote(null);
            setDrawerContextApptId(null);
            offerLabOrder(seed);
          }}
        />
      )}


      {labOrderUi}
      {transferModal}
    </div>
  );
}
