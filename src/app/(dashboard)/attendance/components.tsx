"use client";

import { useState } from "react";
import { 
  MapPin, LogIn, LogOut, CheckCircle2, Hourglass,
  Users, TrendingUp, TrendingDown, Filter, Settings2, Trash2, 
  X, Save, DollarSign, Smartphone, ShieldAlert, Lock, FileText, Edit2, History
} from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";

// --- HELPERS ---
const formatTime = (ts: any) => {
    if (!ts) return "-";
    if (ts instanceof Timestamp) return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return "-";
};

const formatDuration = (mins: number) => {
    if (!mins) return "0h 0m";
    return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
};

const toInputFormat = (ts: any) => {
    if (!ts) return "";
    const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The roster is stored against these English names; only the label on screen is translated. */
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS: Record<string, string> = {
  Sunday: "attSunday", Monday: "attMonday", Tuesday: "attTuesday", Wednesday: "attWednesday",
  Thursday: "attThursday", Friday: "attFriday", Saturday: "attSaturday",
};

// ==========================================
// 1. PERSONAL WORKSHEET COMPONENT
// ==========================================
export const PersonalWorksheet = ({ 
    activeSession, isDeviceBlocked, isDeviceMismatch, liveDuration, actionLoading, handlePunch, 
    myCalculatedStats, personalLogs, myProfile, language
}: any) => {
  const { t } = useLanguage();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in slide-in-from-bottom-4 duration-500">
        {/* LEFT COLUMN: Terminal & Earnings */}
        <div className="lg:col-span-4 space-y-6">
            <div className={`bg-surface rounded-[2.5rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border flex flex-col items-center text-center relative overflow-hidden transition-all duration-500 ${activeSession ? 'border-emerald-200/50' : 'border-line'}`}>
                {activeSession && <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/50 to-transparent pointer-events-none"></div>}
                {isDeviceBlocked ? (
                    <div className="flex flex-col items-center justify-center py-6 relative z-10">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-red-50 to-red-100/50 text-red-500 border-4 border-white shadow-sm flex items-center justify-center mb-6"><Lock size={32} className="drop-shadow-sm"/></div>
                        <h2 className="text-xl font-black text-ink mb-2">{t("attDeviceBlocked")}</h2>
                        <p className="text-sm font-bold text-ink-muted px-2 leading-relaxed">{t("attDeviceBlockedHint")}</p>
                    </div>
                ) : (
                    <div className="relative z-10 w-full flex flex-col items-center">
                        {activeSession && <div className="absolute top-0 left-0 right-0 h-1.5 bg-emerald-500 animate-pulse rounded-full opacity-80"></div>}
                        <div className={`w-28 h-28 rounded-full flex items-center justify-center mb-6 shadow-sm border-[6px] transition-all duration-500 ${activeSession ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-white text-emerald-500 scale-105' : 'bg-surface-subtle border-white text-slate-400'}`}>
                            {activeSession ? <Hourglass size={36} className="animate-pulse drop-shadow-sm"/> : <MapPin size={36}/>}
                        </div>
                        <h2 className="text-2xl font-black text-ink mb-2">{activeSession ? t("attShiftInProgress") : t("attReadyToWork")}</h2>
                        <p className="text-[14px] font-semibold text-ink-muted mb-8 px-4">{activeSession ? t("attClockOutHint") : t("attClockInHint")}</p>

                        {isDeviceMismatch && activeSession && (
                            <div className="mb-6 w-full flex items-start gap-3 text-left bg-gradient-to-r from-amber-50 to-orange-50/50 text-amber-800 p-4 rounded-2xl border border-amber-100 text-[13px] font-semibold leading-relaxed shadow-sm">
                                <ShieldAlert size={18} className="shrink-0 mt-0.5 text-amber-600"/>
                                {t("attDeviceChanged")}
                            </div>
                        )}

                        {activeSession && (
                            <div className="mb-8 w-full bg-white border border-emerald-100/50 shadow-sm rounded-2xl p-5 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-400 rounded-full blur-[40px] opacity-10 pointer-events-none"></div>
                                <p className="text-[11px] font-black uppercase text-emerald-600/70 tracking-widest mb-1">{t("attCurrentSession")}</p>
                                <p className="text-3xl font-black text-emerald-600 tabular-nums tracking-tight">{liveDuration || "0h 0m 0s"}</p>
                            </div>
                        )}

                        {activeSession ? (
                            <button onClick={() => handlePunch('out')} disabled={actionLoading} className="w-full bg-gradient-to-b from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white py-4 rounded-2xl font-black text-lg shadow-[0_4px_14px_rgba(239,68,68,0.39)] active:scale-95 transition-all flex justify-center items-center gap-3 disabled:opacity-50">
                                <LogOut size={22}/> {t("attClockOut")}
                            </button>
                        ) : (
                            <button onClick={() => handlePunch('in')} disabled={actionLoading} className="w-full bg-gradient-to-b from-ink-strong to-ink hover:from-ink hover:to-ink-slab text-white py-4 rounded-2xl font-black text-lg shadow-[0_4px_14px_rgba(15,23,42,0.3)] active:scale-95 transition-all flex justify-center items-center gap-3 disabled:opacity-50">
                                <LogIn size={22}/> {t("attClockIn")}
                            </button>
                        )}

                        {myProfile && !myProfile.registeredDeviceId && !activeSession && (
                            <div className="mt-5 flex items-start gap-3 text-left bg-gradient-to-r from-accent-tint to-accent-tint/50 text-accent-strong p-4 rounded-2xl border border-accent-soft text-[13px] font-semibold leading-relaxed shadow-sm">
                                <ShieldAlert size={18} className="shrink-0 mt-0.5"/> {t("attDeviceWillRegister")}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {myCalculatedStats && (
                <div className="bg-gradient-to-br from-ink-strong to-ink rounded-[2rem] p-7 shadow-xl border border-ink-slab text-white relative overflow-hidden transition-transform hover:-translate-y-1 duration-300">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-accent-soft rounded-full blur-[60px] opacity-20 pointer-events-none"></div>
                    <div className="flex items-center justify-between mb-6 relative z-10">
                        <h3 className="font-bold text-slate-300 uppercase tracking-widest text-[11px] flex items-center gap-2"><DollarSign size={14}/> {t("attMonthEarnings")}</h3>
                    </div>
                    <div className="space-y-5 relative z-10">
                        <div>
                            <p className="text-4xl font-black text-white tabular-nums tracking-tight">{Math.floor(myCalculatedStats.finalTotalPay).toLocaleString()} <span className="text-lg text-slate-400 font-bold ml-1">EGP</span></p>
                            <p className="text-[11px] font-bold text-emerald-400 mt-2 flex items-center gap-1.5"><TrendingUp size={14}/> {t("attAutoCalculated")}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-5 border-t border-white/10">
                            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{t("attBasePay")}</p>
                                <p className="font-bold text-[15px] text-white tracking-tight">{Math.floor(myCalculatedStats.estimatedBasePay).toLocaleString()} EGP</p>
                            </div>
                            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{t("attCommissions")}</p>
                                <p className="font-bold text-[15px] text-emerald-400 tracking-tight">+{Math.floor(myCalculatedStats.earnedCommissions).toLocaleString()} EGP</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* RIGHT COLUMN: Table */}
        <div className="lg:col-span-8">
            <div className="bg-surface rounded-[2.5rem] border border-line shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden flex flex-col h-full min-h-[500px]">
                <div className="p-7 border-b border-line/50 flex justify-between items-center bg-gradient-to-b from-surface-subtle/80 to-surface-muted/30">
                    <div>
                        <h3 className="font-black text-ink text-xl mb-1">{t("attMyTimeLogs")}</h3>
                        <p className="text-[13px] font-semibold text-ink-muted">{t("attMyLogsHint")}</p>
                    </div>
                </div>
                <div className="overflow-x-auto flex-1 p-2">
                    <table className="w-full text-left text-sm border-separate border-spacing-y-1">
                        <thead className="text-ink-muted font-black text-[10px] uppercase tracking-widest sticky top-0 bg-surface z-10">
                            <tr>
                                <th className="py-3 px-5">{t("attDate")}</th>
                                <th className="py-3 px-4 text-center">{t("attClockIn")}</th>
                                <th className="py-3 px-4 text-center">{t("attClockOut")}</th>
                                <th className="py-3 px-4 text-center">{t("attTotalTime")}</th>
                                <th className="py-3 px-5 text-right">{t("attStatus")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {personalLogs.length === 0 ? (
                                <tr><td colSpan={5} className="py-16 text-center text-ink-muted font-bold text-sm bg-surface-subtle/30 rounded-2xl">{t("attNoRecords")}</td></tr>
                            ) : (
                                personalLogs.map((log: any) => (
                                    <tr key={log.id} className="group hover:bg-surface-subtle transition-colors">
                                        <td className="py-3 px-5 font-bold text-ink rounded-l-2xl group-hover:bg-surface-subtle transition-colors">{log.date || (log.checkIn && log.checkIn.toDate().toISOString().split('T')[0])}</td>
                                        <td className="py-3 px-4 font-bold text-ink-body text-center group-hover:bg-surface-subtle transition-colors">{formatTime(log.checkIn)}</td>
                                        <td className="py-3 px-4 font-bold text-ink-body text-center group-hover:bg-surface-subtle transition-colors">{formatTime(log.checkOut)}</td>
                                        <td className="py-3 px-4 font-black text-ink text-center group-hover:bg-surface-subtle transition-colors">{log.status === 'active' ? <span className="text-emerald-500 animate-pulse">{t("attInProgress")}</span> : formatDuration(log.durationMinutes)}</td>
                                        <td className="py-3 px-5 text-right rounded-r-2xl group-hover:bg-surface-subtle transition-colors">
                                            {log.status === 'active' ? (
                                                <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-100 shadow-sm">
                                                    <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span>
                                                    {t("attActive")}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 bg-surface border border-line text-ink-muted px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm">
                                                    <CheckCircle2 size={12} className="text-emerald-500"/> {t("attLogged")}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
  );
};

// ==========================================
// 2. TEAM OVERVIEW COMPONENT
// ==========================================
export const TeamOverview = ({ 
    startDate, endDate, setStartDate, setEndDate, filterRole, setFilterRole, 
    filterUser, setFilterUser, allStaff, payrollData, handleGeneratePayrollPDF, 
    handleGenerateCommissionPDF, openSettingsModal, openLogsModal, commissionBreakdownRows, handleUpdateCommissionEntry
}: any) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
        {/* ADMIN FILTER BAR */}
        <div className="bg-surface p-5 rounded-[2rem] border border-line shadow-[0_4px_20px_rgb(0,0,0,0.02)] flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent-soft rounded-full blur-[50px] opacity-10 pointer-events-none"></div>
            <div className="flex items-center gap-3 relative z-10">
                <div className="w-10 h-10 rounded-full bg-accent-tint text-accent flex items-center justify-center border border-accent-soft/50 shadow-sm">
                    <Filter size={18} />
                </div>
                <h3 className="font-black text-ink text-lg">{t("attPayrollEngine")}</h3>
            </div>
            <div className="flex flex-col xl:flex-row items-center gap-3 w-full lg:w-auto relative z-10">
                <div className="relative w-full sm:w-auto">
                    <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className="w-full sm:w-auto appearance-none bg-surface-subtle border border-line text-slate-700 pl-4 pr-10 py-3 rounded-xl text-xs font-bold outline-none cursor-pointer focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20 transition-all shadow-sm">
                        <option value="all">{t("attAllRoles")}</option>
                        <option value="Dentist">{t("attDentists")}</option>
                        <option value="Assistant">{t("attAssistants")}</option>
                        <option value="Receptionist">{t("attReceptionists")}</option>
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                </div>
                <div className="relative w-full sm:w-auto">
                    <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="w-full sm:w-auto appearance-none bg-surface-subtle border border-line text-slate-700 pl-4 pr-10 py-3 rounded-xl text-xs font-bold outline-none cursor-pointer focus:border-accent-soft focus:ring-2 focus:ring-accent-soft/20 transition-all shadow-sm max-w-[200px] truncate">
                        <option value="all">{t("attAllStaff")}</option>
                        {allStaff.filter((s: any) => filterRole === 'all' || s.role === filterRole).map((s: any) => (
                            <option key={s.id} value={s.uid || s.id}>{s.name}</option>
                        ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                </div>
            </div>
        </div>

        {/* PAYROLL SUMMARY TABLE */}
        <div className="bg-surface rounded-[2.5rem] border border-line shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col">
            <div className="p-7 border-b border-line/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-5 bg-gradient-to-b from-surface-subtle/80 to-surface-muted/30">
                <div>
                    <h3 className="font-black text-ink text-xl mb-1">{t("attFinalPayroll")}</h3>
                    <p className="text-[13px] font-semibold text-ink-muted">{t("attPayrollHint")}</p>
                </div>
                <button onClick={handleGeneratePayrollPDF} className="bg-gradient-to-br from-ink-strong to-ink text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all shrink-0 active:scale-95 border border-ink-slab">
                    <FileText size={16} className="text-slate-300"/> {t("attGeneratePayrollPdf")}
                </button>
            </div>
            
            <div className="overflow-x-auto p-2">
                <table className="w-full text-left text-sm min-w-[900px] border-separate border-spacing-y-1">
                    <thead className="text-ink-muted font-black text-[10px] uppercase tracking-widest sticky top-0 bg-surface z-10">
                        <tr>
                            <th className="py-3 px-5 whitespace-nowrap">{t("attStaffMember")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-center">{t("attSettingsLogs")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attRegMissed")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attApprPendOt")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attBasePay")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attCommissions")}</th>
                            <th className="py-3 px-5 whitespace-nowrap text-right text-emerald-600">{t("attNetPayout")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {payrollData.length === 0 ? (
                            <tr><td colSpan={7} className="py-16 text-center text-ink-muted font-bold text-sm bg-surface-subtle/30 rounded-2xl">{t("attNoPayrollData")}</td></tr>
                        ) : (
                            payrollData.map((staff: any, idx: number) => (
                                <tr key={idx} className="group hover:bg-surface-subtle transition-colors">
                                    <td className="py-4 px-5 rounded-l-2xl group-hover:bg-surface-subtle transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 border border-white shadow-sm flex items-center justify-center shrink-0">
                                                <Users size={16} className="text-slate-500"/>
                                            </div>
                                            <div>
                                                <p className="font-black text-ink flex items-center gap-2">
                                                    {staff.name}
                                                    {staff.activeNow && (
                                                        <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-100 shadow-sm animate-in fade-in">
                                                            <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span></span>
                                                            Live In Clinic
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{staff.role}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4 group-hover:bg-surface-subtle transition-colors">
                                        <div className="flex items-center justify-center gap-2">
                                            <button onClick={() => openSettingsModal(staff)} className={`flex items-center justify-center gap-1.5 bg-surface border px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${staff.registeredDeviceId ? 'border-line text-ink-body hover:text-accent hover:border-accent-soft hover:shadow-md' : 'border-orange-200/60 bg-orange-50/50 text-orange-600 hover:bg-orange-100 hover:border-orange-300'}`}>
                                                <Settings2 size={14} className={staff.registeredDeviceId ? 'text-slate-400 group-hover:text-accent' : ''}/> {Math.floor(staff.expectedMonthlyHours)}h | {staff.commissionPercentage}%
                                            </button>
                                            <button onClick={() => openLogsModal(staff)} className="flex items-center justify-center gap-1.5 bg-surface border border-line px-3 py-1.5 rounded-xl text-xs font-bold text-ink-body hover:text-accent hover:border-accent-soft hover:shadow-md transition-all shadow-sm">
                                                <History size={14} className="text-slate-400 group-hover:text-accent"/> Logs
                                            </button>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4 text-right group-hover:bg-surface-subtle transition-colors">
                                        <p className="font-black text-ink-body">{formatDuration(staff.regularMinutes)}</p>
                                        {staff.missingMinutes > 0 && <p className="text-[10px] font-bold text-red-500 flex justify-end items-center gap-1"><TrendingDown size={10}/> {formatDuration(staff.missingMinutes)}</p>}
                                    </td>
                                    <td className="py-4 px-4 text-right group-hover:bg-surface-subtle transition-colors">
                                        <p className="font-black text-accent">{formatDuration(staff.approvedOvertimeMinutes)}</p>
                                        {staff.pendingOvertimeMinutes > 0 && <p className="text-[10px] font-bold text-amber-500 flex justify-end items-center gap-1">Pend: {formatDuration(staff.pendingOvertimeMinutes)}</p>}
                                    </td>
                                    <td className="py-4 px-4 text-right font-bold text-ink-muted group-hover:bg-surface-subtle transition-colors tabular-nums">{Math.floor(staff.estimatedBasePay).toLocaleString()}</td>
                                    <td className="py-4 px-4 text-right group-hover:bg-surface-subtle transition-colors tabular-nums">
                                        {staff.earnedCommissions > 0 ? <span className="text-accent font-bold flex items-center justify-end gap-1.5"><TrendingUp size={12}/> {Math.floor(staff.earnedCommissions).toLocaleString()}</span> : <span className="text-slate-300">-</span>}
                                    </td>
                                    <td className="py-4 px-5 rounded-r-2xl text-right font-black text-emerald-600 text-lg tracking-tight group-hover:bg-surface-subtle transition-colors tabular-nums">{Math.floor(staff.finalTotalPay).toLocaleString()}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>

        {/* COMMISSION BREAKDOWN TABLE */}
        <div className="bg-surface rounded-[2.5rem] border border-line shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col">
            <div className="p-7 border-b border-line/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-5 bg-gradient-to-b from-surface-subtle/80 to-surface-muted/30">
                <div>
                    <h3 className="font-black text-ink text-xl mb-1">{t("attCommissionEngine")}</h3>
                    <p className="text-[13px] font-semibold text-ink-muted max-w-2xl">
                        Shows exactly where commission comes from (patient + service). Editing % recalculates doctor share and clinic profit in ledger.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[11px] font-black uppercase tracking-widest text-accent bg-accent-tint border border-accent-soft px-3 py-1.5 rounded-xl shadow-sm">
                        {commissionBreakdownRows.length} entries
                    </span>
                    <button onClick={handleGenerateCommissionPDF} className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white px-5 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-[0_4px_14px_rgba(79,70,229,0.3)] hover:shadow-[0_6px_20px_rgba(79,70,229,0.4)] hover:-translate-y-0.5 transition-all shrink-0 active:scale-95">
                        <FileText size={16} className="text-indigo-200"/> Export PDF
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto p-2">
                <table className="w-full text-left text-sm min-w-[1200px] border-separate border-spacing-y-1">
                    <thead className="text-ink-muted font-black text-[10px] uppercase tracking-widest sticky top-0 bg-surface z-10">
                        <tr>
                            <th className="py-3 px-5 whitespace-nowrap">{t("attDate")}</th>
                            <th className="py-3 px-4 whitespace-nowrap">{t("attDoctor")}</th>
                            <th className="py-3 px-4 whitespace-nowrap">{t("attPatient")}</th>
                            <th className="py-3 px-4 whitespace-nowrap">{t("attServiceSource")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attPayment")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attLabFee")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right">{t("attNet")}</th>
                            <th className="py-3 px-4 whitespace-nowrap text-center">% Split</th>
                            <th className="py-3 px-4 whitespace-nowrap text-right text-accent">{t("attDoctorComm")}</th>
                            <th className="py-3 px-5 whitespace-nowrap text-right text-emerald-600">{t("attClinicProfit")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {commissionBreakdownRows.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="py-16 text-center text-ink-muted font-bold text-sm bg-surface-subtle/30 rounded-2xl">
                                    No commission-bearing payment entries found in selected period.
                                </td>
                            </tr>
                        ) : (
                            commissionBreakdownRows.map((row: any) => (
                                <tr key={row.id} className="group hover:bg-surface-subtle transition-colors">
                                    <td className="py-4 px-5 rounded-l-2xl font-bold text-ink tabular-nums group-hover:bg-surface-subtle transition-colors">{row.date || "—"}</td>
                                    <td className="py-4 px-4 group-hover:bg-surface-subtle transition-colors">
                                        <p className="font-black text-ink">{row.staffName}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{row.staffRole}</p>
                                    </td>
                                    <td className="py-4 px-4 font-bold text-slate-700 group-hover:bg-surface-subtle transition-colors">{row.patientName || "—"}</td>
                                    <td className="py-4 px-4 group-hover:bg-surface-subtle transition-colors">
                                        <p className="font-bold text-slate-700 max-w-[280px] truncate" title={row.serviceSource || row.procedureDescription || row.description || "—"}>
                                            {row.serviceSource || row.procedureDescription || row.description || "—"}
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                            {row.procedureId ? `${t("attServiceSource")}: ${row.procedureId}` : t("attLedger")} · {row.id.substring(0, 8)}...
                                        </p>
                                    </td>
                                    <td className="py-4 px-4 text-right font-black text-ink tabular-nums group-hover:bg-surface-subtle transition-colors">
                                        {Math.floor(Number(row.paidAmount || 0)).toLocaleString()}
                                    </td>
                                    <td className="py-4 px-4 text-right font-bold text-ink-muted tabular-nums group-hover:bg-surface-subtle transition-colors">
                                        {Math.floor(Number(row.labFee || 0)).toLocaleString()}
                                    </td>
                                    <td className="py-4 px-4 text-right font-bold text-ink-body tabular-nums group-hover:bg-surface-subtle transition-colors">
                                        {Math.floor(Number(row.netAmount || 0)).toLocaleString()}
                                    </td>
                                    <td className="py-4 px-4 text-center group-hover:bg-surface-subtle transition-colors">
                                        <div className="inline-flex items-center justify-center gap-1.5 bg-surface border border-line rounded-xl px-3 py-2 shadow-sm focus-within:border-accent-soft focus-within:ring-2 focus-within:ring-accent-soft/20 transition-all">
                                            <input
                                                type="number"
                                                min={0}
                                                max={100}
                                                step={0.1}
                                                defaultValue={Number(row.commissionPct || 0).toFixed(2)}
                                                onBlur={(e) => {
                                                    const next = Number(e.currentTarget.value);
                                                    if (Number.isNaN(next)) return;
                                                    if (Math.abs(next - Number(row.commissionPct || 0)) < 0.001) return;
                                                    void handleUpdateCommissionEntry(row.id, next);
                                                }}
                                                className="w-14 text-center font-black text-slate-800 bg-transparent outline-none"
                                            />
                                            <span className="text-xs font-black text-slate-400">%</span>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4 text-right font-black text-accent tabular-nums group-hover:bg-surface-subtle transition-colors text-base">
                                        {Math.floor(Number(row.doctorCommissionAmount || 0)).toLocaleString()}
                                    </td>
                                    <td className="py-4 px-5 rounded-r-2xl text-right font-black text-emerald-600 tabular-nums group-hover:bg-surface-subtle transition-colors text-base">
                                        {Math.floor(Number(row.clinicProfit || 0)).toLocaleString()}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
};

// ==========================================
// 3. EDIT STAFF LOGS MODAL (NEW)
// ==========================================
export const StaffLogsModal = ({ isOpen, onClose, staffName, logs, handleUpdateLog, handleDeleteLog, handleOvertimeDecision }: any) => {
  const { t } = useLanguage();
    const [editingLogId, setEditingLogId] = useState<string | null>(null);
    const [editIn, setEditIn] = useState("");
    const [editOut, setEditOut] = useState("");

    if (!isOpen) return null;

    const startEdit = (log: any) => {
        setEditingLogId(log.id);
        setEditIn(toInputFormat(log.checkIn));
        setEditOut(log.checkOut ? toInputFormat(log.checkOut) : "");
    };

    const saveEdit = (logId: string) => {
        handleUpdateLog(logId, editIn, editOut);
        setEditingLogId(null);
    };

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95">
                <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-lg font-black text-slate-900">{t("attLogsOf")} {staffName}</h2>
                        <p className="text-xs font-semibold text-ink-muted mt-0.5">{t("attEditLogsHint")}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-surface rounded-full text-slate-400 hover:text-red-500 border border-line shadow-sm"><X size={16}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    <div className="space-y-3">
                        {logs.length === 0 ? <p className="text-center text-slate-400 font-bold py-10">{t("attNoLogsPeriod")}</p> : null}
                        {logs.map((log: any) => (
                            <div key={log.id} className={`p-4 rounded-2xl border bg-surface shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${log.status === 'active' ? 'border-emerald-200 ring-1 ring-emerald-500/10' : 'border-line'}`}>
                                
                                {editingLogId === log.id ? (
                                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">{t("attCheckIn")}</label>
                                            <input type="datetime-local" value={editIn} onChange={e=>setEditIn(e.target.value)} className="w-full text-xs font-bold p-2 border rounded-lg focus:border-accent-soft outline-none bg-surface-subtle" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">{t("attCheckOutBlank")}</label>
                                            <input type="datetime-local" value={editOut} onChange={e=>setEditOut(e.target.value)} className="w-full text-xs font-bold p-2 border rounded-lg focus:border-accent-soft outline-none bg-surface-subtle" />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${log.status === 'active' ? 'bg-emerald-50 text-emerald-500' : 'bg-surface-muted text-slate-400'}`}>
                                            {log.status === 'active' ? <Hourglass size={20} className="animate-pulse"/> : <CheckCircle2 size={20}/>}
                                        </div>
                                        <div>
                                            <p className="font-bold text-ink text-sm">
                                                {log.date}
                                                {log.status === 'active' && <span className="ml-2 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">{t("attActive")}</span>}
                                            </p>
                                            <div className="text-xs font-semibold text-ink-muted mt-1 flex items-center gap-2 flex-wrap">
                                                <span>In: {formatTime(log.checkIn)}</span> <span className="text-slate-300">•</span> <span>Out: {formatTime(log.checkOut)}</span> 
                                                <span className="text-slate-300">•</span> <span className="text-slate-700 font-bold">{formatDuration(log.durationMinutes)}</span>
                                            </div>
                                            {log.status === 'completed' && log.durationMinutes > 0 && (
                                                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100 w-full">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t("attOvertime")}</span>
                                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${log.overtimeStatus === 'approved' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : log.overtimeStatus === 'rejected' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                                                        {log.overtimeStatus || 'Pending'}
                                                    </span>
                                                    <div className="flex gap-1 ml-auto">
                                                        {log.overtimeStatus !== 'approved' && <button onClick={() => handleOvertimeDecision(log.id, 'approved')} className="text-[10px] bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:scale-105 active:scale-95 px-2 py-1 rounded font-bold transition-all shadow-sm">{t("attApprove")}</button>}
                                                        {log.overtimeStatus !== 'rejected' && <button onClick={() => handleOvertimeDecision(log.id, 'rejected')} className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 hover:scale-105 active:scale-95 px-2 py-1 rounded font-bold transition-all shadow-sm">{t("attReject")}</button>}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-2 shrink-0">
                                    {editingLogId === log.id ? (
                                        <>
                                            <button onClick={() => saveEdit(log.id)} className="bg-emerald-600 text-white p-2 rounded-lg font-bold text-xs flex items-center gap-1 shadow-sm"><Save size={14}/> Save</button>
                                            <button onClick={() => setEditingLogId(null)} className="bg-white border border-slate-200 text-slate-600 p-2 rounded-lg font-bold text-xs shadow-sm">{t("attCancel")}</button>
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => startEdit(log)} className="bg-surface border border-line text-ink-body hover:text-accent p-2 rounded-lg font-bold text-xs flex items-center gap-1 shadow-sm"><Edit2 size={14}/> Edit</button>
                                            <button onClick={() => handleDeleteLog(log.id)} className="bg-surface border border-line text-slate-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg shadow-sm"><Trash2 size={14}/></button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 4. STAFF SETTINGS MODAL
// ==========================================
export const StaffSettingsModal = ({ settingsModal, setSettingsModal, handleUpdateStaffSettings, handleUnlinkDevice }: any) => {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
        <div className="bg-white rounded-[2rem] p-8 w-full max-w-2xl shadow-2xl animate-in zoom-in-95 border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6 shrink-0">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">{t("attShiftPaySettings")}</h2>
                    <p className="text-xs font-semibold text-ink-muted mt-1">{t("attRulesFor")} {settingsModal.name}</p>
                </div>
                <button onClick={() => setSettingsModal({isOpen: false, staffId: "", name: "", baseSalary: 0, commissionPercentage: 0, registeredDeviceId: null, overtimeMultiplier: 1.5, schedule: []})} className="text-slate-400 hover:text-red-500 bg-surface-subtle hover:bg-red-50 p-2 rounded-full transition-colors"><X size={20}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-orange-900 text-sm flex items-center gap-2"><Smartphone size={16}/> Device Security</h4>
                        <p className="text-xs font-medium text-orange-800 mt-1">{settingsModal.registeredDeviceId ? t("attPhoneLocked") : t("attNoPhoneLinked")}</p>
                    </div>
                    {settingsModal.registeredDeviceId && (
                        <button type="button" onClick={handleUnlinkDevice} className="bg-surface border border-orange-200 text-orange-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-orange-100 transition-all shadow-sm">{t("attResetLink")}</button>
                    )}
                </div>

                <form onSubmit={handleUpdateStaffSettings} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-surface-subtle p-4 rounded-2xl border border-slate-200/60"><label className="text-[11px] font-bold text-ink-muted uppercase block mb-2">{t("attMonthlyBase")}</label><input type="number" required value={settingsModal.baseSalary} onChange={e => setSettingsModal({...settingsModal, baseSalary: Number(e.target.value)})} className="w-full px-4 py-3 bg-surface rounded-xl border border-line font-black outline-none focus:border-accent-soft"/></div>
                        <div className="bg-accent-tint p-4 rounded-2xl border border-accent-soft"><label className="text-[11px] font-bold text-accent uppercase block mb-2">{t("attCommissionPct")}</label><input type="number" required value={settingsModal.commissionPercentage} onChange={e => setSettingsModal({...settingsModal, commissionPercentage: Number(e.target.value)})} className="w-full px-4 py-3 bg-surface rounded-xl border border-accent-soft font-black text-accent-strong outline-none focus:border-accent-soft"/></div>
                        <div className="bg-surface-subtle p-4 rounded-2xl border border-slate-200/60"><label className="text-[11px] font-bold text-ink-muted uppercase block mb-2">{t("attOvertimeMultiplier")}</label><input type="number" step="0.1" required value={settingsModal.overtimeMultiplier} onChange={e => setSettingsModal({...settingsModal, overtimeMultiplier: Number(e.target.value)})} className="w-full px-4 py-3 bg-surface rounded-xl border border-line font-black outline-none focus:border-accent-soft"/></div>
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-ink-muted uppercase mb-3 block">{t("attWeeklyRoster")}</label>
                        <div className="space-y-3">
                            {DAYS_OF_WEEK.map((dayName, idx) => {
                                const dayConfig = settingsModal.schedule[idx] || { active: false, start: "09:00", end: "17:00" };
                                return (
                                    <div key={idx} className={`flex justify-between p-3 rounded-xl border transition-all ${dayConfig.active ? 'bg-surface border-accent-soft' : 'bg-surface-subtle border-slate-200/50 opacity-60'}`}>
                                        <div className="flex items-center gap-3 w-1/3">
                                            <input type="checkbox" checked={dayConfig.active} onChange={(e) => setSettingsModal({...settingsModal, schedule: { ...settingsModal.schedule, [idx]: { ...dayConfig, active: e.target.checked } }})} className="w-4 h-4 cursor-pointer"/>
                                            <span className="font-bold text-sm">{t(DAY_KEYS[dayName])}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input type="time" disabled={!dayConfig.active} value={dayConfig.start} onChange={(e) => setSettingsModal({...settingsModal, schedule: { ...settingsModal.schedule, [idx]: { ...dayConfig, start: e.target.value } }})} className="px-3 py-2 bg-surface-subtle border rounded-lg text-sm font-bold"/>
                                            <span className="text-xs font-bold text-slate-400">to</span>
                                            <input type="time" disabled={!dayConfig.active} value={dayConfig.end} onChange={(e) => setSettingsModal({...settingsModal, schedule: { ...settingsModal.schedule, [idx]: { ...dayConfig, end: e.target.value } }})} className="px-3 py-2 bg-surface-subtle border rounded-lg text-sm font-bold"/>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <button type="submit" className="w-full bg-accent text-ink-on-accent py-4 rounded-xl font-bold text-sm shadow-md active:scale-95 flex justify-center gap-2"><Save size={18}/> {t("save")}</button>
                </form>
            </div>
        </div>
    </div>
  );
};