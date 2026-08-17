"use client";

import { useState, useEffect, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot, query, where, getDocs, doc, updateDoc, serverTimestamp, deleteDoc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useAuth } from "@/context/AuthContext";
import { isDentistStaff } from "@/lib/staffRoles";
import { Note, RelatedAppointment, Staff, Service } from "./types";
import TimelineCard from "./TimelineCard";
import ServiceEditorDrawer from "./ServiceEditorDrawer";
import ChartWorkspace from "./ChartWorkspace";
import TransferServiceModal from "./TransferServiceModal";
import { parseTeethString } from "./utils";
import { resolveProcedureLedgerIdForNote } from "@/lib/syncProcedurePaymentLabFee";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
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
  const { showToast, confirm } = useUI();
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
    if (isDesktop) {
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
    if (isDesktop) {
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
    if (isDesktop) {
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
    
    const relatedRows = new Map<string, Record<string, unknown>>();
    const addLedgerRow = (id: string, data: Record<string, unknown>) => { if (!relatedRows.has(id)) relatedRows.set(id, { id, ...data }); };

    const byClinicalNoteSnap = await getDocs(query(getClinicCollection("ledger"), where("clinicalNoteId", "==", note.id)));
    byClinicalNoteSnap.docs.forEach(d => addLedgerRow(d.id, d.data()));

    if (note.ledgerId) {
      const legacySnap = await getDocs(query(getClinicCollection("ledger"), where("__name__", "==", note.ledgerId)));
      if (!legacySnap.empty) addLedgerRow(legacySnap.docs[0].id, legacySnap.docs[0].data());
    }

    await Promise.all([
      deleteDoc(getClinicDoc("clinical_notes", note.id)),
      ...Array.from(relatedRows.keys()).map(id => deleteDoc(getClinicDoc("ledger", id))),
    ]);
    showToast("Record deleted", "info");
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
    
    const targetAppt = appointments.find(a => a.id === targetApptId);
    const newDate = targetAppt ? targetAppt.date : transferNote.date;

    if (transferAction === "move") {
      // 1. Move updates appointmentId AND date
      const updates = {
        appointmentId: targetApptId,
        date: newDate
      };
      await updateDoc(getClinicDoc("clinical_notes", transferNote.id), updates);

      // 2. Also update the associated ledger date if it exists
      const byClinicalNoteSnap = await getDocs(query(getClinicCollection("ledger"), where("clinicalNoteId", "==", transferNote.id)));
      for (const d of byClinicalNoteSnap.docs) {
        await updateDoc(getClinicDoc("ledger", d.id), { date: newDate });
      }
      if (transferNote.ledgerId) {
        const legacySnap = await getDocs(query(getClinicCollection("ledger"), where("__name__", "==", transferNote.ledgerId)));
        if (!legacySnap.empty) {
          await updateDoc(getClinicDoc("ledger", legacySnap.docs[0].id), { date: newDate });
        }
      }

      showToast("Service moved to appointment", "success");
    } else {
      // Continue clones the note for the new appointment
      const clonedData = { ...transferNote };
      delete (clonedData as any).id;
      delete (clonedData as any).createdAt;
      delete (clonedData as any).ledgerId; // Don't carry over the old ledger ID
      
      // Fix double-billing: reset cost to 0 for the continued session
      clonedData.cost = 0;
      clonedData.unitCost = 0;
      clonedData.pricingFormula = "";
      
      const newNote = {
        ...clonedData,
        appointmentId: targetApptId,
        date: newDate,
        status: "Ongoing",
        isContinued: true,
        // A continuation is a new note in its own right, so it is signed by whoever continued it.
        // The clone carries the original note's author forward under `continuedFromName`.
        continuedFromName: (clonedData as any).createdByName || "",
        createdByUid: auth.currentUser?.uid || null,
        createdByName: user?.name || user?.email || "",
        createdAt: serverTimestamp(),
      };
      await addDoc(getClinicCollection("clinical_notes"), newNote);
      showToast("Service continued in appointment", "success");
    }
    
    setTransferModalOpen(false);
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
  if (isDesktop) {
    return (
      <div className="w-full space-y-6 pb-6">
        <div ref={workspaceRef} className="scroll-mt-24">
          <ChartWorkspace
            patientId={patientId}
            patientName={patientName}
            teethData={teethData || {}}
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
          initialNote={editingNote}
          servicesList={servicesList}
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
