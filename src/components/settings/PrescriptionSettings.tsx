"use client";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useSettingsText } from "@/lib/useSettingsText";
import { useClinic } from "@/context/ClinicContext";
import { useState, useEffect } from "react";
import { Pill, Plus, Trash2, X, Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { DRUG_CATALOG } from "@/lib/drugCatalog";

export default function PrescriptionSettings() {
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const [drugList, setDrugList] = useState<any[]>([]);
  const [isDrugModalOpen, setIsDrugModalOpen] = useState(false);
  const [newDrugName, setNewDrugName] = useState("");
  const [newDrugDose, setNewDrugDose] = useState("");


  const txt = useSettingsText("prescriptions");

  useEffect(() => {
    const q = query(getClinicCollection("drugs"), orderBy("name"));
    const unsub = onSnapshot(q, (s) => setDrugList(s.docs.map(d => ({id: d.id, ...d.data()}))));
    return () => unsub();
  }, []);

  const openDrugModal = () => { setNewDrugName(""); setNewDrugDose(""); setIsDrugModalOpen(true); };
  
  const handleSaveDrug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDrugName) return;
    try {
      await addDoc(getClinicCollection("drugs"), { name: newDrugName, dose: newDrugDose });
      setIsDrugModalOpen(false); showToast("Drug added", "success");
    } catch (error) { showToast("Failed to add drug", "error"); }
  };
  
  const deleteDrug = async (id: string, name: string) => { 
    if (!(await confirm("Delete this drug shortcut?"))) return;
    try {
      await deleteRecord(clinicId || "", "drugs", id);
      showToast("Moved to Recently Deleted", "success");
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : "Could not delete", "error");
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in">
        <div className="flex items-center justify-between mb-6 border-b border-line pb-6">
            <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-tint text-accent"><Pill size={28}/></div>
                <div>
                    <h3 className="text-xl font-bold text-ink">{txt.drugDbTitle}</h3>
                    <p className="text-sm font-semibold text-ink-muted mt-1">{txt.drugDbSub}</p>
                </div>
            </div>
            <button onClick={openDrugModal} className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-bold text-ink-on-accent transition-all active:scale-95">
                <Plus size={20}/> {txt.addDrug}
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {drugList.map(drug => (
                <div key={drug.id} className="flex justify-between items-center p-6 bg-surface-subtle rounded-3xl border border-line shadow-sm hover:border-line-strong hover:bg-surface transition-all group">
                    <div>
                        <p className="font-bold text-ink text-base">{drug.name}</p>
                        <p className="text-sm font-medium text-ink-muted mt-1">{drug.dose}</p>
                    </div>
                    <button onClick={() => deleteDrug(drug.id, drug.name)} className="text-ink-muted hover:bg-danger-tint hover:text-danger bg-surface rounded-xl transition-colors opacity-0 group-hover:opacity-100 p-3"><Trash2 size={18}/></button>
                </div>
            ))}
            {drugList.length === 0 && <div className="col-span-full py-16 bg-surface-subtle rounded-3xl text-center"><p className="text-ink-muted font-bold text-base">{txt.noDrugs}</p></div>}
        </div>

        {/*
          An empty list here used to read as "the system has no drugs", which stopped being true
          once the built-in Egyptian formulary shipped. This page still only owns the clinic's own
          shortcuts — the library needs no setup and is searchable inside the prescription studio.
        */}
        <p className="text-sm font-semibold text-ink-muted text-center pt-2">
          {language === "ar"
            ? `الروشتة كمان فيها مكتبة جاهزة بـ ${DRUG_CATALOG.length} دوا مصري بالجرعة والتعليمات بالعربي — من غير أي إعداد. الاختصارات هنا بتظهر فوقها في البحث.`
            : `The prescription studio also carries a built-in library of ${DRUG_CATALOG.length} Egyptian drugs with doses and Arabic instructions — no setup needed. The shortcuts above appear first in its search.`}
        </p>

        {isDrugModalOpen && (
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
              <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-line">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-ink tracking-tight">{txt.addDrug}</h2>
                    <button onClick={() => setIsDrugModalOpen(false)} className="text-ink-muted bg-surface-subtle hover:bg-danger-tint hover:text-danger p-2 rounded-full transition-colors"><X size={20}/></button>
                </div>

                <form onSubmit={handleSaveDrug} className="space-y-5">
                    <div className="space-y-1.5">
                      <div className="relative">
                          <Pill size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? 'right-4' : 'left-4'}`}/>
                          <input autoFocus required value={newDrugName} onChange={e => setNewDrugName(e.target.value)} placeholder={language === 'ar' ? "اسم الدواء (مثال: Augmentin 1gm)" : "e.g. Augmentin 1gm"} className={`w-full py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent transition-all placeholder:text-ink-muted ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <input value={newDrugDose} onChange={e => setNewDrugDose(e.target.value)} placeholder={language === 'ar' ? "الجرعة (مثال: قرص كل 12 ساعة)" : "e.g. 1 tablet every 12 hours"} className={`w-full px-4 py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-white focus:border-accent transition-all placeholder:text-ink-muted`}/>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button type="submit" className="w-full bg-accent text-ink-on-accent py-3.5 rounded-xl font-bold text-sm shadow-md hover:bg-accent-strong active:scale-95 transition-all flex items-center justify-center gap-2"><Save size={16} /> {language === 'ar' ? "حفظ كاختصار" : "Save Shortcut"}</button>
                    </div>
                </form>
              </div>
          </div>
        )}
    </div>
  );
}