"use client";

// Clinic Detail Drawer Panel (With Manual Pricing & Financials)
import React, { useState } from "react";
import { Clinic, SubscriptionTier } from "@/types/saas";
import { X, Building2, Save, Users, ShieldAlert, KeyRound, CalendarDays, DollarSign, CreditCard } from "lucide-react";
import { TIER_LIMITS, getAiCreditLimit } from "@/lib/subscriptions";

interface ClinicDetailPanelProps {
  clinic: Clinic | null;
  users: any[];
  onClose: () => void;
  onUpdateClinic: (clinicId: string, updates: Partial<Clinic>) => Promise<void>;
  onDeleteClinic: (clinicId: string, clinicName: string) => void;
}

export function ClinicDetailPanel({ clinic, users, onClose, onUpdateClinic, onDeleteClinic }: ClinicDetailPanelProps) {
  const [adminNotes, setAdminNotes] = useState(clinic?.adminNotes || "");
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  if (!clinic) return null;

  const staff = users.filter(u => u.clinicRoles && u.clinicRoles[clinic.id]);

  const handleToggleFeature = async (feature: keyof NonNullable<Clinic["features"]>) => {
    const currentFeatures = clinic.features || {};
    const updatedFeatures = { ...currentFeatures, [feature]: !currentFeatures[feature] };
    await onUpdateClinic(clinic.id, { features: updatedFeatures });
  };

  const handleSaveNotes = async () => {
    setIsSaving(true);
    await onUpdateClinic(clinic.id, { adminNotes });
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right-8 duration-300">
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
        <div className="flex gap-4 items-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xl shrink-0">
            {clinic.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{clinic.name}</h2>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-mono">
              ID: {clinic.id}
              <button 
                onClick={() => navigator.clipboard.writeText(clinic.id)}
                className="text-indigo-600 hover:underline"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        
        {/* Subscription & Tier */}
        <section className="space-y-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <KeyRound size={16} className="text-indigo-500" /> Subscription Control
          </h3>
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/60 space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">Tier</label>
              <select
                value={clinic.subscriptionTier}
                onChange={(e) => {
                  const newTier = e.target.value as SubscriptionTier;
                  onUpdateClinic(clinic.id, { 
                    subscriptionTier: newTier,
                    features: { ...TIER_LIMITS[newTier].features }
                  });
                }}
                className="w-full bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
              >
                <option value="Free Trial">Free Trial</option>
                <option value="Basic">Basic</option>
                <option value="Pro">Pro</option>
                <option value="Premium">Premium</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Started At</label>
                <input 
                  type="date"
                  min="2020-01-01"
                  value={(() => {
                    const val = clinic.createdAt;
                    if (!val) return '';
                    try {
                      let d = new Date();
                      if (val.toDate) d = val.toDate();
                      else if (val.seconds) d = new Date(val.seconds * 1000);
                      else d = new Date(val);
                      if (isNaN(d.getTime())) return '';
                      return `${d.getFullYear().toString().padStart(4, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
                    } catch { return ''; }
                  })()}
                  onChange={(e) => {
                    const date = new Date(e.target.value);
                    if (!isNaN(date.getTime())) onUpdateClinic(clinic.id, { createdAt: date });
                  }}
                  className="w-full bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Expires At</label>
                <input 
                  type="date"
                  min="2020-01-01"
                  value={(() => {
                    const val = clinic.expiresAt;
                    if (!val) return '';
                    try {
                      let d = new Date();
                      if (val.toDate) d = val.toDate();
                      else if (val.seconds) d = new Date(val.seconds * 1000);
                      else d = new Date(val);
                      if (isNaN(d.getTime())) return '';
                      return `${d.getFullYear().toString().padStart(4, '0')}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
                    } catch { return ''; }
                  })()}
                  onChange={(e) => {
                    const date = new Date(e.target.value);
                    if (!isNaN(date.getTime())) onUpdateClinic(clinic.id, { expiresAt: date });
                  }}
                  className="w-full bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Pricing & Financial Setup */}
        <section className="space-y-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-500" /> Pricing & Financials
          </h3>
          <div className="bg-emerald-50/40 rounded-2xl p-4 border border-emerald-200/60 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Billing Cycle</label>
                <select
                  value={clinic.billingCycle || 'Monthly'}
                  onChange={(e) => {
                    onUpdateClinic(clinic.id, { 
                      billingCycle: e.target.value as 'Monthly' | 'Yearly' | '2-Yearly' 
                    });
                  }}
                  className="w-full bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-2.5 py-2 outline-none focus:border-emerald-500 shadow-sm"
                >
                  <option value="Monthly">Monthly</option>
                  <option value="Yearly">Yearly (1 Yr)</option>
                  <option value="2-Yearly">2-Yearly (2 Yrs)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Agreed Price ($)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={clinic.customPrice ?? ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateClinic(clinic.id, { customPrice: isNaN(val) ? 0 : val });
                  }}
                  className="w-full bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-2.5 py-2 outline-none focus:border-emerald-500 shadow-sm"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Amount Paid ($)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={clinic.amountPaid ?? ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateClinic(clinic.id, { amountPaid: isNaN(val) ? 0 : val });
                  }}
                  className="w-full bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl px-2.5 py-2 outline-none focus:border-emerald-500 shadow-sm"
                />
              </div>
            </div>

            {/* Live Calculation Summary */}
            {(() => {
              const cycle = clinic.billingCycle || 'Monthly';
              const price = clinic.customPrice || 0;
              const paid = clinic.amountPaid || 0;
              const monthlyMrr = cycle === '2-Yearly' ? price / 24 : cycle === 'Yearly' ? price / 12 : price;
              const balance = price - paid;

              return (
                <div className="p-3.5 bg-white border border-emerald-100 rounded-xl flex items-center justify-between text-xs shadow-sm">
                  <div>
                    <span className="text-slate-500 font-semibold block">Calculated Monthly MRR:</span>
                    <strong className="text-emerald-700 font-black text-sm">${Math.round(monthlyMrr * 100) / 100} / mo</strong>
                    <span className="text-slate-400 text-[10px] block">({cycle})</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 font-semibold block">Payment Status:</span>
                    {balance <= 0 ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-lg inline-block text-xs">
                        Fully Paid (${paid})
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-bold rounded-lg inline-block text-xs">
                        ${balance} Unpaid
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* Feature Toggles */}
        <section className="space-y-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Building2 size={16} className="text-emerald-500" /> Feature Overrides
          </h3>
          <div className="space-y-3">
            {['aiChat', 'whatsappIntegration', 'inventory', 'attendance', 'marketingText', 'marketingDesign'].map((feature) => (
              <div key={feature} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                <span className="font-bold text-sm text-slate-700 capitalize">
                  {feature === 'aiChat' ? 'AI Assistant'
                    : feature === 'marketingText' ? 'Marketing — Text & Strategy'
                    : feature === 'marketingDesign' ? 'Marketing — Design'
                    : feature.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <button
                  onClick={() => handleToggleFeature(feature as any)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    clinic.features?.[feature as keyof NonNullable<Clinic["features"]>] ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow transition-transform ${
                    clinic.features?.[feature as keyof NonNullable<Clinic["features"]>] ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            ))}

            <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Base Monthly AI Credits</label>
                <input
                  type="number"
                  value={clinic.features?.aiMonthlyCredits ?? (TIER_LIMITS[clinic.subscriptionTier || 'Free Trial']?.aiMonthlyCredits || 0)}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    onUpdateClinic(clinic.id, {
                      features: { ...(clinic.features || {}), aiMonthlyCredits: isNaN(val) ? 0 : val }
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold rounded-lg px-3 py-2 outline-none focus:border-indigo-500"
                  placeholder="1000"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold text-slate-700">Add Extra Credits</label>
                  <span className="text-xs font-black text-emerald-600">
                    + {clinic.features?.extraAiCredits || 0} bonus
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[100, 500, 1000].map((addAmount) => (
                    <button
                      key={addAmount}
                      type="button"
                      onClick={() => {
                        const currentExtra = clinic.features?.extraAiCredits || 0;
                        onUpdateClinic(clinic.id, {
                          features: { ...(clinic.features || {}), extraAiCredits: currentExtra + addAmount }
                        });
                      }}
                      className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/60 rounded-lg py-1.5 text-[11px] font-black transition-all active:scale-95"
                    >
                      +{addAmount}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateClinic(clinic.id, {
                        features: { ...(clinic.features || {}), extraAiCredits: 0 }
                      });
                    }}
                    className="px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg py-1.5 text-[11px] font-black transition-all active:scale-95"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-100">
                1 Text = 1 credit, 1 X-ray = 3 credits. Total allowance: <strong className="text-slate-800 font-bold">{getAiCreditLimit(clinic)} credits</strong>.
              </p>
            </div>
          </div>
        </section>

        {/* Staff Overview */}
        <section className="space-y-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Users size={16} className="text-blue-500" /> Staff Members ({staff.length})
          </h3>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
            {staff.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500 font-medium">No staff found</div>
            ) : (
              staff.map(member => (
                <div key={member.id} className="p-3 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{member.name || 'No Name'}</div>
                    <div className="text-xs text-slate-500">{member.email}</div>
                  </div>
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-bold">
                    {member.clinicRoles[clinic.id]}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Admin Notes */}
        <section className="space-y-4">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <CalendarDays size={16} className="text-amber-500" /> Admin Notes
          </h3>
          <div className="space-y-2">
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Internal notes about this clinic..."
              className="w-full h-32 bg-white border border-slate-200 text-slate-700 text-sm rounded-xl p-3 outline-none focus:border-amber-500 resize-none"
            />
            <button 
              onClick={handleSaveNotes}
              disabled={isSaving || adminNotes === (clinic.adminNotes || "")}
              className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50 font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Save size={16} /> {isSaving ? "Saving..." : "Save Notes"}
            </button>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="pt-6 border-t border-rose-100 space-y-4">
          <h3 className="text-sm font-black text-rose-600 uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert size={16} /> Danger Zone
          </h3>
          <button 
            onClick={() => {
              onClose();
              onDeleteClinic(clinic.id, clinic.name);
            }}
            className="w-full bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white font-bold py-3 rounded-xl text-sm transition-colors border border-rose-200 hover:border-rose-600"
          >
            Permanently Delete Clinic
          </button>
        </section>

      </div>
    </div>
  );
}
