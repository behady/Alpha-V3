"use client";

import { Globe, Palette } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme, ThemeColor } from "@/context/ThemeContext";

export default function AppearanceSettings() {
  const { language, toggleLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();

  const txt = {
    langSettings: language === 'ar' ? "إعدادات اللغة" : "Language Settings",
    switchLang: language === 'ar' ? "Switch System to English" : "تغيير النظام إلى العربية",
    themeSettings: language === 'ar' ? "ألوان الواجهة" : "Interface Color Palette",
  };

  const colors: { id: ThemeColor; name: string; bg: string }[] = [
    { id: 'blue', name: language === 'ar' ? 'أزرق' : 'Blue', bg: 'bg-blue-600' }, 
    { id: 'purple', name: language === 'ar' ? 'بنفسجي' : 'Purple', bg: 'bg-purple-600' },
    { id: 'emerald', name: language === 'ar' ? 'زمردي' : 'Emerald', bg: 'bg-emerald-600' }, 
    { id: 'rose', name: language === 'ar' ? 'وردي' : 'Rose', bg: 'bg-rose-600' },
    { id: 'amber', name: language === 'ar' ? 'كهرماني' : 'Amber', bg: 'bg-amber-600' }, 
    { id: 'cyan', name: language === 'ar' ? 'سماوي' : 'Cyan', bg: 'bg-cyan-600' },
    { id: 'slate', name: language === 'ar' ? 'رمادي' : 'Slate', bg: 'bg-slate-600' },
    { id: 'indigo', name: language === 'ar' ? 'نيلي' : 'Indigo', bg: 'bg-indigo-600' },
    { id: 'fuchsia', name: language === 'ar' ? 'فوشيا' : 'Fuchsia', bg: 'bg-fuchsia-600' },
    { id: 'teal', name: language === 'ar' ? 'تركواز' : 'Teal', bg: 'bg-teal-600' },
    { id: 'orange', name: language === 'ar' ? 'برتقالي' : 'Orange', bg: 'bg-orange-600' },
    { id: 'lime', name: language === 'ar' ? 'ليموني' : 'Lime', bg: 'bg-lime-600' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in max-w-5xl mx-auto">
        {/* LANGUAGE SETTINGS */}
        <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
            <h3 className="text-xl font-black text-slate-900 mb-8 flex items-center gap-3"><Globe className="text-primary-500"/> {txt.langSettings}</h3>
            <button onClick={toggleLanguage} className="w-full sm:w-auto bg-slate-50 border border-slate-200 px-10 py-5 rounded-2xl font-bold text-base flex items-center justify-center gap-3 hover:bg-white hover:border-primary-300 transition-all shadow-sm active:scale-95">
                <Globe size={24} className="text-primary-600"/> {txt.switchLang}
            </button>
        </div>
        
        {/* THEME COLOR SETTINGS */}
        <div className="bg-white p-8 md:p-10 rounded-3xl border border-slate-200/50 shadow-sm">
            <h3 className="text-xl font-black text-slate-900 mb-8 flex items-center gap-3"><Palette className="text-primary-500"/> {txt.themeSettings}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
                {colors.map((c) => (
                    <button key={c.id} onClick={() => setTheme(c.id)} className={`p-6 rounded-3xl border-2 flex flex-col items-center justify-center gap-4 transition-all ${theme === c.id ? 'border-primary-500 bg-primary-50 shadow-md scale-105' : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white'}`}>
                        <div className={`w-14 h-14 rounded-full ${c.bg} shadow-sm ring-4 ring-white`}></div>
                        <span className={`text-sm font-black ${theme === c.id ? 'text-primary-700' : 'text-slate-600'}`}>{c.name}</span>
                    </button>
                ))}
            </div>
        </div>

    </div>
  );
}
