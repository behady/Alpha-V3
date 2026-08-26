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

  const handleWorkspaceSaved = () => {
    setEditingNote(null);
    setDrawerContextApptId(null);
    setWorkspaceTeeth([]);
    setWorkspaceFormNonce((n) => n + 1);
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
          onSaved={() => {
            setIsDrawerOpen(false);
            setEditingNote(null);
            setDrawerContextApptId(null);
          }}
        />
      )}

      {transferModal}
    </div>
  );
}
