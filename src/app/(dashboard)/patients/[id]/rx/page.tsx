"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { 
  ArrowLeft, Printer, Plus, Trash2, Pill, Loader2, 
  MapPin, Phone, MessageCircle, Save 
} from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, onSnapshot, query, orderBy, addDoc, serverTimestamp } from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { prescriptionPayloadToPdfBlob } from "@/lib/prescriptionPdfHtml";
import { isDentistStaff } from "@/lib/staffRoles";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import PermissionGuard from "@/components/PermissionGuard";

interface Drug { id: string; name: string; dose: string; }
interface RxItem { id: string; name: string; dose: string; note: string; }

/**
 * Writing a prescription needs the same permission as saving one.
 *
 * This studio had no gate at all while the clinical history and the tooth chart beside it were
 * both guarded. firestore.rules refuses to store a prescription without `clinical.edit`, so an
 * unauthorised person hit an error only at Save — after filling the whole form. Everything
 * before that point still worked: the page rendered on clinic letterhead, Print produced a
 * finished prescription in a named doctor's name (printing touches no database and no rule can
 * see it), and Send put it on the patient's WhatsApp.
 *
 * `clinical.edit` deliberately matches what the rules demand and what the two PDF-sending routes
 * now demand, so all three doors answer the same question the same way. Guarding the export
 * rather than the inner component means an unauthorised visitor never mounts it, and the patient
 * read never fires.
 */
export default function PrescriptionStudioPage() {
  return (
    <PermissionGuard permission="clinical.edit">
      <PrescriptionStudio />
    </PermissionGuard>
  );
}

