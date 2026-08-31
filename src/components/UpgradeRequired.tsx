"use client";

import React from "react";
import { Lock, ArrowRight, ShieldCheck } from "lucide-react";

interface UpgradeRequiredProps {
  featureName: string;
  minTier: string;
}

export function UpgradeRequired({ featureName, minTier }: UpgradeRequiredProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center bg-surface rounded-3xl border border-slate-200/60 shadow-sm">
      <div className="w-20 h-20 bg-indigo-50 text-indigo-500 rounded-3xl flex items-center justify-center mb-6 shadow-sm border border-indigo-100/50">
        <Lock size={32} />
      </div>
      
      <h2 className="text-2xl font-black text-ink mb-3 tracking-tight">
        {featureName} is locked
      </h2>
      
      <p className="text-ink-muted max-w-md mb-8 text-lg">
        Your current plan does not include access to this feature. Upgrade to the <strong className="text-slate-800">{minTier}</strong> plan to unlock it and supercharge your clinic.
      </p>
      
      <button 
        onClick={() => window.open('mailto:billing@alphadental.saas?subject=Plan Upgrade Request', '_blank')}
        className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/30"
      >
        <ShieldCheck size={20} />
        Request Upgrade
        <ArrowRight size={18} className="ml-1 opacity-70" />
      </button>
    </div>
  );
}
