import React, { useState, useEffect } from "react";
import { X, Save } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { PerioMetrics, ToothData } from "@/lib/diagnosisCatalog";

interface PerioInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  toothId: number | null;
  initialData?: ToothData;
  onSave: (toothId: number, data: Partial<ToothData>) => void;
}

export default function PerioInputModal({ isOpen, onClose, toothId, initialData, onSave }: PerioInputModalProps) {
  const { language, isRTL } = useLanguage();
  
  const [buccalPD, setBuccalPD] = useState<[string, string, string]>(["", "", ""]);
  const [buccalGM, setBuccalGM] = useState<[string, string, string]>(["", "", ""]);
  
  useEffect(() => {
    if (isOpen && initialData?.perio) {
      setBuccalPD([
        initialData.perio.buccal.pd[0].toString(),
        initialData.perio.buccal.pd[1].toString(),
        initialData.perio.buccal.pd[2].toString(),
      ]);
      setBuccalGM([
        initialData.perio.buccal.gm[0].toString(),
        initialData.perio.buccal.gm[1].toString(),
        initialData.perio.buccal.gm[2].toString(),
      ]);
    } else {
      setBuccalPD(["", "", ""]);
      setBuccalGM(["", "", ""]);
    }
  }, [isOpen, initialData]);

  if (!isOpen || !toothId) return null;

  const handleSave = () => {
    // Parse strings to numbers (defaulting to 0 if empty)
    const pd: [number, number, number] = [
      parseInt(buccalPD[0]) || 0,
      parseInt(buccalPD[1]) || 0,
      parseInt(buccalPD[2]) || 0
    ];
    const gm: [number, number, number] = [
      parseInt(buccalGM[0]) || 0,
      parseInt(buccalGM[1]) || 0,
      parseInt(buccalGM[2]) || 0
    ];
    
    // We only collect buccal for now to simplify the MVP UI
    const perioData = {
      buccal: { pd, gm },
      lingual: { pd: [0,0,0] as [number,number,number], gm: [0,0,0] as [number,number,number] }
    };
    
    onSave(toothId, { perio: perioData });
    onClose();
  };

  const handleInput = (
    setter: React.Dispatch<React.SetStateAction<[string, string, string]>>,
    index: number,
    val: string
  ) => {
    // Allow empty or numbers 0-9. Max length 1 for simplicity (0-9mm). 
    if (val === "" || /^[0-9]$/.test(val)) {
      setter(prev => {
        const next = [...prev] as [string, string, string];
        next[index] = val;
        return next;
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" dir={isRTL ? "rtl" : "ltr"}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">
            {language === "ar" ? `قياسات اللثة لسن ${toothId}` : `Perio Chart - Tooth ${toothId}`}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-4 space-y-6">
          {/* Probing Depth */}
          <div>
            <label className="block text-xs font-bold text-red-500 uppercase tracking-wider mb-2">
              {language === "ar" ? "عمق الجيب (PD)" : "Probing Depth (PD)"}
            </label>
            <div className="flex gap-2">
              {[0, 1, 2].map((idx) => (
                <input
                  key={`pd-${idx}`}
                  type="text"
                  inputMode="numeric"
                  value={buccalPD[idx]}
                  onChange={(e) => handleInput(setBuccalPD, idx, e.target.value)}
                  className="w-full h-12 text-center text-lg font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  placeholder="-"
                />
              ))}
            </div>
          </div>
          
          {/* Gingival Margin */}
          <div>
            <label className="block text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">
              {language === "ar" ? "انحسار اللثة (GM)" : "Gingival Margin (GM)"}
            </label>
            <div className="flex gap-2">
              {[0, 1, 2].map((idx) => (
                <input
                  key={`gm-${idx}`}
                  type="text"
                  inputMode="numeric"
                  value={buccalGM[idx]}
                  onChange={(e) => handleInput(setBuccalGM, idx, e.target.value)}
                  className="w-full h-12 text-center text-lg font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  placeholder="-"
                />
              ))}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <Save size={18} />
            {language === "ar" ? "حفظ القياسات" : "Save Measurements"}
          </button>
        </div>
      </div>
    </div>
  );
}
