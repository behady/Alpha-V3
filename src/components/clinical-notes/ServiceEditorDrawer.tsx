"use client";

import { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { X, Save, CheckCircle2, Loader2, Camera, Edit2 } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, where, deleteDoc, getDoc } from "firebase/firestore";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { resolveProcedureLedgerIdForNote, syncProcedureAndPaymentsFromClinicalNote } from "@/lib/syncProcedurePaymentLabFee";
import ServiceCombobox from "@/components/shared/ServiceCombobox";
import { isDentistStaff } from "@/lib/staffRoles";
import { Note, Service, Staff, LabInfo } from "./types";
import { ALL_TEETH, UPPER_LEFT_TEETH, UPPER_RIGHT_TEETH, LOWER_LEFT_TEETH, LOWER_RIGHT_TEETH, IMPRESSION_TYPES, compressImage, computeProcedureLabFee, labServiceUnitPrice, parseTeethString, normalizeImpressionType } from "./utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  appointmentId: string | null;
  initialNote: Note | null;
  servicesList: Service[];
  doctors: Staff[];
  labs: LabInfo[];
  onSaved: () => void;
  inline?: boolean;
}

export default function ServiceEditorDrawer({
  isOpen, onClose, patientId, patientName, appointmentId, initialNote, servicesList, doctors, labs, onSaved, inline = false
}: Props) {
  const { showToast, clinicalEditorMode } = useUI();
  const { language } = useLanguage();
  const { user } = useAuth();

  // Form State
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tooth, setTooth] = useState("");
  const [selectedTeeth, setSelectedTeeth] = useState<string[]>([]);
  const [procedure, setProcedure] = useState("");
  const [multiProceduresText, setMultiProceduresText] = useState("");
  const [cost, setCost] = useState("");
  const [noteText, setNoteText] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [procedureStatus, setProcedureStatus] = useState<'Planned' | 'Ongoing' | 'Completed'>('Planned');
  const [addToLedger, setAddToLedger] = useState(true);
  const [linkedLedgerId, setLinkedLedgerId] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState("");
  const [isChangingService, setIsChangingService] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;
    if (initialNote) {
      setDate(initialNote.date || new Date().toISOString().split("T")[0]);
      setTooth(initialNote.tooth || "");
      setSelectedTeeth(parseTeethString(initialNote.tooth || ""));
      setProcedure(initialNote.serviceName || initialNote.procedure || initialNote.title || "");
      setProcedureStatus(initialNote.status || 'Planned');
      setIsChangingService(false);
      setMultiProceduresText((initialNote.procedures || []).slice(1).join("\n"));
      setCost(initialNote.unitCost != null ? String(initialNote.unitCost) : (initialNote.cost != null ? String(initialNote.cost) : ""));
      setNoteText(initialNote.note || "");
      
      if (initialNote.doctorId) {
          setSelectedDoctorId(initialNote.doctorId);
      } else if (initialNote.doctor) {
          const docObj = doctors.find(d => d.name === initialNote.doctor);
          if (docObj) setSelectedDoctorId(docObj.id);
      }
      
      setAddToLedger(!!initialNote.ledgerId || Number(initialNote.cost) > 0);
      setLinkedLedgerId(initialNote.ledgerId || null);
      
      // resolve ledger id asynchronously
      resolveProcedureLedgerIdForNote(initialNote.id, initialNote.ledgerId).then((resolvedId) => {
        if (resolvedId) {
          setLinkedLedgerId(resolvedId);
          setAddToLedger(true);
        }
      });
    } else {
      // Reset form
      setDate(new Date().toISOString().split('T')[0]);
      setTooth(""); setSelectedTeeth([]);
      setProcedure(""); setMultiProceduresText(""); setCost(""); setNoteText("");
      setProcedureStatus('Planned');
      setAddToLedger(true); setLinkedLedgerId(null);
      setIsChangingService(false);
      
      const defaultDocId = (user && isDentistStaff(user))
          ? (doctors.find(d => d.name.toLowerCase() === user.name.toLowerCase() || d.id === user.uid)?.id || doctors[0]?.id)
          : doctors[0]?.id;
      if (defaultDocId) setSelectedDoctorId(defaultDocId);
    }
  }, [isOpen, initialNote, doctors, user]);

  const txt = {
    title: initialNote ? (language === "ar" ? "تعديل الإجراء" : "Edit Procedure") : (language === "ar" ? "إجراء جديد" : "New Procedure"),
    date: language === 'ar' ? "التاريخ" : "Date",
    procedure: language === 'ar' ? "الإجراء" : "Procedure Name",
    cost: language === 'ar' ? "التكلفة" : "Cost (EGP)",
    notes: language === 'ar' ? "ملاحظات" : "Note",
    selectDoctor: language === 'ar' ? "اختر الطبيب" : "Select Doctor",
    status: language === 'ar' ? "الحالة" : "Status",
    save: language === 'ar' ? "حفظ الإجراء" : "Log Procedure",
    cancel: language === 'ar' ? "إلغاء" : "Cancel",
    addToFinance: language === 'ar' ? "إضافة للمالية" : "Add to Ledger",
    selectError: language === 'ar' ? "اختر الإجراء والطبيب" : "Select a procedure AND doctor",
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return; // Fix Scenario 1: Double-click protection
    if (!selectedDoctorId || (!procedure && !multiProceduresText)) return showToast(txt.selectError, "error");
    if (Number(cost) < 0) return showToast(language === 'ar' ? "لا يمكن إضافة تكلفة بالسالب" : "Cannot add negative cost", "error"); // Fix Scenario 2: Negative typo protection

    setIsSaving(true);
    setSaveStatusText("Saving to Database...");

    try {
      const extraProcedures = multiProceduresText.split("\n").map((s) => s.trim()).filter(Boolean);
      const parsedProcedures = [procedure.trim(), ...extraProcedures].filter(Boolean);
      const procedures = Array.from(new Set(parsedProcedures));
      
      const matchedServices = procedures.map((name) => servicesList.find((s) => s.name === name)).filter((s): s is Service => Boolean(s));
      const inferredCost = matchedServices.length > 0 ? matchedServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0) : 0;
      const unitCost = Number(cost) || inferredCost;
      const pricingUnits = Math.max(selectedTeeth.length, 1);
      const numCost = unitCost * pricingUnits;
      const pricingFormula = `${unitCost}*${pricingUnits}`;
      const selectedDocObj = doctors.find(d => d.id === selectedDoctorId);
      const docName = selectedDocObj?.name || "Unknown Doctor";
      const selectedToothText = selectedTeeth.length > 0 ? selectedTeeth.join(",") : (tooth || "Gen");
      const displayProcedure = procedures.join(" + ");
      
      const noteData = { 
          // If editing, preserve old appt if no appointmentId context was explicitly passed,
          // otherwise if adding, use appointmentId context.
          appointmentId: initialNote ? initialNote.appointmentId : (appointmentId || null),
          tooth: selectedToothText, 
          procedure: displayProcedure,
          procedures,
          cost: numCost, 
          unitCost,
          unitsCount: pricingUnits,
          pricingFormula,
          note: noteText, 
          doctor: docName, 
          doctorId: selectedDoctorId,
          date, 
          status: procedureStatus,
      }; 

      const { labFee, labFeePerUnit, reqLab } = computeProcedureLabFee({
        needsLabOrderNow: false, formLabId: "", formLabService: "", labs: [], matchedServices, pricingUnits,
      });

      const commPct = Number(selectedDocObj?.commissionPercentage || 0);
      const netAmount = numCost - labFee;
      const doctorCommissionAmount = netAmount > 0 ? (netAmount * (commPct / 100)) : 0;
      const clinicProfit = numCost - doctorCommissionAmount - labFee; 

      const ledgerProcedureFields = {
        patientId,
        patientName,
        type: "procedure" as const,
        category: "Treatment",
        amount: numCost, cost: numCost, unitCost, unitsCount: pricingUnits, pricingFormula,
        description: `${displayProcedure} (T: ${selectedToothText}) | ${pricingFormula}=${numCost}`,
        doctorId: selectedDoctorId, doctorName: docName, doctorCommissionPercentage: commPct,
        date, labFee, labFeePerUnit, labOrderService: "",
        doctorCommissionAmount, clinicProfit,
        appointmentId: appointmentId || null,
      };

      const cleanData = (obj: any) => Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));

      if (initialNote) {
          let procLedgerId = linkedLedgerId || (await resolveProcedureLedgerIdForNote(initialNote.id));
          const noteLedgerId = addToLedger ? procLedgerId : null;
          const cleanNoteData = cleanData({ ...noteData, ledgerId: noteLedgerId });

          await updateDoc(getClinicDoc("clinical_notes", initialNote.id), cleanNoteData);

          if (addToLedger) {
              const linkedLedgerData = cleanData({ ...ledgerProcedureFields, clinicalNoteId: initialNote.id });
              if (procLedgerId) {
                await syncProcedureAndPaymentsFromClinicalNote(procLedgerId, linkedLedgerData, labFee, commPct);
              } else {
                  const ref = await addDoc(getClinicCollection("ledger"), cleanData({ ...linkedLedgerData, paid: 0, createdAt: serverTimestamp() }));
                  procLedgerId = ref.id;
                  await updateDoc(getClinicDoc("clinical_notes", initialNote.id), { ledgerId: ref.id });
              }
          } else if (procLedgerId) {
            await deleteDoc(getClinicDoc("ledger", procLedgerId));
          }

          // Sync back to linked appointment
          const apptId = initialNote.appointmentId;
          if (apptId) {
            const apptDoc = await getDoc(getClinicDoc("appointments", apptId));
            if (apptDoc.exists()) {
              const apptData = apptDoc.data();
              let apptServices = apptData.services || [];
              let updated = false;

              apptServices = apptServices.map((s: any) => {
                if (s.clinicalNoteId === initialNote.id) {
                  updated = true;
                  return {
                    ...s,
                    status: procedureStatus,
                    cost: numCost,
                    listPrice: numCost,
                    serviceName: displayProcedure,
                    ledgerId: noteLedgerId || null,
                  };
                }
                return s;
              });

              if (updated) {
                const newTotalCost = apptServices.reduce((sum: number, s: any) => sum + (Number(s.cost) || 0), 0);
                const newTotalListPrice = apptServices.reduce((sum: number, s: any) => sum + (Number(s.listPrice) || Number(s.cost) || 0), 0);
                await updateDoc(getClinicDoc("appointments", apptId), {
                  services: apptServices,
                  listPrice: newTotalListPrice,
                  cost: apptData.discountMode && apptData.discountMode !== 'none' ? Math.max(0, newTotalListPrice - (Number(apptData.discountAmount) || 0)) : newTotalListPrice
                });
              }
            }
          }
      } else {
          let newLedgerId = null;
          if (addToLedger && numCost > 0) {
              const ref = await addDoc(getClinicCollection("ledger"), cleanData({ ...ledgerProcedureFields, paid: 0, createdAt: serverTimestamp() }));
              newLedgerId = ref.id;
          }
          const noteRef = await addDoc(getClinicCollection("clinical_notes"), cleanData({
            patientId, createdAt: serverTimestamp(), ...noteData, ledgerId: newLedgerId,
          }));
          if (newLedgerId) {
            await updateDoc(getClinicDoc("ledger", newLedgerId), { clinicalNoteId: noteRef.id });
            await syncProcedureAndPaymentsFromClinicalNote(newLedgerId, { ...ledgerProcedureFields, clinicalNoteId: noteRef.id }, labFee, commPct);
          }
          
          if (appointmentId) {
            const apptDoc = await getDoc(getClinicDoc("appointments", appointmentId));
            if (apptDoc.exists()) {
              const apptData = apptDoc.data();
              const svcs = apptData.services || [];
              if (apptData.serviceId && svcs.length === 0) {
                svcs.push({
                  serviceId: apptData.serviceId,
                  serviceName: apptData.serviceName || apptData.treatment || "",
                  cost: Number(apptData.cost) || 0,
                  listPrice: Number(apptData.listPrice) || Number(apptData.cost) || 0,
                  status: "Planned"
                });
              }
              svcs.push({
                serviceId: matchedServices[0]?.id || "",
                serviceName: matchedServices[0]?.name || displayProcedure,
                cost: numCost,
                listPrice: numCost,
                clinicalNoteId: noteRef.id,
                ledgerId: newLedgerId,
                status: procedureStatus
              });
              const newTotalCost = svcs.reduce((sum: number, s: any) => sum + (Number(s.cost) || 0), 0);
              const newTotalListPrice = svcs.reduce((sum: number, s: any) => sum + (Number(s.listPrice) || Number(s.cost) || 0), 0);
              await updateDoc(getClinicDoc("appointments", appointmentId), { 
                services: svcs,
                listPrice: newTotalListPrice,
                cost: apptData.discountMode && apptData.discountMode !== 'none' ? Math.max(0, newTotalListPrice - (Number(apptData.discountAmount) || 0)) : newTotalListPrice
              });
            }
          }
      }
      
      showToast(initialNote ? "Procedure Updated" : "Procedure Logged", "success");
      onSaved();
      onClose();
    } catch (err) { 
        showToast("Error saving procedure", "error"); 
        console.error(err);
    } finally {
        setIsSaving(false);
        setSaveStatusText("");
    }
  };

  const handleProcedureChange = (val: string, svc?: any) => {
    const matchedSvc = svc || servicesList.find(s => s.name === val || String(s.id) === val);
    setProcedure(matchedSvc ? matchedSvc.name : val);
    if (matchedSvc) {
      setCost(matchedSvc.price.toString());
    }
  };

  const toggleTooth = (value: string, setter: Dispatch<SetStateAction<string[]>>) => {
    setter((prev) => (prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]));
  };

  const TeethChartSelector = ({ selected, onToggle }: { selected: string[]; onToggle: (toothCode: string) => void }) => {
    const activeClass = "bg-blue-600 text-white border-blue-600";
    const idleClass = "bg-white text-slate-600 border-slate-200 hover:border-blue-300";

    const Row = ({ left, right }: { left: string[]; right: string[] }) => (
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-8 gap-1">
          {left.map((toothCode) => (
            <button
              key={toothCode} type="button" onClick={() => onToggle(toothCode)}
              className={`text-[10px] font-black py-1.5 rounded-md border transition-colors ${selected.includes(toothCode) ? activeClass : idleClass}`}
            >
              {toothCode}
            </button>
          ))}
        </div>
        <div className="w-3 h-0.5 bg-slate-300 rounded-full shrink-0" />
        <div className="grid flex-1 grid-cols-8 gap-1">
          {right.map((toothCode) => (
            <button
              key={toothCode} type="button" onClick={() => onToggle(toothCode)}
              className={`text-[10px] font-black py-1.5 rounded-md border transition-colors ${selected.includes(toothCode) ? activeClass : idleClass}`}
            >
              {toothCode}
            </button>
          ))}
        </div>
      </div>
    );

    return (
      <div className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-2xl min-w-0">
        <p className="text-[10px] font-bold text-slate-500 mb-2">Select teeth from chart</p>
        <div className="space-y-2 max-h-[156px] overflow-y-auto pr-1">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Upper jaw</p>
            <Row left={UPPER_LEFT_TEETH} right={UPPER_RIGHT_TEETH} />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Lower jaw</p>
            <Row left={LOWER_LEFT_TEETH} right={LOWER_RIGHT_TEETH} />
          </div>
        </div>
      </div>
    );
  };

  const content = (
    <div 
      className={`w-full bg-white flex flex-col ${!inline ? (clinicalEditorMode === 'modal' ? 'h-full max-h-[90vh] rounded-[2rem] shadow-2xl overflow-hidden' : 'h-full min-h-0 shadow-[0_4px_20px_-4px_rgba(6,81,237,0.1)] rounded-t-3xl rounded-b-none lg:rounded-3xl border border-slate-100 overflow-hidden') : 'rounded-2xl border border-slate-200 mt-4'}`}
    >
      {!inline && (
        <div className="flex items-center justify-between p-6 md:p-8 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">{txt.title}</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{patientName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}

      <div className={`flex-1 overflow-y-auto custom-scrollbar ${!inline ? 'p-6' : 'p-4 max-h-[500px]'}`}>
        <form id="service-form" onSubmit={handleSave} className="space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{txt.date}</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)} required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{txt.status}</label>
              <select
                value={procedureStatus} onChange={e => setProcedureStatus(e.target.value as any)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
              >
                <option value="Planned">Planned</option>
                <option value="Ongoing">Ongoing</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{txt.selectDoctor}</label>
            <select
              value={selectedDoctorId} onChange={e => setSelectedDoctorId(e.target.value)} required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="">Select doctor...</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-500 mb-1">{txt.procedure}</label>
            {initialNote && !isChangingService ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={procedure}
                  onChange={(e) => setProcedure(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setIsChangingService(true)}
                  className="p-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors"
                  title={language === "ar" ? "تغيير من القائمة" : "Change from list"}
                >
                  <Edit2 size={18} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <ServiceCombobox
                    services={servicesList} value={procedure} 
                    onChange={handleProcedureChange}
                    placeholder="Search procedures..."
                    valueKey="name"
                    allowFreeText
                  />
                </div>
                {initialNote && isChangingService && (
                  <button
                    type="button"
                    onClick={() => setIsChangingService(false)}
                    className="p-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl border border-slate-200 transition-colors"
                    title={language === "ar" ? "إلغاء" : "Cancel"}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            <textarea
              value={multiProceduresText} onChange={(e) => setMultiProceduresText(e.target.value)}
              placeholder="Additional procedures (one per line)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 min-h-[80px]"
            />
          </div>

          <TeethChartSelector selected={selectedTeeth} onToggle={(t) => toggleTooth(t, setSelectedTeeth)} />

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{txt.cost}</label>
            <input
              type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{txt.notes}</label>
            <textarea
              value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Clinical details..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 min-h-[100px]"
            />
          </div>

          {!(initialNote?.isContinued) && (
            <label className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
              <input
                type="checkbox" checked={addToLedger} onChange={(e) => setAddToLedger(e.target.checked)}
                className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <span className="text-sm font-bold text-slate-700">{txt.addToFinance}</span>
            </label>
          )}

        </form>
      </div>

      <div className={`p-6 border-t border-slate-100 bg-white shrink-0 ${!inline ? 'pb-24 lg:pb-6' : ''}`}>
        <button
          type="submit"
          form="service-form"
          disabled={isSaving}
          className="w-full flex justify-center items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-500/30 transition-all disabled:opacity-70"
        >
          {isSaving ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>{saveStatusText}</span>
            </>
          ) : (
            <>
              <Save size={20} />
              <span>{txt.save}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  if (inline) {
    return content;
  }

  if (!mounted) return null;

  if (clinicalEditorMode === 'modal') {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
        <div className="relative w-full max-w-4xl z-10 animate-in zoom-in-95 duration-200">
          {content}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full max-w-2xl z-50 transform transition-transform duration-300 translate-x-0">
        {content}
      </div>
    </div>,
    document.body
  );
}