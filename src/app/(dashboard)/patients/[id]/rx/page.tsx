"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Printer, Plus, Trash2, Pill, Loader2,
  MapPin, Phone, MessageCircle, Save, Search, X, AlertTriangle
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { getDoc, getDocs, onSnapshot, addDoc, serverTimestamp } from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { prescriptionPayloadToPdfBlob } from "@/lib/prescriptionPdfHtml";
import { isDentistStaff } from "@/lib/staffRoles";
import { DRUG_CATEGORIES } from "@/lib/drugCatalog";
import { mergeDrugList, searchDrugEntries, type ClinicDrugDoc } from "@/lib/drugList";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import PermissionGuard from "@/components/PermissionGuard";


/**
 * A prescription line. `dose`/`note` are the English text and `doseAr`/`noteAr` the Arabic, and
 * both print, one under the other — the doctor reads one, the patient reads the other, and neither
 * has to take the pharmacy's word for what was meant. Records saved before the Arabic fields
 * existed simply have them empty and print exactly as they always did.
 */
interface RxItem { id: string; name: string; dose: string; doseAr: string; note: string; noteAr: string; }

/**
 * One line in the drug picker. The clinic's own shortcuts and the built-in Egyptian catalog are
 * flattened into the same shape so the doctor searches one list rather than choosing a source
 * first — a shortcut a doctor typed by hand stays findable by exactly the words they typed.
 *
 * Only `name`, `doseEn` and `doseAr` ever reach the prescription. `tip` (what to tell the patient)
 * and `caution` (what to check first) are addressed to the doctor, shown only in this list, and
 * never copied onto the paper.
 */