function PrescriptionStudio() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || "";
  const { showToast } = useUI();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<any>(null);
  const [clinicInfo, setClinicInfo] = useState<any>(null);
  
  // Drug Database & Staff
  const [drugDb, setDrugDb] = useState<Drug[]>([]);
  const [doctors, setDoctors] = useState<{name: string}[]>([]);
  
  // Prescription State
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [rxItems, setRxItems] = useState<RxItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [whatsappSending, setWhatsappSending] = useState(false);
  
  // Current Input State
  const [selectedDrugId, setSelectedDrugId] = useState("");
  const [customDrugName, setCustomDrugName] = useState("");
  const [currentDose, setCurrentDose] = useState("");
  const [currentNote, setCurrentNote] = useState("");

  useEffect(() => {
    if (!id) return;
    
    const fetchData = async () => {
      try {
        // Fetch Patient
        const pSnap = await getDoc(getClinicDoc("patients", id));
        if (pSnap.exists()) setPatient({ id: pSnap.id, ...pSnap.data() });

        // Fetch Clinic Settings
        const cSnap = await getDoc(getClinicDoc("settings", "clinic_info"));
        if (cSnap.exists()) setClinicInfo(cSnap.data());

        // Fetch Doctors
        const staffSnap = await getDocs(getClinicCollection("staff"));
        const docs = staffSnap.docs.map(d => d.data()).filter(s => isDentistStaff(s)) as any[];
        setDoctors(docs);
        if (docs.length > 0) setSelectedDoctor(docs[0].name);

      } catch (error) {
        showToast(t("rxLoadError"), "error");
      }
      setLoading(false);
    };

    fetchData();

    // Listen to Drug Shortcuts
    const unsubDrugs = onSnapshot(query(getClinicCollection("drugs"), orderBy("name")), (snap) => {
      setDrugDb(snap.docs.map(d => ({ id: d.id, ...d.data() } as Drug)));
    });

    return () => unsubDrugs();
  }, [id]);

  const handleDrugSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    setSelectedDrugId(selectedId);
    
    const drug = drugDb.find(d => d.id === selectedId);
    if (drug) {
      setCustomDrugName(drug.name);
      if (drug.dose) setCurrentDose(drug.dose);
    } else {
      setCustomDrugName("");
      setCurrentDose("");
    }
  };

  const addDrugToRx = () => {
    const finalName = customDrugName.trim();
    if (!finalName) return;

    const newItem: RxItem = {
      id: Date.now().toString(),
      name: finalName,
      dose: currentDose,
      note: currentNote
    };

    setRxItems([...rxItems, newItem]);
    setSelectedDrugId("");
    setCustomDrugName("");
    setCurrentDose("");
    setCurrentNote("");
  };

  const removeDrug = (itemId: string) => {
    setRxItems(rxItems.filter(item => item.id !== itemId));
  };

  const calculateAge = (dob: string) => {
    if (!dob) return "";
    const diff = Date.now() - new Date(dob).getTime();
    return Math.abs(new Date(diff).getUTCFullYear() - 1970).toString();
  };

  const savePrescriptionToHistory = async (extra?: { sharedViaWhatsapp?: boolean }) => {
    await addDoc(getClinicCollection("prescriptions"), {
      patientId: id,
      patientName: patient.name,
      date: new Date().toISOString().split("T")[0],
      // `doctor` is whose name is printed on the prescription; `createdByName` is who wrote it up.
      doctor: selectedDoctor,
      diagnosis,
      drugs: rxItems,
      mode: "typed",
      createdByUid: user?.uid || null,
      createdByName: user?.name || user?.email || "",
      createdAt: serverTimestamp(),
      ...extra,
    });
  };

  const handleSave = async () => {
    if (rxItems.length === 0) {
      showToast(t("rxNeedDrugSave"), "error");
      return;
    }
    setIsSaving(true);
    try {
      await savePrescriptionToHistory();
      showToast(
        t("rxSaved"),
        "success"
      );
    } catch (error) {
      console.error(error);
      showToast(t("rxSaveError"), "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    if (rxItems.length === 0) {
      showToast(t("rxNeedDrugPrint"), "error");
      return;
    }
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 300);
  };

  const handleShare = async () => {
    if (rxItems.length === 0) return showToast(t("rxNeedDrugShare"), "error");

    const u = auth.currentUser;
    if (!u) {
      showToast(t("rxWhatsappSignIn"), "error");
      return;
    }

    setWhatsappSending(true);
    try {
      await savePrescriptionToHistory({ sharedViaWhatsapp: true });

      const ageStr = calculateAge(patient.dateOfBirth || patient.age);
      const ageSex = `${ageStr || "?"} Y / ${patient.gender?.charAt(0) || "U"}`;
      const blob: Blob = await prescriptionPayloadToPdfBlob({
        clinicName: clinicInfo?.name || t("rxClinicFallback"),
        rxHeader: clinicInfo?.rxHeader || `Dr. ${selectedDoctor}`,
        dateLabel: new Date().toLocaleDateString("en-GB"),
        patientName: patient.name,
        ageSex,
        diagnosis: diagnosis || "",
        doctor: selectedDoctor,
        address: clinicInfo?.address || t("rxAddressFallback"),
        phone: clinicInfo?.phone || t("rxPhoneFallback"),
        rxItems,
      });

      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(t("rxPdfFailed")));
        reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(",");
      const pdfBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

      const token = await u.getIdToken();
      const res = await fetch("/api/whatsapp/send-prescription-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: id, pdfBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "WhatsApp send failed");
      }
      showToast(t("rxWhatsappSent"), "success");
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : t("rxWhatsappFailed"), "error");
    } finally {
      setWhatsappSending(false);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-surface-subtle"><Loader2 className="animate-spin text-accent" size={40}/></div>;
  if (!patient) return <div className="p-10 text-center font-black">{t("rxPatientNotFound")}</div>;

  return (
    <div className="min-h-screen bg-surface-subtle flex flex-col print:bg-surface print:min-h-0">
      
      {/* --- NON-PRINTABLE HEADER --- */}
      <header className="bg-surface border-b border-line px-6 py-4 sticky top-0 z-40 shadow-sm print:hidden">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <button onClick={() => router.push(`/patients/${id}`)} className="p-2.5 hover:bg-surface-muted rounded-2xl transition-colors text-ink-muted shrink-0">
              <ArrowLeft size={24} />
            </button>
            <div>
               <h1 className="text-2xl font-black text-ink tracking-tight flex items-center gap-2">
                 <Pill className="text-accent-soft" size={24}/> Prescription Studio
               </h1>
               <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mt-1">{t("rxGeneratingFor")} <span className="text-accent">{patient.name}</span></p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:justify-end">
             <button
                type="button"
                onClick={() => void handleSave()} data-tour="rx-save"
                disabled={isSaving || rxItems.length === 0}
                className="flex-1 md:flex-none bg-accent text-white hover:bg-accent px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
             >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                Save
             </button>
             <button
                type="button"
                onClick={() => void handleShare()}
                disabled={whatsappSending}
                className="flex-1 md:flex-none bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
             >
                {whatsappSending ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18}/>}
                WhatsApp
             </button>
             <button
                type="button"
                onClick={handlePrint}
                disabled={isPrinting || rxItems.length === 0}
                className="flex-1 md:flex-none bg-accent text-ink-on-accent hover:bg-accent-strong px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50"
             >
                {isPrinting ? <Loader2 size={18} className="animate-spin"/> : <Printer size={18}/>}
                Print
             </button>
          </div>
        </div>
      </header>

      {/* --- MAIN WORKSPACE --- */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full p-4 md:p-8 flex flex-col lg:flex-row gap-8 items-start print:p-0 print:m-0">
        
        {/* LEFT: CONTROL PANEL (HIDDEN ON PRINT) */}
        <div className="w-full lg:w-[400px] xl:w-[500px] shrink-0 space-y-6 print:hidden">
            
            {/* Meta Data */}
            <div className="bg-surface p-6 rounded-3xl border border-slate-200/60 shadow-sm space-y-5">
               <h3 className="font-black text-ink text-lg border-b border-slate-100 pb-3">{t("rxDetails")}</h3>
               
               <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxAttendingDoctor")}</label>
                  <select value={selectedDoctor} onChange={e => setSelectedDoctor(e.target.value)} className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all cursor-pointer">
                     {doctors.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                     {doctors.length === 0 && <option value="">{t("rxNoDoctors")}</option>}
                  </select>
               </div>

               <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxDiagnosisOptional")}</label>
                  <input value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder={t("rxDiagnosisPlaceholder")} className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"/>
               </div>
            </div>

            {/* Drug Adder */}
            <div className="bg-surface p-6 rounded-3xl border border-slate-200/60 shadow-sm space-y-5">
               <h3 className="font-black text-ink text-lg border-b border-slate-100 pb-3 flex items-center justify-between">
                  Add Medication
                  <span className="bg-accent-tint text-accent px-2 py-1 rounded-lg text-[10px] uppercase">
                    {rxItems.length} in Rx · {drugDb.length} shortcuts
                  </span>
               </h3>
               
               <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxSelectFromDb")}</label>
                  <select value={selectedDrugId} onChange={handleDrugSelect} className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all cursor-pointer">
                     <option value="">-- Manual Entry --</option>
                     {drugDb.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Drug Name Input (Always Accessible) */}
                  <div className="space-y-1.5 md:col-span-2">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">
                        Drug Name {selectedDrugId ? "(Selected from DB)" : ""}
                     </label>
                     <input 
                        value={customDrugName} data-tour="rx-drug-name" 
                        onChange={e => {
                          setCustomDrugName(e.target.value);
                          if (selectedDrugId) setSelectedDrugId("");
                        }} 
                        placeholder={t("rxDrugPlaceholder")} 
                        className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"
                     />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxDoseFrequency")}</label>
                     <input value={currentDose} onChange={e => setCurrentDose(e.target.value)} placeholder={t("rxDosePlaceholder")} className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"/>
                  </div>
                  
                  <div className="space-y-1.5 md:col-span-2">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxSpecialInstructions")}</label>
                     <input value={currentNote} onChange={e => setCurrentNote(e.target.value)} placeholder={t("rxNotePlaceholder")} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:border-accent-soft transition-all"/>
                  </div>
               </div>

               <button data-tour="rx-add-drug" onClick={addDrugToRx} disabled={!customDrugName.trim()} className="w-full bg-accent text-ink-on-accent py-4 rounded-xl font-black text-sm shadow-md mt-2 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100">
                  <Plus size={18}/> Add to Prescription
               </button>
            </div>
        </div>

        {/* RIGHT: THE LIVE A5 PREVIEW (THIS IS WHAT PRINTS) */}
        <div className="w-full flex justify-center print:block print:w-full print:m-0">
            {/* The actual A5 Paper Container */}
            <div
                id="prescription-pdf-source"
                className="bg-surface w-full max-w-[148mm] min-h-[210mm] shadow-2xl border border-slate-200/50 p-8 flex flex-col relative print:shadow-none print:border-none print:w-full print:h-full print:p-6 print:m-0"
            >
                
                {/* 1. Professional Header */}
                <div className="border-b-2 border-slate-900 pb-6 mb-6">
                    <div className="flex justify-between items-start">
                        <div className="w-2/3">
                            <h2 className="text-2xl font-black text-ink mb-2 uppercase tracking-tight">{clinicInfo?.name || t("rxClinicFallback")}</h2>
                            <p className="text-xs font-bold text-ink-body whitespace-pre-wrap leading-relaxed">{clinicInfo?.rxHeader || `Dr. ${selectedDoctor}`}</p>
                        </div>
                        <div className="text-right w-1/3 space-y-1">
                            <p className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">{t("rxDate")}</p>
                            <p className="text-sm font-black text-ink">{new Date().toLocaleDateString('en-GB')}</p>
                        </div>
                    </div>
                </div>

                {/* 2. Patient Demographics Block */}
                <div className="bg-surface-subtle p-4 rounded-xl mb-8 flex flex-wrap justify-between gap-y-3 border border-slate-100 print:border-line-strong print:bg-transparent">
                    <div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t("rxPatientName")}</p>
                       <p className="text-sm font-black text-ink">{patient.name}</p>
                    </div>
                    <div className="text-right">
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t("rxAgeSex")}</p>
                       <p className="text-sm font-bold text-slate-700">{calculateAge(patient.dateOfBirth || patient.age)} Y / {patient.gender?.charAt(0) || "U"}</p>
                    </div>
                    {diagnosis && (
                      <div className="w-full mt-1 pt-3 border-t border-line">
                         <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{t("rxDiagnosisLabel")}</p>
                         <p className="text-sm font-bold text-slate-700">{diagnosis}</p>
                      </div>
                    )}
                </div>

                {/* 3. The Rx Symbol */}
                <div className="mb-6">
                   <span className="text-4xl font-serif font-black text-ink italic">Rx</span>
                </div>

                {/* 4. Medications List */}
                <div className="flex-1 space-y-6">
                    {rxItems.length === 0 && (
                        <div className="text-center py-10 opacity-30 print:hidden">
                            <Pill size={40} className="mx-auto mb-2 text-slate-400"/>
                            <p className="font-bold text-ink-muted text-sm">{t("rxEmptySheet")}</p>
                        </div>
                    )}
                    {rxItems.map((item, index) => (
                        <div key={item.id} className="group relative">
                            {/* Hover Delete Button (Hidden on Print) */}
                            <button onClick={() => removeDrug(item.id)} className="absolute -left-6 top-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity print:hidden"><Trash2 size={16}/></button>
                            
                            <div className="pl-2 border-l-2 border-line">
                               <p className="font-black text-ink text-base mb-1">
                                  <span className="text-slate-400 mr-2">{index + 1}.</span>{item.name}
                               </p>
                               {item.dose && <p className="text-sm font-bold text-slate-700 pl-6">• {item.dose}</p>}
                               {item.note && <p className="text-xs font-semibold text-ink-muted pl-6 mt-0.5">Note: {item.note}</p>}
                            </div>
                        </div>
                    ))}
                </div>

                {/* 5. Footer & Signature */}
                <div className="mt-12 pt-6 border-t border-line flex justify-between items-end">
                    <div className="text-xs font-semibold text-ink-muted space-y-1">
                        <p className="flex items-center gap-1.5"><MapPin size={12}/> {clinicInfo?.address || t("rxAddressFallback")}</p>
                        <p className="flex items-center gap-1.5"><Phone size={12}/> {clinicInfo?.phone || t("rxPhoneFallback")}</p>
                    </div>
                    <div className="text-center w-48">
                        <div className="border-b-2 border-line-strong border-dashed h-8 mb-2"></div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("rxSignature")}</p>
                        <p className="text-sm font-black text-ink mt-1">{selectedDoctor}</p>
                    </div>
                </div>

            </div>
        </div>
      </main>
    </div>
  );
}