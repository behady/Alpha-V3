"use client";

import React, { useEffect, useState } from "react";
import { Clinic } from "@/types/saas";
import { Building2, CheckCircle2, PauseCircle, Clock, DollarSign } from "lucide-react";

interface KpiStripProps {
  clinics: Clinic[];
}

export function KpiStrip({ clinics }: KpiStripProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const totalClinics = clinics.length;
  const activeClinics = clinics.filter((c) => c.status === "Active").length;
  const suspendedClinics = clinics.filter((c) => c.status === "Suspended").length;
  const expiredOrTrialClinics = clinics.filter(
    (c) => c.status === "Expired" || c.subscriptionTier === "Free Trial"
  ).length;

  const mrr = clinics
    .filter((c) => c.status === "Active")
    .reduce((total, clinic) => {
      if (clinic.subscriptionTier === "Basic") return total + 50;
      if (clinic.subscriptionTier === "Pro") return total + 150;
      if (clinic.subscriptionTier === "Premium") return total + 300;
      return total;
    }, 0);

  const kpis = [
    {
      label: "Total Clinics",
      value: totalClinics,
      icon: Building2,
      color: "text-blue-600",
      bg: "bg-blue-50",
      gradient: "from-blue-500 to-blue-600",
    },
    {
      label: "Active",
      value: activeClinics,
      icon: CheckCircle2,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      gradient: "from-emerald-400 to-emerald-500",
    },
    {
      label: "Suspended",
      value: suspendedClinics,
      icon: PauseCircle,
      color: "text-amber-600",
      bg: "bg-amber-50",
      gradient: "from-amber-400 to-amber-500",
    },
    {
      label: "Expired / Trial",
      value: expiredOrTrialClinics,
      icon: Clock,
      color: "text-rose-600",
      bg: "bg-rose-50",
      gradient: "from-rose-400 to-rose-500",
    },
    {
      label: "Est. MRR",
      value: `$${mrr}`,
      icon: DollarSign,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
      gradient: "from-indigo-500 to-indigo-600",
    },
  ];

  if (!mounted) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      {kpis.map((kpi, idx) => (
        <div
          key={idx}
          className="bg-white rounded-2xl p-5 border border-slate-200/60 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
        >
          <div className="flex justify-between items-start mb-4">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${kpi.gradient} text-white shadow-sm`}
            >
              <kpi.icon size={20} strokeWidth={2.5} />
            </div>
          </div>
          <div>
            <div className="text-3xl font-black text-slate-900 tracking-tight">
              {kpi.value}
            </div>
            <div className="text-sm font-bold text-slate-500 mt-1">
              {kpi.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
