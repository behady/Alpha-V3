// src/components/NewPatientModal.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, UserPlus, User, Phone, MapPin, Calendar, Save, ChevronDown, AlertTriangle, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, query, where, getDocs, doc, runTransaction, getDoc } from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { logActivity } from "@/lib/logger";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
import { onSnapshot } from "firebase/firestore";
import { cairo } from "@/lib/fonts/arabic";
import {
  DEFAULT_COUNTRY_CODE,
  COUNTRY_CODE_OPTIONS,
  buildE164FromCountryCode,
} from "@/lib/phoneNumber";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** The branch the desk is working at, used as the starting value. */
  preSelectedBranchId?: string;
}

export default function NewPatientModal({ isOpen, onClose, onSuccess, preSelectedBranchId = "" }: Props) {
  const router = useRouter();
  const { showToast, patientEditorMode } = useUI();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  /**
   * The branch this patient belongs to.
   *
   * Recorded so a two-site clinic can tell whose patient this is, and so the price list, the
   * schedule and the reports agree about it later. It is a home branch, not a restriction —
   * nothing stops the patient being seen at the other site.
   */
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [branchId, setBranchId] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(getClinicDoc("settings", LOCATIONS_DOC), (snap) => {
      setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
    });
    return () => unsub();
  }, []);

  // Seeded from where the desk is working, or the only branch there is. Re-seeded each time the
  // modal opens so switching branches between two patients is picked up.
  useEffect(() => {
    if (!isOpen) return;
    if (preSelectedBranchId && branches.some((b) => b.id === preSelectedBranchId)) setBranchId(preSelectedBranchId);
    else if (branches.length === 1) setBranchId(branches[0].id);
  }, [isOpen, preSelectedBranchId, branches]);
  const [referral, setReferral] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalHistory, setMedicalHistory] = useState("");
  const [loading, setLoading] = useState(false);
  const [sourcesOptions, setSourcesOptions] = useState<string[]>(["Walk-in", "Social Media", "Friend / Family", "Other Doctor", "Google"]);

  useEffect(() => {
    getDoc(getClinicDoc("settings", "patient_sources")).then((snap) => {
      if (snap.exists() && Array.isArray(snap.data().sources) && snap.data().sources.length > 0) {
        setSourcesOptions(snap.data().sources);
      }
    });
  }, []);

  // --- DUPLICATION SHIELD STATE ---
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{id: string, name: string, fileId?: string} | null>(null);
  const [allowDuplicatePhone, setAllowDuplicatePhone] = useState(false); // NEW: The Override Toggle

  // --- LIVE FRONTEND SHIELD (Debounced Phone Check) ---
  useEffect(() => {
    // Reset the override toggle anytime the phone number changes
    setAllowDuplicatePhone(false);

    const normalizedPhone = buildE164FromCountryCode(countryCode, phone);
    if (!normalizedPhone) {
        setDuplicateWarning(null);
        return;
    }

    const checkDuplicatePhone = async () => {
        setIsCheckingPhone(true);
        try {
            const q = query(getClinicCollection("patients"), where("phone", "==", normalizedPhone));
            const snap = await getDocs(q);
            
            if (!snap.empty) {
                const existingPat = snap.docs[0];
                setDuplicateWarning({ 
                    id: existingPat.id, 
                    name: existingPat.data().name, 
                    fileId: existingPat.data().fileId 
                });
            } else {
                setDuplicateWarning(null);
            }
        } catch (error) {
            console.error("Error checking phone duplicate:", error);
        } finally {
            setIsCheckingPhone(false);
        }
    };

    // Wait 500ms after the user stops typing before hitting the database
    const timeoutId = setTimeout(checkDuplicatePhone, 500);
    return () => clearTimeout(timeoutId);
  }, [phone, countryCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return showToast(language === 'ar' ? "الاسم مطلوب" : "Name is required", "error");
    const normalizedPhone = buildE164FromCountryCode(countryCode, phone);
    if (!normalizedPhone) {
      return showToast(
        language === "ar"
          ? "رقم الهاتف لازم يبدأ بكود الدولة (مثال: +201001234567)"
          : "Phone must include country code first (e.g. +201001234567)",
        "error"
      );
    }
    
    // Prevent submission if there is a warning AND they haven't checked the override box
    if (duplicateWarning && !allowDuplicatePhone) {
        return showToast(language === 'ar' ? "يرجى تأكيد استخدام نفس رقم الهاتف" : "Please confirm shared phone number", "error");
    }
    
    setLoading(true);
    try {
      // 1. THE BACKEND BLOCK (Now respects the override checkbox)
      const q = query(getClinicCollection("patients"), where("phone", "==", normalizedPhone));
      const snap = await getDocs(q);
      if (!snap.empty && !allowDuplicatePhone) {
          throw new Error("DUPLICATE_PHONE");
      }

      // 2. TRANSACTIONAL ID GENERATOR (Guaranteed no duplicates)
      const counterRef = getClinicDoc("settings", "counters");
      
      const newIdNumber = await runTransaction(db, async (transaction) => {
          const counterDoc = await transaction.get(counterRef);
          let nextId = 1000; // Starting number for the very first patient
          
          if (counterDoc.exists() && counterDoc.data().patientId) {
              nextId = counterDoc.data().patientId + 1;
              transaction.update(counterRef, { patientId: nextId });
          } else {
              transaction.set(counterRef, { patientId: nextId }, { merge: true });
          }
          return nextId;
      });

      const generatedFileId = `PT-${newIdNumber}`;

      // 3. SAVE THE PATIENT
      await addDoc(getClinicCollection("patients"), {
        fileId: generatedFileId,
        name,
        phone: normalizedPhone,
        address,
        dateOfBirth: dob,
        gender,
        referral,
        // Absent rather than empty when there is no branch: Firestore stores "" happily, but a
        // blank branch id reads downstream as a branch that matches nothing.
        ...(branchId ? { branchId, branchName: branches.find((b) => b.id === branchId)?.name || "" } : {}),
        allergies: allergies.trim(),
        // Blank means "not asked yet", which is the truth for a patient nobody has screened.
        // This used to be hardcoded to "None (Healthy)" — an assertion of absence no clinician
        // ever made, indistinguishable downstream from a real negative screening.
        medicalHistory: medicalHistory.trim(),
        status: "New",
        createdAt: serverTimestamp(),
        teethData: {} 
      });

      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Patient Created",
        `Created patient ${name} (${generatedFileId})`
      );
      
      showToast(language === 'ar' ? `تم الحفظ! رقم الملف: ${generatedFileId}` : `Saved! File ID: ${generatedFileId}`, "success");
      onSuccess(); 
      onClose();   
      
      // Reset State
      setName(""); setCountryCode(DEFAULT_COUNTRY_CODE); setPhone(""); setAddress(""); setDob(""); 
      setGender("Male"); setReferral(""); setAllergies(""); setMedicalHistory(""); setBranchId("");
      setDuplicateWarning(null); setAllowDuplicatePhone(false);
      
    } catch (error: any) {
      if (error.message === "DUPLICATE_PHONE") {
          showToast(language === 'ar' ? "رقم الهاتف مسجل بالفعل" : "Phone number already exists", "error");
      } else {
          showToast(language === 'ar' ? "حدث خطأ أثناء الحفظ" : "Error adding patient", "error");
          console.error(error);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  /**
   * Two shells, one form. The side panel (the default, Settings → Interface) keeps the patient
   * list or the day's schedule in view behind the form; the pop-up is the old centred window.
   * Same header, same fields, same save — only the frame changes.
   */
  const asDrawer = patientEditorMode === "drawer";
  const shell = asDrawer
    ? "fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex justify-end animate-in fade-in duration-200"
    : "fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in";
  const face = `${cairo.variable} ${language === "ar" ? "booking-popup-ar" : ""} text-[15px] text-ink antialiased`;
  const panel = asDrawer
    ? `${face} bg-surface w-full sm:max-w-xl h-full shadow-2xl border-s border-line flex flex-col animate-in duration-300 ${language === "ar" ? "slide-in-from-left" : "slide-in-from-right"}`
    : `${face} bg-surface w-full max-w-2xl rounded-[22px] shadow-[0_32px_90px_-24px_rgba(0,0,0,0.6)] ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[92vh]`;

  return (
    <div className={shell}>
      <div className={panel}>

        {/* HEADER */}
        <div className="flex items-center justify-between gap-4 bg-ink-slab px-7 py-6 text-white">
          <div className="flex items-center gap-4 min-w-0">
             <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/12 ring-1 ring-white/15">
                <UserPlus size={24} className="text-white/85"/>
             </div>
             <div className="min-w-0">
                <h3 className="font-figure text-2xl font-semibold leading-tight">{t('addPatient')}</h3>
                <p className="mt-1 text-sm text-white/70">{t("newPatientAutoFile")}</p>
             </div>
          </div>
          <button type="button" onClick={onClose} aria-label={language === 'ar' ? 'إغلاق' : 'Close'} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"><X size={20}/></button>
        </div>

        {/* FORM BODY */}
        <form onSubmit={handleSubmit} className="p-7 space-y-5 overflow-y-auto custom-scrollbar flex-1 min-h-0">
           
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                 <label className="mb-1.5 block text-[14px] font-semibold text-ink-body"><User size={14} className="inline mb-0.5 me-1.5 text-ink-muted"/>{t("patientName")}</label>
                 <input autoFocus required data-tour="new-patient-name" value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent transition-colors" placeholder={t("patientNamePlaceholder")}/>
              </div>
              
              <div className="relative">
                 <label className="mb-1.5 flex items-center justify-between text-[14px] font-semibold text-ink-body">
                    <span><Phone size={14} className="inline mb-0.5 me-1.5 text-ink-muted"/>{t("phone")}</span>
                    {isCheckingPhone && <Loader2 size={12} className="animate-spin text-primary-500" />}
                 </label>
                 <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="w-[42%] px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent bg-surface"
                    >
                      {COUNTRY_CODE_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      required data-tour="new-patient-phone"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className={`w-[58%] px-4 py-3 border rounded-xl text-[16px] font-semibold text-ink outline-none transition-colors ${duplicateWarning ? 'border-amber-300 bg-amber-50 focus:border-amber-500' : 'border-line bg-surface focus:border-accent'}`}
                      placeholder={t("patientPhonePlaceholder")}
                    />
                 </div>
              </div>
           </div>

           {/* DYNAMIC WARNING BANNER WITH OVERRIDE CHECKBOX */}
           {duplicateWarning && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col gap-3 animate-in slide-in-from-top-2">
                 <div className="flex items-start gap-3">
                     <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                     <div>
                        <p className="text-[14px] font-bold text-amber-900">
                            {language === 'ar' ? 'تنبيه: رقم الهاتف مسجل بالفعل' : 'Notice: Phone Number Already in Use'}
                        </p>
                        <p className="text-[13px] font-semibold text-amber-800 mt-1">
                            {language === 'ar' ? 'هذا الرقم مسجل مسبقاً باسم:' : 'This number belongs to:'} <span className="font-black">{duplicateWarning.name}</span> (ID: {duplicateWarning.fileId || 'N/A'})
                        </p>
                     </div>
                 </div>
                 
                 <div className="flex items-start gap-2 pt-2 border-t border-amber-200/50 mt-1">
                     <input 
                        type="checkbox" 
                        id="allowDuplicate" 
                        checked={allowDuplicatePhone} 
                        onChange={(e) => setAllowDuplicatePhone(e.target.checked)}
                        className="mt-0.5 w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 cursor-pointer"
                     />
                     <label htmlFor="allowDuplicate" className="text-[13px] font-semibold text-amber-900 cursor-pointer select-none leading-snug">
                         {language === 'ar' 
                            ? 'نعم، أريد إنشاء ملف منفصل بنفس الرقم (مثال: أفراد العائلة)' 
                            : 'Yes, create a separate profile with this shared number (e.g., family member)'}
                     </label>
                 </div>
              </div>
           )}

           <div>
              <label className="mb-1.5 block text-[14px] font-semibold text-ink-body"><MapPin size={14} className="inline mb-0.5 me-1.5 text-ink-muted"/>{t("address")}</label>
              <input value={address} onChange={e => setAddress(e.target.value)} className="w-full px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent transition-colors" placeholder={t("patientAddressPlaceholder")}/>
           </div>

           <div className="grid grid-cols-2 gap-4">
              <div>
                 <label className="mb-1.5 block text-[14px] font-semibold text-ink-body"><Calendar size={14} className="inline mb-0.5 me-1.5 text-ink-muted"/>{t("patientBirthDate")}</label>
                 <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="w-full px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent uppercase text-sm transition-colors cursor-pointer"/>
              </div>
              <div>
                 <label className="mb-1.5 block text-[14px] font-semibold text-ink-body">{t("gender")}</label>
                 <div className="flex bg-surface-muted p-1 rounded-xl border border-line h-[50px]">
                    <button type="button" onClick={() => setGender('Male')} className={`flex-1 text-[15px] font-bold rounded-lg transition-all ${gender === 'Male' ? 'bg-surface text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'}`}>{t("male")}</button>
                    <button type="button" onClick={() => setGender('Female')} className={`flex-1 text-[15px] font-bold rounded-lg transition-all ${gender === 'Female' ? 'bg-surface text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'}`}>{t("female")}</button>
                 </div>
              </div>
           </div>

           {/* Only asked of a clinic that actually has branches. */}
           {branches.length > 1 && (
             <div className="relative">
                <label className="mb-1.5 block text-[14px] font-semibold text-ink-body">
                   {language === 'ar' ? 'الفرع' : 'Branch'}
                </label>
                <select
                   value={branchId}
                   onChange={e => setBranchId(e.target.value)}
                   className="w-full px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent bg-surface appearance-none cursor-pointer transition-colors"
                >
                   <option value="">{language === 'ar' ? 'بدون فرع محدد' : 'No branch'}</option>
                   {branches.map((b) => (
                     <option key={b.id} value={b.id}>{b.name}</option>
                   ))}
                </select>
                <ChevronDown size={16} className="absolute end-4 top-[46px] text-ink-muted pointer-events-none"/>
             </div>
           )}

           <div className="relative">
              <label className="mb-1.5 block text-[14px] font-semibold text-ink-body">{t("referralSource")}</label>
              <select value={referral} onChange={e => setReferral(e.target.value)} className="w-full px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent bg-surface appearance-none cursor-pointer transition-colors">
                 <option value="">{t("selectReferralSource")}</option>
                 {sourcesOptions.map((src) => (
                   <option key={src} value={src}>{src}</option>
                 ))}
              </select>
              <ChevronDown size={16} className="absolute end-4 top-[46px] text-ink-muted pointer-events-none"/>
           </div>

           <div>
              <label className="mb-1.5 block text-[14px] font-semibold text-danger">
                 {language === 'ar' ? 'الحساسية' : 'Allergies'}
              </label>
              <input
                 value={allergies}
                 onChange={e => setAllergies(e.target.value)}
                 placeholder={language === 'ar' ? 'مثال: بنسلين — اتركه فارغاً إن لم يُسأل' : 'e.g. Penicillin — leave blank if not asked'}
                 className="w-full px-4 py-3 border border-danger/30 rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-danger bg-danger-tint/40 transition-colors placeholder:font-medium placeholder:text-ink-faint"
              />
           </div>

           <div>
              <label className="mb-1.5 block text-[14px] font-semibold text-ink-body">
                 {language === 'ar' ? 'التاريخ الطبي' : 'Medical history'}
              </label>
              <input
                 value={medicalHistory}
                 onChange={e => setMedicalHistory(e.target.value)}
                 placeholder={language === 'ar' ? 'مثال: سكري، ضغط — اتركه فارغاً إن لم يُسأل' : 'e.g. Diabetes, hypertension — leave blank if not asked'}
                 className="w-full px-4 py-3 border border-line rounded-xl text-[16px] font-semibold text-ink outline-none focus:border-accent bg-surface transition-colors placeholder:font-medium placeholder:text-ink-faint"
              />
           </div>

           {/* SUBMIT BUTTON */}
           <div className="pt-2">
               <button 
                 type="submit" 
                 disabled={loading || (!!duplicateWarning && !allowDuplicatePhone)} data-tour="new-patient-save" 
                 className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-7 text-[15px] font-bold text-ink-on-accent shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed"
               >
                 {loading ? <Loader2 size={18} className="animate-spin"/> : <Save size={18}/>} 
                 {loading ? t("saving") : t("createPatientFile")}
               </button>
           </div>
        </form>
      </div>
    </div>
  );
}