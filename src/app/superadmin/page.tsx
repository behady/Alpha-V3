"use client";

// Super Admin Platform Control Center (Updated with Manual Pricing)
import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { query, getDocs, updateDoc, doc, deleteDoc, onSnapshot, collection } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { Clinic, SubscriptionTier } from "@/types/saas";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { ShieldCheck, Search, Loader2, Check, X, Building2, BarChart3, Users, MoreVertical, RefreshCcw, Trash2, ExternalLink, Megaphone, HardDriveDownload } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { KpiStrip } from "@/components/superadmin/KpiStrip";
import { ClinicDetailPanel } from "@/components/superadmin/ClinicDetailPanel";
import { AnalyticsTab } from "@/components/superadmin/AnalyticsTab";
import { UsersTab } from "@/components/superadmin/UsersTab";
import { MetaTab } from "@/components/superadmin/MetaTab";
import { MigrateTab } from "@/components/superadmin/MigrateTab";

// Tabs
type Tab = 'clinics' | 'analytics' | 'users' | 'meta' | 'migrate';

interface RichClinic extends Clinic {
  ownerEmail?: string;
  daysRemaining?: number;
}

export default function SuperAdminDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { showToast, confirm } = useUI();
  
  const [clinics, setClinics] = useState<RichClinic[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>('clinics');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user?.isSuperAdmin) {
        showToast("Access denied — super admins only.", "error");
        router.push("/");
        return;
      }
      document.title = "Super Admin Hub — Alpha Dental SaaS";
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || !user?.isSuperAdmin) return;
    
    setLoadingClinics(true);
    const q = query(getClinicCollection("clinics"));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const fetched: RichClinic[] = [];
      const ownerIds = new Set<string>();
      
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Clinic;
        let daysRemaining = undefined;
        if (data.expiresAt) {
          const expDate = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
          const diffTime = expDate.getTime() - new Date().getTime();
          daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        fetched.push({ ...data, id: docSnap.id, daysRemaining });
        if (data.ownerId) ownerIds.add(data.ownerId);
      });

      // Fetch owner emails and all users
      const ownerEmails: Record<string, string> = {};
      const usersData: any[] = [];
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach((userDoc) => {
          const uData = { id: userDoc.id, ...userDoc.data() } as any;
          usersData.push(uData);
          if (ownerIds.has(userDoc.id)) {
            ownerEmails[userDoc.id] = uData.email || 'No email';
          }
        });
        
        setAllUsers(usersData);
        fetched.forEach(c => {
          if (c.ownerId && ownerEmails[c.ownerId]) {
            c.ownerEmail = ownerEmails[c.ownerId];
          }
        });
      } catch (e) {
        console.error("Error fetching owners", e);
      }
      
      setClinics(fetched);
      setLoadingClinics(false);
    }, (error) => {
      console.error("Error listening to clinics", error);
      showToast("Failed to listen to clinics.", "error");
      setLoadingClinics(false);
    });
    
    return () => unsubscribe();
  }, [user, loading]);

  const handleUpdateTier = async (clinicId: string, newTier: SubscriptionTier) => {
    try {
      await updateDoc(getClinicDoc("clinics", clinicId), { subscriptionTier: newTier });
      showToast(`Updated tier to ${newTier}`, "success");
    } catch (err) {
      showToast("Error updating tier", "error");
    }
  };

  const handleUpdateStatus = async (clinicId: string, newStatus: 'Active' | 'Suspended' | 'Expired') => {
    try {
      await updateDoc(getClinicDoc("clinics", clinicId), { status: newStatus });
      showToast(`Updated status to ${newStatus}`, "success");
    } catch (err) {
      showToast("Error updating status", "error");
    }
  };

  const handleUpdateClinic = async (clinicId: string, updates: Partial<Clinic>) => {
    try {
      await updateDoc(getClinicDoc("clinics", clinicId), updates);
      showToast("Clinic updated successfully", "success");
    } catch (err) {
      showToast("Error updating clinic", "error");
    }
  };

  /**
   * Deliberately NOT routed through the recycle bin, and the copy is honest about what it does.
   *
   * This removes the clinic's own document. Everything under it — every patient, ledger row, note
   * and image — survives untouched in the subtree, so "completely delete" and "cannot be undone"
   * were both wrong: nothing is completely deleted, and re-creating the document reattaches the
   * lot. The bin cannot help either, because `clinics` is a root collection: a snapshot filed
   * under the clinic being deleted would be unreachable, and one filed at the root would restore a
   * document that instantly re-grants access to everyone still holding a role for it.
   *
   * The real fix is a soft delete (set status away from Active — isClinicActive and the read-only
   * banner already key off it) followed by an explicit purge that walks the subtree. Until that
   * exists, this stays as it is and says what it actually does.
   */
  const handleDeleteClinic = async (clinicId: string, name: string) => {
    if (
      await confirm(
        `Delete the clinic record for "${name}"? Its patients, ledger and notes are NOT deleted — they remain in the database and reappear if the record is recreated.`
      )
    ) {
      try {
        await deleteDoc(getClinicDoc("clinics", clinicId));
        showToast("Clinic record deleted (clinic data retained)", "success");
      } catch (err) {
        showToast("Error deleting clinic", "error");
      }
    }
  };

  const handleToggleSuperAdmin = async (userId: string, currentStatus: boolean, userName: string) => {
    if (await confirm(`Are you sure you want to ${currentStatus ? 'revoke' : 'grant'} Super Admin access for ${userName}?`)) {
      try {
        await updateDoc(doc(db, "users", userId), { isSuperAdmin: !currentStatus });
        showToast(`Super Admin access ${currentStatus ? 'revoked' : 'granted'}`, "success");
        setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, isSuperAdmin: !currentStatus } : u));
      } catch (err) {
        showToast("Error updating user", "error");
      }
    }
  };

  const filteredClinics = clinics.filter(c => 
    c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.id.includes(searchQuery) ||
    c.ownerEmail?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#E8F0ED]"><Loader2 className="animate-spin text-slate-500" size={32} /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-slate-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center shrink-0">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">Super Admin Hub</h1>
              <p className="text-xs font-semibold text-slate-400 mt-1">Platform Control Center</p>
            </div>
          </div>
          <div className="flex bg-slate-800 p-1 rounded-xl">
            <button onClick={() => setActiveTab('clinics')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'clinics' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Building2 size={16} /> Clinics
            </button>
            <button onClick={() => setActiveTab('analytics')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'analytics' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              <BarChart3 size={16} /> Analytics
            </button>
            <button onClick={() => setActiveTab('users')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'users' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Users size={16} /> Users
            </button>
            <button onClick={() => setActiveTab('meta')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'meta' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Megaphone size={16} /> Meta Leads
            </button>
            <button onClick={() => setActiveTab('migrate')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'migrate' ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              <HardDriveDownload size={16} /> Migrate
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
        {activeTab === 'clinics' && (
          <>
            <KpiStrip clinics={clinics} />

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200/60 shadow-sm">
              <div className="w-full md:w-96 relative">
                 <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                 <input 
                   type="search" 
                   placeholder="Search by name, ID, or owner email..." 
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-11 pr-4 text-sm font-bold text-slate-800 outline-none focus:border-indigo-500 transition-all"
                 />
              </div>
              <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold text-sm transition-colors">
                <RefreshCcw size={16} /> Refresh
              </button>
            </div>

            {/* Clinics List */}
            <div className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm overflow-hidden">
              {loadingClinics ? (
                <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-slate-400" size={32} /></div>
              ) : filteredClinics.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="w-20 h-20 bg-slate-100 text-slate-300 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Search size={32} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700">No clinics found</h3>
                  <p className="text-slate-500 text-sm mt-1">Try adjusting your search query.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-xs font-black text-slate-400 uppercase tracking-widest">
                        <th className="px-6 py-4">Clinic Info</th>
                        <th className="px-6 py-4">Owner</th>
                        <th className="px-6 py-4">Status & Tier</th>
                        <th className="px-6 py-4">Expiry</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredClinics.map((clinic) => (
                        <tr key={clinic.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center font-bold text-indigo-600 shrink-0">
                                {clinic.name?.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900">{clinic.name}</p>
                                <p className="text-xs font-mono text-slate-400 mt-0.5" title={clinic.id}>{clinic.id.slice(0, 8)}...</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-semibold text-slate-700">{clinic.ownerEmail || 'Unknown'}</p>
                            {clinic.createdAt && (
                              <p className="text-xs text-slate-400 mt-0.5">Joined: {new Date(clinic.createdAt.toDate ? clinic.createdAt.toDate() : clinic.createdAt).toLocaleDateString()}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-2 items-start">
                              <select
                                value={clinic.status}
                                onChange={(e) => handleUpdateStatus(clinic.id, e.target.value as any)}
                                className={`text-xs font-bold px-2.5 py-1 rounded-lg outline-none cursor-pointer border ${
                                  clinic.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 
                                  clinic.status === 'Suspended' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  'bg-rose-50 text-rose-700 border-rose-200'
                                }`}
                              >
                                <option value="Active">Active</option>
                                <option value="Suspended">Suspended</option>
                                <option value="Expired">Expired</option>
                              </select>
                              <select
                                value={clinic.subscriptionTier}
                                onChange={(e) => handleUpdateTier(clinic.id, e.target.value as SubscriptionTier)}
                                className="bg-slate-100 text-slate-600 text-xs font-bold rounded-lg px-2.5 py-1 outline-none cursor-pointer border border-transparent hover:border-slate-300"
                              >
                                <option value="Free Trial">Free Trial</option>
                                <option value="Basic">Basic</option>
                                <option value="Pro">Pro</option>
                                <option value="Premium">Premium</option>
                              </select>
                              {clinic.customPrice !== undefined && clinic.customPrice > 0 && (
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                  ${clinic.customPrice} ({clinic.billingCycle || 'Monthly'})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {clinic.daysRemaining !== undefined ? (
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${
                                clinic.daysRemaining < 0 ? 'bg-rose-100 text-rose-700' :
                                clinic.daysRemaining <= 7 ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {clinic.daysRemaining < 0 
                                  ? `Expired ${Math.abs(clinic.daysRemaining)}d ago` 
                                  : `${clinic.daysRemaining} days left`}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">Not set</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              <a
                                href={`/?clinic=${clinic.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-100 w-8 h-8 rounded-lg transition-colors"
                                title="Open Clinic in New Tab"
                              >
                                <ExternalLink size={16} />
                              </a>
                              <button
                                onClick={() => setSelectedClinicId(clinic.id)}
                                className="inline-flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 w-8 h-8 rounded-lg transition-colors"
                                title="View Details"
                              >
                                <MoreVertical size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteClinic(clinic.id, clinic.name)}
                                className="inline-flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-100 w-8 h-8 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                title="Delete Clinic"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab clinics={clinics} />
        )}

        {activeTab === 'users' && (
          <UsersTab users={allUsers} onToggleSuperAdmin={handleToggleSuperAdmin} />
        )}

        {activeTab === 'meta' && <MetaTab />}

        {activeTab === 'migrate' && <MigrateTab clinics={clinics} />}

      </div>
      
      {/* Clinic Detail Panel overlay */}
      {selectedClinicId && (
        <>
          <div 
            className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 animate-in fade-in duration-200"
            onClick={() => setSelectedClinicId(null)}
          />
          <ClinicDetailPanel 
            clinic={clinics.find(c => c.id === selectedClinicId) || null}
            users={allUsers}
            onClose={() => setSelectedClinicId(null)}
            onUpdateClinic={handleUpdateClinic}
            onDeleteClinic={handleDeleteClinic}
          />
        </>
      )}
    </div>
  );
}
