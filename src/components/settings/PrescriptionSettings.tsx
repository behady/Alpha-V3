"use client";

import { useState, useEffect } from "react";
import { Pill, Plus, Trash2, X, Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, orderBy, deleteDoc, doc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export default function PrescriptionSettings() {
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const [drugList, setDrugList] = useState<any[]>([]);
  const [isDrugModalOpen, setIsDrugModalOpen] = useState(false);
  const [newDrugName, setNewDrugName] = useState("");
  const [newDrugDose, setNewDrugDose] = useState("");

  const txt = {
    drugDbTitle: language === 'ar' ? "قاعدة بيانات الأدوية" : "Drug Database",
    drugDbSub: language === 'ar' ? "اختصارات لكتابة الوصفات الطبية." : "Shortcuts for writing Prescriptions.",
    addDrug: language === 'ar' ? "إضافة دواء" : "Add Drug",
    noDrugs: language === 'ar' ? "لم يتم حفظ أي أدوية بعد." : "No drugs saved yet.",
  };

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
    if(await confirm("Delete this drug shortcut?")) { await deleteDoc(getClinicDoc("drugs", id)); } 
  };

  return (
    <div className="space-y-6 animate-in fade-in max-w-6xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-slate-200/50">
        <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-6">
            <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center"><Pill size={28}/></div>
                <div>
                    <h3 className="text-xl font-bold text-slate-900">{txt.drugDbTitle}</h3>
                    <p className="text-sm font-semibold text-slate-500 mt-1">{txt.drugDbSub}</p>
                </div>
            </div>
            <button onClick={openDrugModal} className="bg-purple-50 text-purple-700 px-6 py-3.5 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-purple-100 transition-colors shadow-sm active:scale-95">
                <Plus size={20}/> {txt.addDrug}
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {drugList.map(drug => (
                <div key={drug.id} className="flex justify-between items-center p-6 bg-slate-50 rounded-3xl border border-slate-200/60 shadow-sm hover:border-purple-200 hover:bg-white transition-all group">
                    <div>
                        <p className="font-bold text-slate-900 text-base">{drug.name}</p>
                        <p className="text-sm font-medium text-slate-500 mt-1">{drug.dose}</p>
                    </div>
                    <button onClick={() => deleteDrug(drug.id, drug.name)} className="text-slate-300 hover:text-red-500 bg-white hover:bg-red-50 rounded-xl transition-colors opacity-0 group-hover:opacity-100 p-3"><Trash2 size={18}/></button>
                </div>
            ))}
            {drugList.length === 0 && <div className="col-span-full py-16 bg-slate-50 rounded-3xl text-center"><p className="text-slate-400 font-bold text-base">{txt.noDrugs}</p></div>}
        </div>

        {isDrugModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
              <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">{txt.addDrug}</h2>
                    <button onClick={() => setIsDrugModalOpen(false)} className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-full transition-colors"><X size={20}/></button>
                </div>

                <form onSubmit={handleSaveDrug} className="space-y-5">
                    <div className="space-y-1.5">
                      <div className="relative">
                          <Pill size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/>
                          <input autoFocus required value={newDrugName} onChange={e => setNewDrugName(e.target.value)} placeholder={language === 'ar' ? "اسم الدواء (مثال: Augmentin 1gm)" : "e.g. Augmentin 1gm"} className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-primary-500 transition-all placeholder:text-slate-300 ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <input value={newDrugDose} onChange={e => setNewDrugDose(e.target.value)} placeholder={language === 'ar' ? "الجرعة (مثال: قرص كل 12 ساعة)" : "e.g. 1 tablet every 12 hours"} className={`w-full px-4 py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-primary-500 transition-all placeholder:text-slate-300`}/>
                    </div>

                    <div className="flex gap-3 pt-4">
                      <button type="submit" className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold text-sm shadow-md hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-2"><Save size={16} /> {language === 'ar' ? "حفظ كاختصار" : "Save Shortcut"}</button>
                    </div>
                </form>
              </div>
          </div>
        )}
    </div>
  );
}