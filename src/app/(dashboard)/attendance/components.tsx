"use client";

import { useState } from "react";
import { 
  MapPin, LogIn, LogOut, CheckCircle2, Hourglass,
  Users, TrendingUp, TrendingDown, Filter, Settings2, Trash2, 
  X, Save, DollarSign, Smartphone, ShieldAlert, Lock, FileText, Edit2, History
} from "lucide-react";
import { Timestamp } from "firebase/firestore";

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

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ==========================================
// 1. PERSONAL WORKSHEET COMPONENT
// ==========================================
export const PersonalWorksheet = ({ 
    activeSession, isDeviceBlocked, isDeviceMismatch, liveDuration, actionLoading, handlePunch, 
    myCalculatedStats, personalLogs, myProfile, language
}: any) => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in slide-in-from-bottom-4">
        {/* LEFT COLUMN: Terminal & Earnings */}
        <div className="lg:col-span-4 space-y-6">
            <div className="bg-surface rounded-[2.5rem] p-8 shadow-lg border border-line flex flex-col items-center text-center relative overflow-hidden">
                {isDeviceBlocked ? (
                    <div className="flex flex-col items-center justify-center py-6">
                        <div className="w-24 h-24 rounded-full bg-red-50 text-red-500 border-4 border-red-100 flex items-center justify-center mb-6"><Lock size={40}/></div>
                        <h2 className="text-xl font-black text-ink mb-2">Device Blocked</h2>
                        <p className="text-sm font-bold text-ink-muted px-2 leading-relaxed">This phone is not your registered clock-in device. Ask Admin to unlink your device in Team → Settings, then clock in again here.</p>
                    </div>
                ) : (
                    <>
                        {activeSession && <div className="absolute top-0 left-0 right-0 h-2 bg-emerald-500 animate-pulse"></div>}
                        <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-inner border-4 ${activeSession ? 'bg-emerald-50 border-emerald-100 text-emerald-500' : 'bg-surface-subtle border-slate-100 text-slate-400'}`}>
                            {activeSession ? <Hourglass size={40} className="animate-pulse"/> : <MapPin size={40}/>}
                        </div>
                        <h2 className="text-2xl font-black text-ink mb-1">{activeSession ? 'Shift in Progress' : 'Ready to Work?'}</h2>
                        <p className="text-sm font-semibold text-ink-muted mb-8 px-4">{activeSession ? "Clock out when you leave — you must be at the clinic (GPS)." : "Ensure you are inside the clinic to securely clock in."}</p>

                        {isDeviceMismatch && activeSession && (
                            <div className="mb-4 w-full flex items-start gap-2 text-left bg-amber-50 text-amber-800 p-3 rounded-xl border border-amber-100 text-xs font-semibold leading-relaxed">
                                <ShieldAlert size={16} className="shrink-0 mt-0.5"/>
                                Device link changed on this browser — you can clock out now. Ask Admin to unlink your device before your next clock-in on this phone.
                            </div>
                        )}

                        {activeSession && (
                            <div className="mb-8 w-full bg-surface-subtle border border-slate-100 rounded-2xl p-4">
                                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Current Session</p>
                                <p className="text-3xl font-black text-emerald-600 tabular-nums">{liveDuration || "0h 0m 0s"}</p>
                            </div>
                        )}

                        {activeSession ? (
                            <button onClick={() => handlePunch('out')} disabled={actionLoading} className="w-full bg-red-500 hover:bg-red-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-all flex justify-center items-center gap-3 disabled:opacity-50">
                                <LogOut size={24}/> Clock Out
                            </button>
                        ) : (
                            <button onClick={() => handlePunch('in')} disabled={actionLoading} className="w-full bg-slate-900 hover:bg-slate-800 text-white py-4 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all flex justify-center items-center gap-3 disabled:opacity-50">
                                <LogIn size={24}/> Clock In
                            </button>
                        )}

                        {myProfile && !myProfile.registeredDeviceId && !activeSession && (
                            <div className="mt-4 flex items-start gap-2 text-left bg-accent-tint text-accent-strong p-3 rounded-xl border border-accent-soft text-xs font-semibold leading-relaxed">
                                <ShieldAlert size={16} className="shrink-0 mt-0.5"/> This device will be registered as your clock-in device when you punch in.
                            </div>
                        )}
                    </>
                )}
            </div>

            {myCalculatedStats && (
                <div className="bg-slate-900 rounded-[2rem] p-6 shadow-xl border border-slate-800 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-accent-soft rounded-full blur-[50px] opacity-20 pointer-events-none"></div>
                    <div className="flex items-center justify-between mb-6 relative z-10">
                        <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs flex items-center gap-2"><DollarSign size={16}/> This Month's Earnings</h3>
                    </div>
                    <div className="space-y-4 relative z-10">
                        <div>
                            <p className="text-4xl font-black text-white tabular-nums tracking-tight">{Math.floor(myCalculatedStats.finalTotalPay).toLocaleString()} <span className="text-lg text-slate-500 font-bold">EGP</span></p>
                            <p className="text-xs font-medium text-emerald-400 mt-1 flex items-center gap-1"><TrendingUp size={12}/> Automatically calculated.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800/50">
                            <div><p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Base Pay</p><p className="font-bold text-sm text-slate-200">{Math.floor(myCalculatedStats.estimatedBasePay)} EGP</p></div>
                            <div><p className="text-[10px] text-ink-muted font-bold uppercase tracking-wider mb-1">Commissions</p><p className="font-bold text-sm text-emerald-400">+{Math.floor(myCalculatedStats.earnedCommissions)} EGP</p></div>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* RIGHT COLUMN: Table */}
        <div className="lg:col-span-8">
            <div className="bg-surface rounded-[2rem] border border-line shadow-sm overflow-hidden flex flex-col h-full min-h-[500px]">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div><h3 className="font-black text-ink text-lg">My Time Logs</h3><p className="text-xs font-semibold text-ink-muted">History of your check-ins.</p></div>
                </div>
                <div className="overflow-x-auto flex-1">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50/50 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                            <tr><th className="p-4 pl-6">Date</th><th className="p-4 text-center">Clock In</th><th className="p-4 text-center">Clock Out</th><th className="p-4 text-center">Total Time</th><th className="p-4 pr-6 text-right">Status</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {personalLogs.length === 0 ? (
                                <tr><td colSpan={5} className="p-12 text-center text-slate-400 font-bold text-sm">No records found.</td></tr>
                            ) : (
                                personalLogs.map((log: any) => (
                                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-4 pl-6 font-bold text-ink">{log.date || (log.checkIn && log.checkIn.toDate().toISOString().split('T')[0])}</td>
                                        <td className="p-4 font-bold text-ink-body text-center">{formatTime(log.checkIn)}</td>
                                        <td className="p-4 font-bold text-ink-body text-center">{formatTime(log.checkOut)}</td>
                                        <td className="p-4 font-black text-ink text-center">{log.status === 'active' ? <span className="text-emerald-500 animate-pulse">In Progress</span> : formatDuration(log.durationMinutes)}</td>
                                        <td className="p-4 pr-6 text-right">
                                            {log.status === 'active' ? <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border border-emerald-100">Active</span> : <span className="inline-flex items-center gap-1.5 bg-surface-muted text-ink-muted px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest"><CheckCircle2 size={12}/> Logged</span>}
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

// ==========================================
// 2. TEAM OVERVIEW COMPONENT
// ==========================================
export const TeamOverview = ({ 
    startDate, endDate, setStartDate, setEndDate, filterRole, setFilterRole, 
    filterUser, setFilterUser, allStaff, payrollData, handleGeneratePayrollPDF, 
    handleGenerateCommissionPDF, openSettingsModal, openLogsModal, commissionBreakdownRows, handleUpdateCommissionEntry
}: any) => (
    <div className="space-y-8 animate-in slide-in-from-bottom-4">
        {/* ADMIN FILTER BAR */}
        <div className="bg-surface p-5 rounded-[2rem] border border-line shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-2"><Filter size={20} className="text-accent" /><h3 className="font-black text-ink">Payroll Engine</h3></div>
                <div className="flex flex-col xl:flex-row items-center gap-3 w-full lg:w-auto">
                <select value={filterRole} onChange={e => setFilterRole(e.target.value)} className="w-full sm:w-auto bg-surface-subtle border border-line text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold outline-none cursor-pointer">
                    <option value="all">All Roles</option><option value="Dentist">Dentists</option><option value="Assistant">Assistants</option><option value="Receptionist">Receptionists</option>
                </select>
                <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="w-full sm:w-auto bg-surface-subtle border border-line text-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold outline-none cursor-pointer max-w-[200px] truncate">
                    <option value="all">All Staff</option>
                    {allStaff.filter((s: any) => filterRole === 'all' || s.role === filterRole).map((s: any) => (
                        <option key={s.id} value={s.uid || s.id}>{s.name}</option>
                    ))}
                </select>
            </div>
        </div>

        {/* PAYROLL SUMMARY TABLE */}
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50/50">
                <div><h3 className="font-black text-slate-900 text-lg">Final Payroll Report</h3><p className="text-xs font-semibold text-slate-500">Automatically combines Base Salary (hours) + Ledger Commissions.</p></div>
                <button onClick={handleGeneratePayrollPDF} className="bg-accent-soft text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-md hover:bg-accent transition-all shrink-0 active:scale-95">
                    <FileText size={16}/> Generate Payroll PDF
                </button>
            </div>
            
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[900px]">
                    <thead className="bg-slate-50/50 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                        <tr>
                            <th className="p-4 pl-6 whitespace-nowrap">Staff Member</th>
                            <th className="p-4 whitespace-nowrap text-center">Settings & Logs</th>
                            <th className="p-4 whitespace-nowrap text-right">Reg / Missed</th>
                            <th className="p-4 whitespace-nowrap text-right">Apprv / Pend OT</th>
                            <th className="p-4 whitespace-nowrap text-right">Base Pay</th>
                            <th className="p-4 whitespace-nowrap text-right">Commissions</th>
                            <th className="p-4 pr-6 whitespace-nowrap text-right text-emerald-600">Net Payout</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {payrollData.length === 0 ? (
                            <tr><td colSpan={6} className="p-12 text-center text-slate-400 font-bold text-sm">No payroll data matches filters.</td></tr>
                        ) : (
                            payrollData.map((staff: any, idx: number) => (
                                <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-4 pl-6">
                                        {/* NEW: LIVE INDICATOR */}
                                        <div className="flex items-center gap-2">
                                            <p className="font-black text-ink flex items-center gap-2">
                                                {staff.name}
                                                {staff.activeNow && (
                                                    <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border border-emerald-200 shadow-sm animate-in fade-in">
                                                        <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span></span>
                                                        Live In Clinic
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{staff.role}</p>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center justify-center gap-2">
                                            <button onClick={() => openSettingsModal(staff)} className={`flex items-center justify-center gap-1.5 bg-surface border px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm ${staff.registeredDeviceId ? 'border-line text-ink-body hover:text-accent hover:border-accent-soft' : 'border-orange-200 text-orange-600 hover:bg-orange-50'}`}>
                                                <Settings2 size={14}/> {Math.floor(staff.expectedMonthlyHours)}h | {staff.commissionPercentage}%
                                            </button>
                                            {/* NEW: VIEW LOGS BUTTON */}
                                            <button onClick={() => openLogsModal(staff)} className="flex items-center justify-center gap-1.5 bg-surface border border-line px-2.5 py-1.5 rounded-lg text-xs font-bold text-ink-body hover:text-accent hover:border-accent-soft transition-all shadow-sm">
                                                <History size={14}/> Logs
                                            </button>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <p className="font-black text-ink-body">{formatDuration(staff.regularMinutes)}</p>
                                        {staff.missingMinutes > 0 && <p className="text-[10px] font-bold text-red-500">-{formatDuration(staff.missingMinutes)}</p>}
                                    </td>
                                    <td className="p-4 text-right">
                                        <p className="font-black text-accent">{formatDuration(staff.approvedOvertimeMinutes)}</p>
                                        {staff.pendingOvertimeMinutes > 0 && <p className="text-[10px] font-bold text-amber-500">Pend: {formatDuration(staff.pendingOvertimeMinutes)}</p>}
                                    </td>
                                    <td className="p-4 text-right font-bold text-ink-muted">{Math.floor(staff.estimatedBasePay).toLocaleString()}</td>
                                    <td className="p-4 text-right">
                                        {staff.earnedCommissions > 0 ? <span className="text-accent font-bold flex items-center justify-end gap-1"><TrendingUp size={14}/> {Math.floor(staff.earnedCommissions).toLocaleString()}</span> : <span className="text-slate-300">-</span>}
                                    </td>
                                    <td className="p-4 pr-6 text-right font-black text-emerald-600 text-lg tracking-tight">{Math.floor(staff.finalTotalPay).toLocaleString()}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>

        {/* COMMISSION BREAKDOWN TABLE */}
        <div className="bg-surface rounded-[2rem] border border-line shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50/50">
                <div>
                    <h3 className="font-black text-ink text-lg">Commission Breakdown Engine</h3>
                    <p className="text-xs font-semibold text-ink-muted">
                        Shows exactly where commission comes from (patient + service). Editing % recalculates doctor share and clinic profit in ledger.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[11px] font-black uppercase tracking-widest text-accent bg-accent-tint border border-accent-soft px-3 py-1.5 rounded-xl">
                        {commissionBreakdownRows.length} entries
                    </span>
                    <button onClick={handleGenerateCommissionPDF} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-md hover:bg-indigo-700 transition-all shrink-0 active:scale-95">
                        <FileText size={16}/> Export PDF
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[1200px]">
                    <thead className="bg-slate-50/50 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                        <tr>
                            <th className="p-4 pl-6 whitespace-nowrap">Date</th>
                            <th className="p-4 whitespace-nowrap">Doctor</th>
                            <th className="p-4 whitespace-nowrap">Patient</th>
                            <th className="p-4 whitespace-nowrap">Service Source</th>
                            <th className="p-4 whitespace-nowrap text-right">Payment</th>
                            <th className="p-4 whitespace-nowrap text-right">Lab Fee</th>
                            <th className="p-4 whitespace-nowrap text-right">Net</th>
                            <th className="p-4 whitespace-nowrap text-center">% Split</th>
                            <th className="p-4 whitespace-nowrap text-right text-accent">Doctor Comm.</th>
                            <th className="p-4 pr-6 whitespace-nowrap text-right text-emerald-600">Clinic Profit</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {commissionBreakdownRows.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="p-12 text-center text-slate-400 font-bold text-sm">
                                    No commission-bearing payment entries found in selected period.
                                </td>
                            </tr>
                        ) : (
                            commissionBreakdownRows.map((row: any) => (
                                <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="p-4 pl-6 font-bold text-ink tabular-nums">{row.date || "—"}</td>
                                    <td className="p-4">
                                        <p className="font-black text-ink">{row.staffName}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{row.staffRole}</p>
                                    </td>
                                    <td className="p-4 font-bold text-slate-700">{row.patientName || "—"}</td>
                                    <td className="p-4">
                                        <p className="font-bold text-slate-700 max-w-[320px] truncate" title={row.serviceSource || row.procedureDescription || row.description || "—"}>
                                            {row.serviceSource || row.procedureDescription || row.description || "—"}
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            {row.procedureId ? `Procedure: ${row.procedureId}` : "Ledger"} · {row.id}
                                        </p>
                                    </td>
                                    <td className="p-4 text-right font-black text-ink tabular-nums">
                                        {Math.floor(Number(row.paidAmount || 0)).toLocaleString()}
                                    </td>
                                    <td className="p-4 text-right font-bold text-ink-muted tabular-nums">
                                        {Math.floor(Number(row.labFee || 0)).toLocaleString()}
                                    </td>
                                    <td className="p-4 text-right font-bold text-ink-body tabular-nums">
                                        {Math.floor(Number(row.netAmount || 0)).toLocaleString()}
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="inline-flex items-center gap-2 bg-surface border border-line rounded-xl px-2 py-1.5 shadow-sm">
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
                                                className="w-20 text-center font-black text-slate-800 bg-transparent outline-none"
                                            />
                                            <span className="text-xs font-black text-ink-muted">%</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right font-black text-accent tabular-nums">
                                        {Math.floor(Number(row.doctorCommissionAmount || 0)).toLocaleString()}
                                    </td>
                                    <td className="p-4 pr-6 text-right font-black text-emerald-600 tabular-nums">
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

// ==========================================
// 3. EDIT STAFF LOGS MODAL (NEW)
// ==========================================
export const StaffLogsModal = ({ isOpen, onClose, staffName, logs, handleUpdateLog, handleDeleteLog, handleOvertimeDecision }: any) => {
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
                        <h2 className="text-lg font-black text-slate-900">{staffName}'s Logs</h2>
                        <p className="text-xs font-semibold text-ink-muted mt-0.5">Edit forgotten logouts or correct times.</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-surface rounded-full text-slate-400 hover:text-red-500 border border-line shadow-sm"><X size={16}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    <div className="space-y-3">
                        {logs.length === 0 ? <p className="text-center text-slate-400 font-bold py-10">No logs found in this period.</p> : null}
                        {logs.map((log: any) => (
                            <div key={log.id} className={`p-4 rounded-2xl border bg-surface shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${log.status === 'active' ? 'border-emerald-200 ring-1 ring-emerald-500/10' : 'border-line'}`}>
                                
                                {editingLogId === log.id ? (
                                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Check In</label>
                                            <input type="datetime-local" value={editIn} onChange={e=>setEditIn(e.target.value)} className="w-full text-xs font-bold p-2 border rounded-lg focus:border-accent-soft outline-none bg-surface-subtle" />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Check Out (Leave blank if Active)</label>
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
                                                {log.status === 'active' && <span className="ml-2 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Active</span>}
                                            </p>
                                            <div className="text-xs font-semibold text-ink-muted mt-1 flex items-center gap-2 flex-wrap">
                                                <span>In: {formatTime(log.checkIn)}</span> <span className="text-slate-300">•</span> <span>Out: {formatTime(log.checkOut)}</span> 
                                                <span className="text-slate-300">•</span> <span className="text-slate-700 font-bold">{formatDuration(log.durationMinutes)}</span>
                                            </div>
                                            {log.status === 'completed' && log.durationMinutes > 0 && (
                                                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100 w-full">
                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overtime:</span>
                                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${log.overtimeStatus === 'approved' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : log.overtimeStatus === 'rejected' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                                                        {log.overtimeStatus || 'Pending'}
                                                    </span>
                                                    <div className="flex gap-1 ml-auto">
                                                        {log.overtimeStatus !== 'approved' && <button onClick={() => handleOvertimeDecision(log.id, 'approved')} className="text-[10px] bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:scale-105 active:scale-95 px-2 py-1 rounded font-bold transition-all shadow-sm">Approve</button>}
                                                        {log.overtimeStatus !== 'rejected' && <button onClick={() => handleOvertimeDecision(log.id, 'rejected')} className="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 hover:scale-105 active:scale-95 px-2 py-1 rounded font-bold transition-all shadow-sm">Reject</button>}
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
                                            <button onClick={() => setEditingLogId(null)} className="bg-white border border-slate-200 text-slate-600 p-2 rounded-lg font-bold text-xs shadow-sm">Cancel</button>
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
export const StaffSettingsModal = ({ settingsModal, setSettingsModal, handleUpdateStaffSettings, handleUnlinkDevice }: any) => (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
        <div className="bg-white rounded-[2rem] p-8 w-full max-w-2xl shadow-2xl animate-in zoom-in-95 border border-slate-100 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6 shrink-0">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Shift & Pay Settings</h2>
                    <p className="text-xs font-semibold text-ink-muted mt-1">Configure {settingsModal.name}'s rules.</p>
                </div>
                <button onClick={() => setSettingsModal({isOpen: false, staffId: "", name: "", baseSalary: 0, commissionPercentage: 0, registeredDeviceId: null, overtimeMultiplier: 1.5, schedule: []})} className="text-slate-400 hover:text-red-500 bg-surface-subtle hover:bg-red-50 p-2 rounded-full transition-colors"><X size={20}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-orange-900 text-sm flex items-center gap-2"><Smartphone size={16}/> Device Security</h4>
                        <p className="text-xs font-medium text-orange-800 mt-1">{settingsModal.registeredDeviceId ? "This user is locked to a specific phone." : "This user has not linked a phone yet."}</p>
                    </div>
                    {settingsModal.registeredDeviceId && (
                        <button type="button" onClick={handleUnlinkDevice} className="bg-surface border border-orange-200 text-orange-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-orange-100 transition-all shadow-sm">Reset Link</button>
                    )}
                </div>

                <form onSubmit={handleUpdateStaffSettings} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-surface-subtle p-4 rounded-2xl border border-slate-200/60"><label className="text-[11px] font-bold text-ink-muted uppercase block mb-2">Monthly Base Salary (EGP)</label><input type="number" required value={settingsModal.baseSalary} onChange={e => setSettingsModal({...settingsModal, baseSalary: Number(e.target.value)})} className="w-full px-4 py-3 bg-surface rounded-xl border border-line font-black outline-none focus:border-accent-soft"/></div>
                        <div className="bg-accent-tint p-4 rounded-2xl border border-accent-soft"><label className="text-[11px] font-bold text-accent uppercase block mb-2">Commission (%)</label><input type="number" required value={settingsModal.commissionPercentage} onChange={e => setSettingsModal({...settingsModal, commissionPercentage: Number(e.target.value)})} className="w-full px-4 py-3 bg-surface rounded-xl border border-accent-soft font-black text-accent-strong outline-none focus:border-accent-soft"/></div>
                        <div className="bg-surface-subtle p-4 rounded-2xl border border-slate-200/60"><label className="text-[11px] font-bold text-ink-muted uppercase block mb-2">Overtime Multiplier</label><input type="number" step="0.1" required value={settingsModal.overtimeMultiplier} onChange={e => setSettingsModal({...settingsModal, overtimeMultiplier: Number(e.target.value)})} className="w-full px-4 py-3 bg-surface rounded-xl border border-line font-black outline-none focus:border-accent-soft"/></div>
                    </div>
                    <div>
                        <label className="text-[11px] font-bold text-ink-muted uppercase mb-3 block">Weekly Shift Roster</label>
                        <div className="space-y-3">
                            {DAYS_OF_WEEK.map((dayName, idx) => {
                                const dayConfig = settingsModal.schedule[idx] || { active: false, start: "09:00", end: "17:00" };
                                return (
                                    <div key={idx} className={`flex justify-between p-3 rounded-xl border transition-all ${dayConfig.active ? 'bg-surface border-accent-soft' : 'bg-surface-subtle border-slate-200/50 opacity-60'}`}>
                                        <div className="flex items-center gap-3 w-1/3">
                                            <input type="checkbox" checked={dayConfig.active} onChange={(e) => setSettingsModal({...settingsModal, schedule: { ...settingsModal.schedule, [idx]: { ...dayConfig, active: e.target.checked } }})} className="w-4 h-4 cursor-pointer"/>
                                            <span className="font-bold text-sm">{dayName}</span>
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
                    <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm shadow-md active:scale-95 flex justify-center gap-2"><Save size={18}/> Save Settings</button>
                </form>
            </div>
        </div>
    </div>
);