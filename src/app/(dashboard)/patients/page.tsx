"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, Phone, MapPin, UserX, Loader2, Facebook, Instagram, Users, ChevronRight } from "lucide-react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, limit, startAfter, where } from "firebase/firestore";
import NewPatientModal from "@/components/NewPatientModal";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { useLanguage } from "@/context/LanguageContext";
import PermissionGuard from "@/components/PermissionGuard";
import PageHeader, { headerButtonPrimary } from "@/components/dashboard/PageHeader";
import Protect from "@/components/Protect";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

const PAGE_SIZE = 15;

const getAvatarStyle = (name: string) => {
  const styles = [
    'bg-blue-100 text-blue-700',
    'bg-teal-100 text-teal-700',
    'bg-indigo-100 text-indigo-700',
    'bg-violet-100 text-violet-700',
    'bg-sky-100 text-sky-700',
  ];
  const charCode = name.charCodeAt(0) || 0;
  return `${styles[charCode % styles.length]} shadow-sm border border-white/60`;
};

export default function PatientsPage() {
  const { language, isRTL } = useLanguage();
  const router = useRouter();
  
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
      if (s.includes("facebook") || s.includes("fb")) return <div className="absolute -bottom-0.5 -right-0.5 bg-surface p-[1.5px] rounded-full shadow-sm border border-slate-100"><Facebook size={8} className="text-accent fill-blue-600" /></div>;
      if (s.includes("instagram") || s.includes("insta")) return <div className="absolute -bottom-0.5 -right-0.5 bg-surface p-[1.5px] rounded-full shadow-sm border border-slate-100"><Instagram size={8} className="text-pink-600" /></div>;
      if (s.includes("friend") || s.includes("refer") || s.includes("patient")) return <div className="absolute -bottom-0.5 -right-0.5 bg-surface p-[1.5px] rounded-full shadow-sm border border-slate-100"><Users size={8} className="text-emerald-600" /></div>;
      return null;
  };

  return (
    <PermissionGuard permission="access.patients">
      <div className="min-h-full bg-white pb-24 lg:pb-10 font-sans text-slate-800 selection:bg-accent-soft selection:text-ink">
        
        {/* The title and "add patient" moved up into the layout's black band. The search box
            stayed here and stayed sticky: it filters the list directly underneath it, so it
            belongs with the list rather than with the chrome. The language switch and the bell
            that used to sit alongside the title are gone — both live in the top bar now, and
            that bell was decorative: a permanent red dot on a button that did nothing. */}
        <PageHeader title={t.title}>
          <Protect permission="patients.add">
            <button onClick={() => setIsModalOpen(true)} data-tour="patients-add" className={headerButtonPrimary}>
              <Plus size={16} strokeWidth={3} />
              <span className="hidden sm:inline">{t.addBtn}</span>
            </button>
          </Protect>
        </PageHeader>

        <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-100 shadow-sm transition-all">
           <div className="max-w-[1600px] mx-auto w-full px-4 py-3">
              <div className="relative w-full group shadow-sm">
                 <div className="absolute inset-y-0 start-0 ps-3.5 flex items-center pointer-events-none">
                    <Search size={16} className="text-slate-400 group-focus-within:text-ink transition-colors" />
                 </div>
                  <input
                    type="text"
                    placeholder={t.searchPlaceholder} data-tour="patients-search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full ps-10 pe-4 py-3 bg-surface-subtle hover:bg-surface-muted border border-line focus:border-ink focus:bg-white rounded-2xl text-sm font-bold text-slate-800 placeholder-slate-400 transition-all outline-none"
                 />
              </div>
           </div>
        </div>

        {/* MAIN PATIENTS CONTENT - Expanded to max-w-[1600px] */}
        <div className="max-w-[1600px] mx-auto p-4 pt-6 space-y-3 animate-in fade-in">
          
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center bg-surface p-3 sm:p-4 rounded-[1.25rem] border border-slate-200/60 shadow-sm animate-pulse w-full">
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
              {/* PREMIUM DATA TABLE (Desktop) */}
              <div className="hidden md:block bg-white border border-slate-200 shadow-sm rounded-[1.5rem] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse whitespace-nowrap">
                    <thead>
                      <tr className="border-b-2 border-slate-200 bg-slate-100/80">
                        <th className="py-4 px-6 text-[11px] font-bold text-slate-600 uppercase tracking-widest">{language === 'ar' ? 'المريض' : 'Patient'}</th>
                        <th className="py-4 px-6 text-[11px] font-bold text-slate-600 uppercase tracking-widest">{language === 'ar' ? 'رقم الهاتف' : 'Phone'}</th>
                        <th className="py-4 px-6 text-[11px] font-bold text-slate-600 uppercase tracking-widest">{language === 'ar' ? 'العنوان' : 'Address'}</th>
                        <th className="py-4 px-6 text-[11px] font-bold text-slate-600 uppercase tracking-widest text-right">{language === 'ar' ? 'إجراء' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {patients.map((p, index) => (
                        <tr
                          key={p.id}
                          data-tour="patient-row"
                          onClick={() => router.push(`/patients/${p.id}`)}
                          className="group hover:bg-slate-50 transition-all duration-300 cursor-pointer hover:shadow-sm"
                          style={{ animationDelay: `${(index % PAGE_SIZE) * 30}ms`, animationFillMode: 'both' }}
                        >
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-4">
                              <div className="relative shrink-0 transition-transform duration-300 group-hover:scale-105">
                                <div className={`w-11 h-11 rounded-full ${getAvatarStyle(p.name)} flex items-center justify-center font-black text-base`}>
                                  {p.name.charAt(0).toUpperCase()}
                                </div>
                                {renderSourceBadge(p.source)}
                              </div>
                              <h3 className="text-base font-bold text-slate-800 tracking-tight capitalize group-hover:text-slate-900 transition-colors">
                                {p.name}
                              </h3>
                            </div>
                          </td>
                          <td className="py-4 px-6">
                            <span className="text-sm font-semibold text-slate-600" dir="ltr">
                              {p.phone || "---"}
                            </span>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
                              {p.address ? (
                                <>
                                  <MapPin size={16} className="text-slate-400" />
                                  <span className="truncate max-w-[200px] xl:max-w-[300px]">{p.address}</span>
                                </>
                              ) : (
                                <span className="text-slate-300 italic">--</span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <div className="inline-flex w-9 h-9 rounded-full bg-slate-50 items-center justify-center border border-slate-200 group-hover:bg-slate-900 group-hover:border-slate-800 group-hover:shadow-md transition-all duration-300">
                              <ChevronRight size={18} strokeWidth={2.5} className="text-slate-400 group-hover:text-white" />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE LIST */}
              {/* Same data-tour as the desktop rows above. The tutorial overlay walks every match
                  and takes the first with a real rect, so the display:none half is skipped. */}
              <div className="md:hidden grid grid-cols-1 gap-3">
                {patients.map((p, index) => (
                  <Link
                     key={p.id}
                     href={`/patients/${p.id}`} data-tour="patient-row"
                     className="group relative flex items-center bg-white p-4 rounded-[1.25rem] border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 hover:-translate-y-1 transition-all duration-300 outline-none w-full overflow-hidden"
                  >
                    <div className="flex items-center justify-between w-full gap-4 relative z-10">
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                            <div className="relative shrink-0">
                                <div className={`w-12 h-12 rounded-full ${getAvatarStyle(p.name)} flex items-center justify-center font-black text-lg`}>
                                    {p.name.charAt(0).toUpperCase()}
                                </div>
                                {renderSourceBadge(p.source)}
                            </div>
                            <div className="flex flex-col min-w-0 justify-center">
                                <h3 className="text-base font-black text-slate-800 tracking-tight truncate capitalize">
                                    {p.name}
                                </h3>
                                {p.address && (
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mt-1">
                                      <MapPin size={12} className="shrink-0 text-slate-400"/>
                                      <span className="truncate">{p.address}</span>
                                  </div>
                                )}
                            </div>
                        </div>
                        <div className="shrink-0 flex items-center">
                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center border border-slate-200">
                                <Phone size={14} className="text-slate-500"/>
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
                          className="bg-surface border border-line text-ink-body hover:text-ink hover:shadow-md px-8 py-3 rounded-full font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50 active:scale-95"
                      >
                          {loadingMore ? <><Loader2 size={14} className="animate-spin text-accent-soft" /> Loading...</> : t.loadMore}
                      </button>
                  </div>
              )}
            </>
          ) : (
              <div className="flex flex-col items-center justify-center py-24 bg-surface rounded-[2rem] border border-slate-200/60 shadow-sm border-dashed">
                  <div className="w-16 h-16 bg-surface-subtle rounded-full flex items-center justify-center mb-4">
                      <UserX size={24} className="text-slate-400" />
                  </div>
                  <p className="text-base font-black text-ink">{t.noPatients}</p>
                  <p className="text-ink-muted text-sm mt-1 font-medium">Try adjusting your search criteria</p>
              </div>
          )}
          
          <NewPatientModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={() => { setLastVisible(null); fetchPatients(false, null); }} />
        </div>
      </div>
    </PermissionGuard>
  );
}