interface PickerRow {
  key: string;
  name: string;
  subtitle: string;
  doseEn: string;
  doseAr: string;
  tip: string;
  caution: string;
  catLabel: string;
  catSoft: string;
  isShortcut: boolean;
}

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
  const { t, language, isRTL } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const id = (params?.id as string) || "";
  const { showToast } = useUI();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState<any>(null);
  const [clinicInfo, setClinicInfo] = useState<any>(null);
  
  // Drug Database & Staff
  const [drugDb, setDrugDb] = useState<ClinicDrugDoc[]>([]);
  const [doctors, setDoctors] = useState<{name: string}[]>([]);
  
  // Prescription State
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [rxItems, setRxItems] = useState<RxItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [whatsappSending, setWhatsappSending] = useState(false);
  
  // Current Input State
  const [customDrugName, setCustomDrugName] = useState("");
  const [currentDose, setCurrentDose] = useState("");
  const [currentDoseAr, setCurrentDoseAr] = useState("");
  const [currentNote, setCurrentNote] = useState("");
  const [currentNoteAr, setCurrentNoteAr] = useState("");

  // Drug picker
  const [drugQuery, setDrugQuery] = useState("");

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

    // No orderBy: a document that removes a built-in from the list carries no dose, and ordering
    // on a field Firestore may not find is one more way for a row to vanish without saying so.
    const unsubDrugs = onSnapshot(getClinicCollection("drugs"), (snap) => {
      setDrugDb(snap.docs.map(d => ({ id: d.id, ...d.data() } as ClinicDrugDoc)));
    });

    return () => unsubDrugs();
  }, [id]);

  const isArabicUi = language === "ar";

  /**
   * One list, assembled by `mergeDrugList` — the clinic's own drugs first, then the built-in
   * library with any edits Settings has made and without the ones it removed. Going through the
   * shared merge is what stops this picker and the Settings page from disagreeing.
   */
  const allEntries = useMemo(() => mergeDrugList(drugDb), [drugDb]);
  const drugListSize = allEntries.length;

  const pickerRows = useMemo<PickerRow[]>(() => {
    return searchDrugEntries(allEntries, drugQuery).map((e) => {
      const cat = DRUG_CATEGORIES.find((c) => c.id === e.cat);
      const isOwn = e.origin === "clinic";
      return {
        key: e.key,
        name: e.name,
        subtitle: isArabicUi ? e.descAr : e.descEn,
        doseEn: e.dose,
        doseAr: e.doseAr,
        tip: (isArabicUi ? e.noteAr : e.noteEn) || "",
        caution: (isArabicUi ? e.cautionAr : e.cautionEn) || "",
        catLabel: isOwn ? t("rxMyShortcut") : (isArabicUi ? cat?.labelAr : cat?.labelEn) || "",
        catSoft: isOwn
          ? "bg-accent-tint text-accent border-transparent"
          : cat?.soft || "bg-slate-100 text-slate-700 border-slate-200",
        isShortcut: isOwn,
      };
    });
  }, [allEntries, drugQuery, isArabicUi, t]);

  /**
   * Load a picked drug into the fields so the doctor can still edit before adding.
   *
   * Only the name and the two dose lines come across. The catalog's advice line ("finish the
   * course", "never on an empty stomach") stays in the picker for the doctor to read; the
   * instruction boxes start empty and print only what the doctor chooses to type in them.
   */
  const fillFromRow = (row: PickerRow) => {
    setCustomDrugName(row.name);
    setCurrentDose(row.doseEn);
    setCurrentDoseAr(row.doseAr);
    setCurrentNote("");
    setCurrentNoteAr("");
    setDrugQuery("");
  };

  const appendRxItem = (item: Omit<RxItem, "id">) => {
    setRxItems((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, ...item }]);
  };

  /** The one-tap path: name and dose straight onto the prescription, nothing else. */
  const quickAddRow = (row: PickerRow) => {
    appendRxItem({
      name: row.name,
      dose: row.doseEn,
      doseAr: row.doseAr,
      note: "",
      noteAr: "",
    });
    setDrugQuery("");
  };

  const addDrugToRx = () => {
    const finalName = customDrugName.trim();
    if (!finalName) return;

    appendRxItem({
      name: finalName,
      dose: currentDose,
      doseAr: currentDoseAr,
      note: currentNote,
      noteAr: currentNoteAr,
    });
    setCustomDrugName("");
    setCurrentDose("");
    setCurrentDoseAr("");
    setCurrentNote("");
    setCurrentNoteAr("");
  };

  const removeDrug = (itemId: string) => {
    setRxItems(rxItems.filter(item => item.id !== itemId));
  };

  /**
   * Patients are stored either with a birth date or with an age already typed as a number, and
   * `new Date("34")` quietly answers 1970 — which is how a 34-year-old came out as 0.
   */
  const calculateAge = (dobOrAge: unknown) => {
    const raw = String(dobOrAge ?? "").trim();
    if (!raw) return "";
    if (/^\d{1,3}$/.test(raw)) return raw;
    const ms = new Date(raw).getTime();
    if (Number.isNaN(ms)) return "";
    return Math.abs(new Date(Date.now() - ms).getUTCFullYear() - 1970).toString();
  };

  /** An em dash beats the bare "` Y / U`" a patient with no birth date used to print. */
  const ageSexLabel = (() => {
    if (!patient) return "—";
    const years = calculateAge(patient.dateOfBirth || patient.age);
    const sex = patient.gender ? String(patient.gender).charAt(0).toUpperCase() : "";
    if (years && sex) return `${years} Y / ${sex}`;
    return years ? `${years} Y` : sex || "—";
  })();

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

      const blob: Blob = await prescriptionPayloadToPdfBlob({
        clinicName: clinicInfo?.name || t("rxClinicFallback"),
        rxHeader: clinicInfo?.rxHeader || `Dr. ${selectedDoctor}`,
        dateLabel: new Date().toLocaleDateString("en-GB"),
        patientName: patient.name,
        ageSex: ageSexLabel,
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
                    {rxItems.length} in Rx · {drugListSize} drugs
                  </span>
               </h3>

               <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxSelectFromDb")}</label>

                  <div className="relative">
                    <Search size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none ${isRTL ? "right-4" : "left-4"}`} />
                    <input
                      value={drugQuery}
                      onChange={e => setDrugQuery(e.target.value)}
                      placeholder={t("rxSearchPlaceholder")}
                      data-tour="rx-drug-search"
                      className={`w-full py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all ${isRTL ? "pr-11 pl-10" : "pl-11 pr-10"}`}
                    />
                    {drugQuery && (
                      <button
                        type="button"
                        onClick={() => setDrugQuery("")}
                        className={`absolute top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink p-1 ${isRTL ? "left-3" : "right-3"}`}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {/* Scrolls rather than grows: the whole library is listed when the box is empty. */}
                  <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200/60 divide-y divide-slate-100 bg-surface">
                    {pickerRows.length === 0 && (
                      <p className="px-4 py-6 text-center text-xs font-bold text-ink-muted">{t("rxNoDrugMatches")}</p>
                    )}
                    {pickerRows.map((row) => (
                      <div key={row.key} className="flex items-stretch gap-2 hover:bg-surface-subtle transition-colors">
                        <button
                          type="button"
                          onClick={() => fillFromRow(row)}
                          className={`flex-1 min-w-0 px-4 py-3 ${isRTL ? "text-right" : "text-left"}`}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-black text-ink text-sm">{row.name}</span>
                            {row.catLabel && (
                              <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider ${row.catSoft}`}>
                                {row.catLabel}
                              </span>
                            )}
                          </div>
                          {row.subtitle && !row.isShortcut && (
                            <p dir="auto" className="text-[11px] font-semibold text-ink-muted mt-0.5 line-clamp-2">{row.subtitle}</p>
                          )}
                          {(isArabicUi ? row.doseAr || row.doseEn : row.doseEn || row.doseAr) && (
                            <p dir="auto" className="text-[11px] font-bold text-ink-body mt-1">
                              • {isArabicUi ? row.doseAr || row.doseEn : row.doseEn || row.doseAr}
                            </p>
                          )}
                          {/* What to tell the patient, and what to check first. Both stop here — neither is ever copied onto the sheet. */}
                          {row.tip && (
                            <p dir="auto" className="text-[11px] font-semibold text-ink-muted mt-1 italic">{row.tip}</p>
                          )}
                          {row.caution && (
                            <p dir="auto" className="text-[11px] font-bold text-amber-700 mt-1 flex items-start gap-1">
                              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                              <span>{row.caution}</span>
                            </p>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => quickAddRow(row)}
                          title={t("rxQuickAdd")}
                          aria-label={t("rxQuickAdd")}
                          className="shrink-0 px-4 text-accent hover:bg-accent-tint transition-colors"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Drug Name Input (Always Accessible) */}
                  <div className="space-y-1.5 md:col-span-2">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">
                        Drug Name
                     </label>
                     <input
                        value={customDrugName} data-tour="rx-drug-name"
                        onChange={e => setCustomDrugName(e.target.value)}
                        placeholder={t("rxDrugPlaceholder")}
                        className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"
                     />
                  </div>

                  {/*
                    English on the left, Arabic on the right, and both print. Picking from the
                    library fills all four; a hand-typed drug can fill either side or both.
                  */}
                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxDoseFrequency")}</label>
                     <input dir="ltr" value={currentDose} onChange={e => setCurrentDose(e.target.value)} placeholder={t("rxDosePlaceholder")} className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"/>
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxDoseFrequencyAr")}</label>
                     <input dir="rtl" value={currentDoseAr} onChange={e => setCurrentDoseAr(e.target.value)} placeholder={t("rxDoseArPlaceholder")} className="w-full px-4 py-3.5 bg-surface-subtle border border-slate-200/60 rounded-xl font-bold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"/>
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxSpecialInstructions")}</label>
                     <input dir="ltr" value={currentNote} onChange={e => setCurrentNote(e.target.value)} placeholder={t("rxNotePlaceholder")} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:border-accent-soft transition-all"/>
                  </div>

                  <div className="space-y-1.5">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t("rxSpecialInstructionsAr")}</label>
                     <input dir="rtl" value={currentNoteAr} onChange={e => setCurrentNoteAr(e.target.value)} placeholder={t("rxNoteArPlaceholder")} className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200/60 rounded-xl font-bold text-slate-900 outline-none focus:bg-white focus:border-accent-soft transition-all"/>
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
                className="bg-surface w-full max-w-[148mm] min-h-[210mm] shadow-2xl border border-slate-200/50 px-6 py-5 flex flex-col relative print:shadow-none print:border-none print:w-full print:h-full print:m-0"
            >
                
                {/*
                  Header, patient block and footer are all deliberately small. The sheet is A5 and
                  every drug now takes up to four lines, so the furniture gives its room to the
                  prescription instead of to the clinic's own name.
                */}
                <div className="border-b border-slate-900 pb-3 mb-4">
                    <div className="flex justify-between items-start">
                        <div className="w-2/3">
                            <h2 className="text-lg font-black text-ink mb-1 uppercase tracking-tight leading-tight">{clinicInfo?.name || t("rxClinicFallback")}</h2>
                            <p className="text-[10px] font-bold text-ink-body whitespace-pre-wrap leading-snug">{clinicInfo?.rxHeader || `Dr. ${selectedDoctor}`}</p>
                        </div>
                        <div className="text-right w-1/3">
                            <p className="text-[8px] font-bold text-ink-muted uppercase tracking-widest">{t("rxDate")}</p>
                            <p className="text-xs font-black text-ink">{new Date().toLocaleDateString('en-GB')}</p>
                        </div>
                    </div>
                </div>

                {/* 2. Patient Demographics Block */}
                <div className="bg-surface-subtle px-3 py-2.5 rounded-lg mb-4 flex flex-wrap justify-between gap-y-2 border border-slate-100 print:border-line-strong print:bg-transparent">
                    <div>
                       <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t("rxPatientName")}</p>
                       <p className="text-xs font-black text-ink">{patient.name}</p>
                    </div>
                    <div className="text-right">
                       <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t("rxAgeSex")}</p>
                       <p className="text-xs font-bold text-slate-700">{ageSexLabel}</p>
                    </div>
                    {diagnosis && (
                      <div className="w-full pt-2 border-t border-line">
                         <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t("rxDiagnosisLabel")}</p>
                         <p dir="auto" className="text-xs font-bold text-slate-700">{diagnosis}</p>
                      </div>
                    )}
                </div>

                {/* 3. The Rx Symbol */}
                <div className="mb-2">
                   <span className="text-2xl font-serif font-black text-ink italic leading-none">Rx</span>
                </div>

                {/* 4. Medications List */}
                <div className="flex-1 space-y-2">
                    {rxItems.length === 0 && (
                        <div className="text-center py-10 opacity-30 print:hidden">
                            <Pill size={40} className="mx-auto mb-2 text-slate-400"/>
                            <p className="font-bold text-ink-muted text-sm">{t("rxEmptySheet")}</p>
                        </div>
                    )}
                    {rxItems.map((item, index) => (
                        <div key={item.id} className="group relative break-inside-avoid">
                            {/* Hover Delete Button (Hidden on Print) */}
                            <button onClick={() => removeDrug(item.id)} className="absolute -left-6 top-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity print:hidden"><Trash2 size={16}/></button>

                            <div className="pl-2 border-l-2 border-line">
                               <p className="font-black text-ink text-sm leading-tight">
                                  <span className="text-slate-400 mr-2">{index + 1}.</span>{item.name}
                               </p>
                               {/*
                                 Both languages, English first, each on its own line and each with
                                 an explicit direction so the bullet and the digits stay on the
                                 right end of an Arabic line. The tight leading is what keeps five
                                 drugs on one A5 sheet.
                               */}
                               {item.dose && <p dir="ltr" className="text-xs font-bold text-slate-700 pl-6 leading-snug">• {item.dose}</p>}
                               {item.doseAr && <p dir="rtl" className="text-xs font-bold text-slate-700 pl-6 pr-6 leading-snug">• {item.doseAr}</p>}
                               {item.note && <p dir="ltr" className="text-[11px] font-semibold text-ink-muted pl-6 leading-snug">{item.note}</p>}
                               {item.noteAr && <p dir="rtl" className="text-[11px] font-semibold text-ink-muted pl-6 pr-6 leading-snug">{item.noteAr}</p>}
                            </div>
                        </div>
                    ))}
                </div>

                {/*
                  One signature block, not two. It used to print a dashed rule, the words
                  "Doctor's signature", and the doctor's name under them — which read as a second
                  signature line. A rule to sign on with the name beneath it says the same thing
                  once. Fixed widths keep a two-line Arabic address off the rule.
                */}
                <div className="mt-6 pt-3 border-t border-line flex justify-between items-end gap-4">
                    <div className="w-[56%] text-[10px] font-semibold text-ink-muted space-y-1">
                        <p dir="auto" className="flex items-center gap-1.5"><MapPin size={11} className="shrink-0"/> {clinicInfo?.address || t("rxAddressFallback")}</p>
                        <p dir="ltr" className="flex items-center gap-1.5"><Phone size={11} className="shrink-0"/> {clinicInfo?.phone || t("rxPhoneFallback")}</p>
                    </div>
                    <div className="w-[38%] text-center">
                        <div className="border-b border-line-strong border-dashed h-5 mb-1.5"></div>
                        <p className="text-xs font-black text-ink">Dr. {selectedDoctor}</p>
                    </div>
                </div>

            </div>
        </div>
      </main>
    </div>
  );
}