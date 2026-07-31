"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Edit2, Trash2, Tag, DollarSign, X, Save } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, query, orderBy, deleteDoc, updateDoc, doc, addDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export default function PricingSettings({ currency }: { currency: string }) {
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  
  const [services, setServices] = useState<any[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");
  
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<any>(null); 
  const [serviceForm, setServiceForm] = useState({ name: "", price: "", requiresLab: false, estimatedLabFee: "" });

  const txt = {
    searchTreatments: language === 'ar' ? "البحث في العلاجات..." : "Search treatments...",
    addTreatment: language === 'ar' ? "إضافة علاج" : "Add Treatment",
    noTreatments: language === 'ar' ? "لم يتم العثور على علاجات" : "No treatments found",
  };

  useEffect(() => {
    const q = query(getClinicCollection("services"), orderBy("name"));
    const unsub = onSnapshot(q, (s) => setServices(s.docs.map(d => ({id: d.id, ...d.data()}))));
    return () => unsub();
  }, []);

  const openAddService = () => { setEditingService(null); setServiceForm({ name: "", price: "", requiresLab: false, estimatedLabFee: "" }); setIsServiceModalOpen(true); }
  
  const openEditService = (s: any) => { 
      setEditingService(s); 
      setServiceForm({ 
          name: s.name, 
          price: s.price.toString(),
          requiresLab: s.requiresLab || false,
          estimatedLabFee: s.estimatedLabFee ? s.estimatedLabFee.toString() : ""
      }); 
      setIsServiceModalOpen(true); 
  }
  
  const handleSaveService = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!serviceForm.name || !serviceForm.price) return;
      
      const priceVal = Number(serviceForm.price);
      const labFeeVal = Number(serviceForm.estimatedLabFee) || 0;
      
      try {
        if (editingService) {
            await updateDoc(getClinicDoc("services", editingService.id), { 
                name: serviceForm.name, 
                price: priceVal,
                requiresLab: serviceForm.requiresLab,
                estimatedLabFee: labFeeVal
            });
            showToast("Treatment updated", "success");
        } else {
            await addDoc(getClinicCollection("services"), { 
                name: serviceForm.name, 
                price: priceVal, 
                requiresLab: serviceForm.requiresLab,
                estimatedLabFee: labFeeVal,
                createdAt: new Date().toISOString() 
            });
            showToast("Treatment added", "success");
        }
        setIsServiceModalOpen(false);
      } catch (err) {
        showToast("Failed to save treatment", "error");
      }
  };

  const deleteService = async (id: string, name: string) => {
      if (await confirm(`Remove "${name}" from the price list?`)) {
          await deleteDoc(getClinicDoc("services", id));
          showToast("Treatment removed", "info");
      }
  };

  const filteredServices = services.filter((s) => matchesTokenizedSubstring(s.name, serviceSearch));

  return (
    <div className="space-y-6 animate-in fade-in max-w-6xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-slate-200/50">
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-6 border-b border-slate-100 pb-6">
            <div className="relative flex-1 w-full max-w-2xl">
                <Search size={22} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-5' : 'left-5'}`} />
                <input 
                    value={serviceSearch} 
                    onChange={e => setServiceSearch(e.target.value)} 
                    placeholder={txt.searchTreatments} 
                    className={`w-full py-4 bg-slate-50 rounded-2xl border border-slate-200/60 font-bold text-slate-900 text-base outline-none focus:bg-white focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all ${isRTL ? 'pr-14 pl-5' : 'pl-14 pr-5'}`}
                />
            </div>
            <button onClick={openAddService} className="w-full sm:w-auto bg-slate-900 text-white px-8 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shrink-0 active:scale-95">
                <Plus size={20}/> {txt.addTreatment}
            </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            {filteredServices.map(s => (
                <div key={s.id} className="p-6 bg-slate-50 rounded-3xl flex justify-between items-start border border-slate-200/60 shadow-sm hover:border-primary-300 hover:bg-white transition-all group">
                    <div>
                        <p className="font-bold text-slate-900 text-base mb-3 leading-snug">{s.name}</p>
                        <div className="flex flex-wrap gap-2">
                        <div className="inline-flex items-center bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
                            <p className="text-sm font-black text-primary-600">{s.price} <span className="text-[10px] font-bold text-slate-400 uppercase mx-0.5">{currency}</span></p>
                        </div>
                        {s.requiresLab && (
                            <div className="inline-flex items-center bg-orange-50 border border-orange-200 px-3 py-1.5 rounded-lg shadow-sm">
                                <p className="text-[10px] font-black text-orange-600 uppercase">Lab: {s.estimatedLabFee} {currency}</p>
                            </div>
                        )}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <button onClick={() => openEditService(s)} className="p-2.5 text-slate-400 bg-white hover:text-primary-600 hover:bg-primary-50 rounded-xl border border-transparent hover:border-primary-100 transition-all shadow-sm">
                        <Edit2 size={18}/>
                        </button>
                        <button onClick={() => deleteService(s.id, s.name)} className="p-2.5 text-slate-400 bg-white hover:text-red-600 hover:bg-red-50 rounded-xl border border-transparent hover:border-red-100 transition-all shadow-sm">
                        <Trash2 size={18}/>
                        </button>
                    </div>
                </div>
            ))}
            {filteredServices.length === 0 && (
                <div className="col-span-full py-16 text-center text-slate-400 font-bold text-lg bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    {txt.noTreatments}
                </div>
            )}
        </div>

        {isServiceModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">{editingService ? 'Edit Treatment' : 'New Treatment'}</h2>
                  <button onClick={() => setIsServiceModalOpen(false)} className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-full transition-colors"><X size={20}/></button>
                </div>
                <form onSubmit={handleSaveService} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>Treatment Name</label>
                    <div className="relative">
                      <Tag size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/>
                      <input autoFocus required value={serviceForm.name} onChange={e => setServiceForm({...serviceForm, name: e.target.value})} placeholder="e.g. Scaling & Polishing" className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-primary-500 transition-all ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>Price ({currency})</label>
                    <div className="relative">
                      <DollarSign size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/>
                      <input required type="number" value={serviceForm.price} onChange={e => setServiceForm({...serviceForm, price: e.target.value})} placeholder="0.00" className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-primary-500 transition-all ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-4 mt-2 border-t border-slate-100">
                    <input 
                       type="checkbox" 
                       checked={serviceForm.requiresLab} 
                       onChange={e => setServiceForm({...serviceForm, requiresLab: e.target.checked})} 
                       className="w-5 h-5 rounded text-primary-600 focus:ring-primary-500 cursor-pointer"
                    />
                    <label className="text-sm font-bold text-slate-700">Procedure requires external Lab Work</label>
                  </div>

                  {serviceForm.requiresLab && (
                    <div className="space-y-1.5 animate-in slide-in-from-top-2 pt-2">
                      <label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? 'pr-1' : 'pl-1'}`}>Estimated Lab Fee ({currency})</label>
                      <div className="relative">
                          <DollarSign size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-4' : 'left-4'}`}/>
                          <input 
                             required 
                             type="number" 
                             value={serviceForm.estimatedLabFee} 
                             onChange={e => setServiceForm({...serviceForm, estimatedLabFee: e.target.value})} 
                             placeholder="e.g. 500" 
                             className={`w-full py-3.5 bg-orange-50 rounded-xl border border-orange-200 font-semibold text-orange-900 outline-none focus:border-orange-500 transition-all ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}
                          />
                      </div>
                    </div>
                  )}

                  <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm shadow-md mt-6 active:scale-95 transition-all flex items-center justify-center gap-2">
                    <Save size={18}/> {editingService ? 'Update Price' : 'Save to List'}
                  </button>
                </form>
            </div>
          </div>
        )}
    </div>
  );
}