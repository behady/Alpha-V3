"use client";

import React, { useState, useEffect, useRef } from "react";
import { Building2, Plus, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/context/LanguageContext";

/**
 * `expanded` is passed by the desktop rail when it is showing labels. Collapsed (and on mobile)
 * this stays the single icon button it has always been.
 */
export default function ClinicSwitcher({ expanded = false }: { expanded?: boolean } = {}) {
  const { user } = useAuth();
  const { clinicId, setClinicId } = useClinic();
  const router = useRouter();
  const { isRTL, language } = useLanguage();
  
  const [isOpen, setIsOpen] = useState(false);
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchClinics() {
      if (!user || !user.clinicRoles) return;
      const clinicIds = Object.keys(user.clinicRoles);
      if (clinicIds.length === 0) return;

      const loadedClinics = [];
      for (const id of clinicIds) {
        try {
          const cSnap = await getDoc(doc(db, "clinics", id));
          if (cSnap.exists()) {
            loadedClinics.push({ id, name: cSnap.data().name || "Unknown Clinic" });
          }
        } catch (e) {
          console.error("Failed to load clinic", id, e);
        }
      }
      setClinics(loadedClinics);
    }
    fetchClinics();
  }, [user]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSwitch = (id: string) => {
    setClinicId(id);
    setIsOpen(false);
  };

  const handleAddClinic = () => {
    setIsOpen(false);
    router.push("/onboarding");
  };

  if (!user || clinics.length === 0) return null;

  const currentClinicName = clinics.find(c => c.id === clinicId)?.name || "Switch Clinic";

  return (
    <div className="relative group w-full shrink-0 px-3 mb-4 [@media(max-height:840px)]:mb-2" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`
          rounded-xl flex items-center transition-all duration-300 relative z-10
          ${expanded
            ? 'w-full gap-3 px-2.5 py-2 justify-start'
            : 'w-[46px] h-[46px] [@media(max-height:840px)]:w-[38px] [@media(max-height:840px)]:h-[38px] mx-auto justify-center'}
          ${isOpen ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-600 border border-indigo-100 hover:bg-indigo-50 shadow-sm'}
        `}
      >
        <Building2 className="size-5 [@media(max-height:840px)]:size-[18px] shrink-0" />
        {expanded && (
          <span className="truncate text-sm font-bold">{currentClinicName}</span>
        )}
      </button>

      {/* Tooltip on hover if closed */}
      {!isOpen && !expanded && (
        <div className={`absolute top-1/2 -translate-y-1/2 z-[200] bg-ink-strong text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg whitespace-nowrap ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
          {currentClinicName}
        </div>
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div className={`absolute top-0 z-[250] w-64 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] border border-slate-100 overflow-hidden ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
          <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
             <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{language === 'ar' ? 'مساحات العمل' : 'Workspaces'}</span>
          </div>
          <div className="max-h-60 overflow-y-auto py-2">
            {clinics.map(c => (
              <button
                key={c.id}
                onClick={() => handleSwitch(c.id)}
                className={`w-full text-left flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors ${clinicId === c.id ? 'bg-indigo-50/50' : ''}`}
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                <span className={`font-semibold text-sm ${clinicId === c.id ? 'text-indigo-700' : 'text-slate-700'}`}>
                  {c.name}
                </span>
                {clinicId === c.id && <Check size={16} className="text-indigo-600 shrink-0" />}
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 p-2">
            <button
              onClick={handleAddClinic}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <Plus size={16} />
              {language === 'ar' ? 'إضافة عيادة جديدة' : 'Add New Clinic'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
