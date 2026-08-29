"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, Phone, MapPin, UserX, Loader2, Facebook, Instagram, Users, ChevronRight, Bell } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, limit, startAfter, where } from "firebase/firestore";
import NewPatientModal from "@/components/NewPatientModal";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { useLanguage } from "@/context/LanguageContext";
import PermissionGuard from "@/components/PermissionGuard";
import Protect from "@/components/Protect";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

const PAGE_SIZE = 15;

const getAvatarStyle = (name: string) => {
  const styles = [
    'from-blue-400 to-indigo-500 text-white shadow-blue-200',
    'from-emerald-400 to-teal-500 text-white shadow-emerald-200',
    'from-rose-400 to-pink-500 text-white shadow-rose-200',
    'from-amber-400 to-orange-500 text-white shadow-amber-200',
    'from-violet-400 to-purple-500 text-white shadow-violet-200',
  ];
  const charCode = name.charCodeAt(0) || 0;
  return styles[charCode % styles.length];
};

export default function PatientsPage() {
  const { language, isRTL, toggleLanguage } = useLanguage();
  
  const [patients, setPatients] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastVisible, setLastVisible] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);

  const t = {
    en: { 
      title: "Patients",
      addBtn: "New Patient", 
      searchPlaceholder: "Search name or phone...", 
      loading: "Loading directory...", 
      noPatients: "Directory is empty",
      loadMore: "Load More Patients"
    },
    ar: { 
      title: "المرضى",
      addBtn: "مريض جديد", 
      searchPlaceholder: "بحث بالاسم أو الهاتف...", 
      loading: "جاري تحميل الدليل...", 
      noPatients: "الدليل فارغ",
      loadMore: "تحميل المزيد"
    }
  }[language];

  const fetchPatients = useCallback(async (isLoadMore = false, currentLastVisible = null) => {
    if (!isLoadMore) setLoading(true);
    else setLoadingMore(true);

    try {
      const rawSearch = searchTerm.trim();
      const isPhoneSearch = !!rawSearch && /^[0-9+\-\s()]+$/.test(rawSearch);

      const qArgs: any[] = [getClinicCollection("patients")];

      if (rawSearch) {
          if (isPhoneSearch) {
              qArgs.push(where("phone", ">=", rawSearch));
              qArgs.push(where("phone", "<=", rawSearch + '\uf8ff'));
              qArgs.push(orderBy("phone", "asc"));
              if (isLoadMore && currentLastVisible) qArgs.push(startAfter(currentLastVisible));
              qArgs.push(limit(PAGE_SIZE));
          } else {
              qArgs.push(orderBy("name", "asc"));
              qArgs.push(limit(2500));
          }
      } else {
          qArgs.push(orderBy("name", "asc"));
          if (isLoadMore && currentLastVisible) qArgs.push(startAfter(currentLastVisible));
          qArgs.push(limit(PAGE_SIZE));
      }

      const q = query.apply(null, qArgs as any);
      const snap = await getDocs(q);
      let data = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));

      if (rawSearch && !isPhoneSearch) {
          data = data.filter((p: any) =>
            patientMatchesSearch(rawSearch, String(p.name || ""), p.phone ? String(p.phone) : undefined)
          );
          setPatients(data);
          setLastVisible(null);
          setHasMore(false);
          return;
      }

      if (isLoadMore) setPatients(prev => [...prev, ...data]);
      else setPatients(data);
      
      setLastVisible(snap.docs[snap.docs.length - 1]);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (error) { 
        console.error("Fetch Error:", error); 
    } finally { 
        setLoading(false);
        setLoadingMore(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setLastVisible(null); 
      fetchPatients(false, null);
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, fetchPatients]);

  const renderSourceBadge = (source?: string) => {
      const s = (source || "").toLowerCase();
      if (s.includes("facebook") || s.includes("fb")) return <div className="absolute -bottom-0.5 -right-0.5 bg-white p-[1.5px] rounded-full shadow-sm border border-slate-100"><Facebook size={8} className="text-accent fill-blue-600" /></div>;
      if (s.includes("instagram") || s.includes("insta")) return <div className="absolute -bottom-0.5 -right-0.5 bg-white p-[1.5px] rounded-full shadow-sm border border-slate-100"><Instagram size={8} className="text-pink-600" /></div>;
      if (s.includes("friend") || s.includes("refer") || s.includes("patient")) return <div className="absolute -bottom-0.5 -right-0.5 bg-white p-[1.5px] rounded-full shadow-sm border border-slate-100"><Users size={8} className="text-emerald-600" /></div>;
      return null;
  };

  return (
    <PermissionGuard permission="access.patients">
      <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 font-sans text-slate-800 selection:bg-accent-soft selection:text-primary-900"> 
        
        {/* UNIFIED GLASSMORPHISM HEADER */}
        <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm transition-all">
           {/* Expanded max width to 1600px for PC */}
           <div className="max-w-[1600px] mx-auto w-full flex flex-col gap-3 px-4 py-3 md:py-4">
              
              {/* Row 1: Context Title & Utilities */}
              <div className="flex justify-between items-center">
                 <div className="flex items-center gap-3">
                    <h1 className="text-lg font-black text-slate-900 tracking-tight uppercase">{t.title}</h1>
                 </div>
                 
                 <div className="flex items-center gap-2">
                    <button onClick={toggleLanguage} className="w-8 h-8 rounded-full bg-slate-50 hover:bg-accent-tint text-slate-500 hover:text-accent flex items-center justify-center font-bold text-[10px] uppercase tracking-widest transition-colors border border-slate-100">
                       {language === 'ar' ? 'EN' : 'ع'}
                    </button>
                    <button className="w-8 h-8 rounded-full bg-slate-50 hover:bg-accent-tint text-slate-500 hover:text-accent flex items-center justify-center transition-colors relative border border-slate-100">
                        <Bell size={14}/>
                        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-white"></span>
                    </button>
                 </div>
              </div>

              {/* Row 2: Search & Add */}
              <div className="flex items-center gap-3">
                  <div className="relative w-full flex-1 group shadow-sm">
                     <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <Search size={16} className="text-slate-400 group-focus-within:text-accent-soft transition-colors" />
                     </div>
                     <input 
                        type="text" 
                        placeholder={t.searchPlaceholder} data-tour="patients-search" 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                        className="block w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200/60 focus:border-primary-400 focus:ring-2 focus:ring-accent-soft/10 rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 transition-all outline-none" 
                     />
                  </div>

                  <Protect permission="patients.add">
                    <button onClick={() => setIsModalOpen(true)} data-tour="patients-add" className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl font-bold text-xs uppercase shadow-md shadow-slate-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all shrink-0 h-[42px]">
                       <Plus size={16}/> <span className="hidden sm:inline tracking-wider">{t.addBtn}</span>
                    </button>
                  </Protect>
              </div>

           </div>
        </div>

        {/* MAIN PATIENTS CONTENT - Expanded to max-w-[1600px] */}
        <div className="max-w-[1600px] mx-auto p-4 pt-6 space-y-3 animate-in fade-in">
          
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center bg-white p-3 sm:p-4 rounded-[1.25rem] border border-slate-200/60 shadow-sm animate-pulse w-full">
                  <div className="flex items-center w-full pl-2 sm:pl-3 gap-4">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-200 shrink-0"></div>
                      <div className="flex flex-col gap-2 w-full">
                        <div className="h-4 bg-slate-200 rounded-md w-2/3"></div>
                        <div className="h-3 bg-slate-200 rounded-md w-1/3"></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="hidden sm:flex flex-col items-end gap-2 w-20">
                         <div className="h-3 bg-slate-200 rounded-md w-full"></div>
                      </div>
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-200 shrink-0"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : patients.length > 0 ? (
            <>
              {/* RESPONSIVE GRID LIST: 1 col on mobile, 2 on tablet, 3 on large desktop */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                {patients.map((p, index) => (
                  <Link 
                     key={p.id} 
                     href={`/patients/${p.id}`} data-tour="patient-row" 
                     className="group relative flex items-center bg-white p-3 sm:p-4 rounded-[1.25rem] border border-slate-200/60 shadow-sm hover:shadow-md hover:border-accent-soft hover:-translate-y-0.5 transition-all duration-300 outline-none w-full"
                     style={{ animationDelay: `${(index % PAGE_SIZE) * 30}ms`, animationFillMode: 'both' }}
                  >
                    
                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-accent-soft rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                    <div className="flex items-center justify-between w-full pl-2 sm:pl-3 gap-4">
                        
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="relative shrink-0">
                                <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br ${getAvatarStyle(p.name)} flex items-center justify-center font-black text-xs sm:text-base shadow-md`}>
                                    {p.name.charAt(0).toUpperCase()}
                                </div>
                                {renderSourceBadge(p.source)}
                            </div>

                            <div className="flex flex-col min-w-0">
                                <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight truncate capitalize group-hover:text-accent transition-colors">
                                    {p.name}
                                </h3>
                                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold text-slate-400 mt-0.5">
                                    <MapPin size={10} className="shrink-0"/>
                                    <span className="truncate">{p.address || "No Address Provided"}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                            <div className="hidden sm:flex flex-col items-end">
                                <span className="text-xs font-bold text-slate-500 tracking-wide" dir="ltr">{p.phone || "---"}</span>
                            </div>
                            
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100 group-hover:bg-accent-tint group-hover:border-primary-100 transition-colors">
                                <span className="sm:hidden text-slate-400 group-hover:text-accent"><Phone size={14} className="fill-current opacity-20 group-hover:opacity-100 transition-all"/></span>
                                <span className="hidden sm:block text-slate-300 group-hover:text-accent transition-transform group-hover:translate-x-0.5"><ChevronRight size={18}/></span>
                            </div>
                        </div>

                    </div>
                  </Link>
                ))}
              </div>

              {!loading && hasMore && (
                  <div className="flex justify-center pt-6 pb-10">
                      <button 
                          onClick={() => fetchPatients(true, lastVisible)} 
                          disabled={loadingMore}
                          className="bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:shadow-md px-8 py-3 rounded-full font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95"
                      >
                          {loadingMore ? <><Loader2 size={14} className="animate-spin text-accent-soft" /> Loading...</> : t.loadMore}
                      </button>
                  </div>
              )}
            </>
          ) : (
              <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[2rem] border border-slate-200/60 shadow-sm border-dashed">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                      <UserX size={24} className="text-slate-400" />
                  </div>
                  <p className="text-base font-black text-slate-900">{t.noPatients}</p>
                  <p className="text-slate-500 text-sm mt-1 font-medium">Try adjusting your search criteria</p>
              </div>
          )}
          
          <NewPatientModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={() => { setLastVisible(null); fetchPatients(false, null); }} />
        </div>
      </div>
    </PermissionGuard>
  );
}