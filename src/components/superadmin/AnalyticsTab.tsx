"use client";

import React, { useMemo } from "react";
import { Clinic } from "@/types/saas";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { TrendingUp, Users } from "lucide-react";

interface AnalyticsTabProps {
  clinics: Clinic[];
}

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f43f5e'];

export function AnalyticsTab({ clinics }: AnalyticsTabProps) {
  const { signupsData, revenueData, topClinics } = useMemo(() => {
    // 1. Signups per month (Last 6 months)
    const months = Array.from({ length: 6 }).map((_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      return d.toLocaleString('default', { month: 'short', year: 'numeric' });
    });
    
    const signupsMap = new Map(months.map(m => [m, 0]));
    
    clinics.forEach(c => {
      if (!c.createdAt) return;
      const d = new Date(c.createdAt.toDate ? c.createdAt.toDate() : c.createdAt);
      const m = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      if (signupsMap.has(m)) {
        signupsMap.set(m, signupsMap.get(m)! + 1);
      }
    });

    const signupsData = months.map(m => ({ name: m, Signups: signupsMap.get(m) }));

    // 2. Revenue Breakdown
    let basicRev = 0, proRev = 0, premiumRev = 0;
    clinics.forEach(c => {
      if (c.status === 'Active') {
        let rev = 0;
        if (c.customPrice !== undefined && c.customPrice !== null) {
          const cycle = c.billingCycle || 'Monthly';
          const price = Number(c.customPrice) || 0;
          rev = cycle === '2-Yearly' ? price / 24 : cycle === 'Yearly' ? price / 12 : price;
        } else {
          if (c.subscriptionTier === 'Basic') rev = 50;
          else if (c.subscriptionTier === 'Pro') rev = 150;
          else if (c.subscriptionTier === 'Premium') rev = 300;
        }

        if (c.subscriptionTier === 'Basic') basicRev += rev;
        else if (c.subscriptionTier === 'Pro') proRev += rev;
        else if (c.subscriptionTier === 'Premium') premiumRev += rev;
      }
    });

    const revenueData = [
      { name: 'Basic', value: Math.round(basicRev) },
      { name: 'Pro', value: Math.round(proRev) },
      { name: 'Premium', value: Math.round(premiumRev) },
    ].filter(d => d.value > 0);

    // 3. Top Clinics (Ranking by MRR contribution & total paid)
    const getClinicMonthlyMrr = (c: Clinic) => {
      if (c.status !== 'Active') return 0;
      if (c.customPrice !== undefined && c.customPrice !== null) {
        const cycle = c.billingCycle || 'Monthly';
        const price = Number(c.customPrice) || 0;
        return cycle === '2-Yearly' ? price / 24 : cycle === 'Yearly' ? price / 12 : price;
      }
      const weight = { 'Premium': 300, 'Pro': 150, 'Basic': 50, 'Free Trial': 0 };
      return weight[c.subscriptionTier] || 0;
    };

    const sorted = [...clinics].sort((a, b) => {
      const ma = getClinicMonthlyMrr(a);
      const mb = getClinicMonthlyMrr(b);
      if (ma !== mb) return mb - ma;
      return (Number(b.amountPaid) || 0) - (Number(a.amountPaid) || 0);
    });

    return {
      signupsData,
      revenueData,
      topClinics: sorted.slice(0, 5)
    };
  }, [clinics]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Signups Chart */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200/60 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Clinic Growth</h3>
              <p className="text-sm text-slate-500 font-medium">New signups over last 6 months</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signupsData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{borderRadius: '1rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="Signups" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Revenue Donut */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-200/60 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <div className="font-bold">$</div>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">MRR Breakdown</h3>
              <p className="text-sm text-slate-500 font-medium">Revenue distribution by tier</p>
            </div>
          </div>
          <div className="h-64 flex justify-center">
            {revenueData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 font-bold">No active MRR</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={revenueData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {revenueData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: any) => `$${value}`}
                    contentStyle={{borderRadius: '1rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Top Clinics */}
      <div className="bg-white p-6 rounded-[2rem] border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Users size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Top Clinics</h3>
            <p className="text-sm text-slate-500 font-medium">Highest tier active clinics</p>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {topClinics.length === 0 ? (
            <p className="text-sm text-slate-400 py-4">No clinics available.</p>
          ) : (
            topClinics.map((clinic, idx) => (
              <div key={clinic.id} className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-slate-300 font-black text-xl w-6">{idx + 1}</div>
                  <div>
                    <h4 className="font-bold text-slate-900">{clinic.name}</h4>
                    <span className="text-xs text-slate-500">ID: {clinic.id}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`px-3 py-1 text-xs font-bold rounded-lg ${
                    clinic.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {clinic.status}
                  </span>
                  <span className="px-3 py-1 text-xs font-bold bg-indigo-50 text-indigo-700 rounded-lg">
                    {clinic.subscriptionTier}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
