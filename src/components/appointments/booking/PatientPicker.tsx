"use client";

import { useRef, useEffect } from "react";
import { User, X } from "lucide-react";

interface Patient {
  id: string | number;
  name: string;
  phone?: string;
}

interface Props {
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  selectedPatient: { id: string; name: string } | null;
  setSelectedPatient: (p: { id: string; name: string } | null) => void;
  filteredPatients: Patient[];
  showSuggestions: boolean;
  setShowSuggestions: (v: boolean) => void;
  txt: any;
}

export default function PatientPicker({
  searchTerm,
  setSearchTerm,
  selectedPatient,
  setSelectedPatient,
  filteredPatients,
  showSuggestions,
  setShowSuggestions,
  txt,
}: Props) {
  const patientRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (patientRef.current && !patientRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setShowSuggestions]);

  return (
    <div className="relative space-y-1.5" ref={patientRef}>
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">{txt.patient}</label>
      <div className="relative">
        <input
          type="text"
          value={selectedPatient ? selectedPatient.name : searchTerm} data-tour="booking-patient"
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setSelectedPatient(null);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          placeholder={txt.searchPlaceholder}
          className={`w-full rounded-2xl border-2 py-3 ps-10 pe-4 text-sm font-bold outline-none transition focus:border-primary-500 ${
            selectedPatient ? "border-emerald-400 bg-emerald-50/80 text-emerald-900" : "border-slate-100 bg-surface text-ink"
          }`}
        />
        <User size={18} className="pointer-events-none absolute top-3.5 text-slate-400 start-3" />
        {selectedPatient && (
          <button
            type="button"
            onClick={() => {
              setSelectedPatient(null);
              setSearchTerm("");
            }}
            className="absolute top-3.5 end-3 text-slate-400 hover:text-rose-500 transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>
      {showSuggestions && searchTerm && !selectedPatient && (
        <div className="absolute start-0 end-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-2xl border border-slate-100 bg-surface shadow-xl">
          {filteredPatients.length > 0 ? (
            filteredPatients.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedPatient({ id: String(p.id), name: p.name });
                  setSearchTerm("");
                  setShowSuggestions(false);
                }}
                className="block w-full border-b border-slate-50 px-4 py-3 text-start last:border-0 hover:bg-primary-50"
              >
                <p className="text-sm font-bold text-ink">{p.name}</p>
                {p.phone && <p className="text-[10px] text-slate-400">{p.phone}</p>}
              </button>
            ))
          ) : (
            <div className="p-3 text-center text-xs font-bold text-slate-400">{txt.notFound}</div>
          )}
        </div>
      )}
    </div>
  );
}
