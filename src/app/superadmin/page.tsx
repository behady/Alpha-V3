"use client";

// Super Admin Platform Control Center
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { auth, db } from "@/lib/firebase";
import { query, getDoc, getDocs, updateDoc, doc, onSnapshot, collection } from "firebase/firestore";
import { typedNameMatches } from "@/lib/clinicTrash";
import { useRouter } from "next/navigation";
import { Clinic, SubscriptionTier } from "@/types/saas";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { getAiCreditLimit } from "@/lib/subscriptions";
import { cairo } from "@/lib/fonts/arabic";
import { Loader2, RefreshCcw, Trash2 } from "lucide-react";
import { useUI } from "@/context/UIContext";
import { KpiStrip } from "@/components/superadmin/KpiStrip";
import { ClinicDetailPanel } from "@/components/superadmin/ClinicDetailPanel";
import { AttentionList } from "@/components/superadmin/AttentionList";
import { ClinicsTable, type BulkAction } from "@/components/superadmin/ClinicsTable";
import { SuperAdminNav, type SuperAdminTab } from "@/components/superadmin/SuperAdminNav";
import { daysUntil, extendedExpiry, tierChangeUpdate, type ConsoleClinic } from "@/components/superadmin/clinicMath";
import { useSuperAdminText, type SAKey } from "@/components/superadmin/i18n";
import { AnalyticsTab } from "@/components/superadmin/AnalyticsTab";
import { UsersTab } from "@/components/superadmin/UsersTab";
import { MetaTab } from "@/components/superadmin/MetaTab";
import { MigrateTab } from "@/components/superadmin/MigrateTab";
import MisplacedRecordsTab from "@/components/superadmin/MisplacedRecordsTab";
import { PlatformTab } from "@/components/superadmin/PlatformTab";
import { CostsTab } from "@/components/superadmin/CostsTab";
import SupplyStoreTab from "@/components/superadmin/SupplyStoreTab";
import { TourTab } from "@/components/superadmin/TourTab";

/** One row of the trash, as /api/admin/clinic-trash lists it. */
interface TrashedClinic {
  id: string;
  name: string;
  subscriptionTier: string | null;
  deletedAt: string | null;
  deletedByEmail: string | null;
  /** Staff whose access was taken with the clinic. Null: deleted before the trash did that. */
  members: number | null;
}

const TAB_TITLE: Record<SuperAdminTab, SAKey> = {
  clinics: "navClinics", users: "navUsers", costs: "navCosts", analytics: "navAnalytics", meta: "navMeta",
  supply: "navSupply", platform: "navPlatform", migrate: "navMigrate", misplaced: "navAudit", tour: "navTour",
};

export default function SuperAdminDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { showToast, confirm, prompt } = useUI();
  const { t, num, date, isAr } = useSuperAdminText();

  const [clinics, setClinics] = useState<(Clinic & { ownerEmail?: string })[]>([]);
  const [aiUsage, setAiUsage] = useState<Record<string, number>>({});
  const [trash, setTrash] = useState<TrashedClinic[]>([]);

  /** Everything the trash does goes through the server; the browser never touches deleted_clinics. */
  const callClinicTrash = async (body: Record<string, string>): Promise<{ ok: boolean; error?: string }> => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return { ok: false, error: "Session expired. Sign in again." };
    const res = await fetch("/api/admin/clinic-trash", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data?.ok === true, error: data?.error };
  };

  const loadTrash = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch("/api/admin/clinic-trash", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && Array.isArray(data.items)) setTrash(data.items as TrashedClinic[]);
    } catch {
      // The list is a convenience; a failed load leaves the last one on screen.
    }
  }, []);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [activeTab, setActiveTab] = useState<SuperAdminTab>("clinics");
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user?.isSuperAdmin) {
        showToast("Access denied — super admins only.", "error");
        router.push("/");
        return;
      }
      document.title = "Super Admin — Alpha Dental";
      void loadTrash();
    }
  }, [user, loading, router, loadTrash]);

  useEffect(() => {
    if (loading || !user?.isSuperAdmin) return;

    setLoadingClinics(true);
    const q = query(getClinicCollection("clinics"));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const fetched: (Clinic & { ownerEmail?: string })[] = [];
      const ownerIds = new Set<string>();

      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Clinic;
        fetched.push({ ...data, id: docSnap.id });
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
          if (ownerIds.has(userDoc.id) && uData.email) ownerEmails[userDoc.id] = uData.email;
        });

        setAllUsers(usersData);
        fetched.forEach((c) => {
          if (c.ownerId && ownerEmails[c.ownerId]) c.ownerEmail = ownerEmails[c.ownerId];
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

  // This month's AI spend per clinic: one small doc each (clinics/{id}/ai_usage/{YYYY-MM}). Read
  // once per set of clinics rather than listened to — the console is not a live meter.
  const clinicIdsKey = clinics.map((c) => c.id).sort().join(",");
  useEffect(() => {
    if (!clinicIdsKey) return;
    const monthKey = new Date().toISOString().slice(0, 7);
    let cancelled = false;
    void Promise.all(
      clinicIdsKey.split(",").map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "clinics", id, "ai_usage", monthKey));
          return [id, snap.exists() ? Number(snap.data()?.creditsUsed) || 0 : 0] as const;
        } catch {
          return [id, 0] as const;
        }
      })
    ).then((pairs) => {
      if (!cancelled) setAiUsage(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [clinicIdsKey]);

  const consoleClinics: ConsoleClinic[] = useMemo(() => {
    const staffCount: Record<string, number> = {};
    for (const u of allUsers) for (const id of Object.keys(u.clinicRoles || {})) staffCount[id] = (staffCount[id] || 0) + 1;
    return clinics.map((c) => ({
      ...c,
      daysRemaining: daysUntil(c.expiresAt),
      staffCount: staffCount[c.id] || 0,
      aiUsed: aiUsage[c.id] || 0,
      aiLimit: getAiCreditLimit(c),
    }));
  }, [clinics, allUsers, aiUsage]);

  const handleUpdateClinic = async (clinicId: string, updates: Partial<Clinic>) => {
    try {
      await updateDoc(getClinicDoc("clinics", clinicId), updates);
      showToast(t("updated"), "success");
    } catch (err) {
      showToast(t("updateFailed"), "error");
    }
  };

  const tierName = (tier: SubscriptionTier) =>
    t(({ "Free Trial": "tierFree", Basic: "tierBasic", Pro: "tierPro", Premium: "tierPremium" } as const)[tier]);

  const handlePlanChange = async (clinic: ConsoleClinic, tier: SubscriptionTier) => {
    if (!(await confirm(t("planChangeQ", { name: clinic.name, plan: tierName(tier) }), { title: t("subscription"), confirmLabel: tierName(tier) }))) return;
    await handleUpdateClinic(clinic.id, tierChangeUpdate(clinic, tier));
  };

  const handleBulk = async (ids: string[], action: BulkAction) => {
    const targets = consoleClinics.filter((c) => ids.includes(c.id));
    if (!targets.length) return;
    if (action.kind === "status" && action.status === "Suspended") {
      if (!(await confirm(t("bulkSuspendQ", { n: num(targets.length) }), { title: t("bulkSuspend"), confirmLabel: t("bulkSuspend") }))) return;
    }
    if (action.kind === "plan") {
      if (!(await confirm(t("bulkPlanQ", { n: num(targets.length), plan: tierName(action.tier) }), { title: t("subscription"), confirmLabel: tierName(action.tier) }))) return;
    }
    const results = await Promise.allSettled(
      targets.map((c) => {
        const updates: Partial<Clinic> =
          action.kind === "extend" ? { expiresAt: extendedExpiry(c, action.days) }
          : action.kind === "plan" ? tierChangeUpdate(c, action.tier)
          : { status: action.status };
        return updateDoc(getClinicDoc("clinics", c.id), updates);
      })
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) showToast(t("bulkFailed", { n: num(failed) }), "error");
    else showToast(t("bulkDone", { n: num(targets.length) }), "success");
  };

  /**
   * Delete goes through /api/admin/clinic-trash, never deleteDoc from here.
   *
   * One click on this button once took a live clinic off the air: the header document went, every
   * staff login bounced, and the only way back was Firestore's point-in-time recovery inside its
   * seven-day window. The route now keeps a copy of the header in `deleted_clinics` in the same
   * transaction that removes it, and refuses unless the clinic's exact name was typed — the
   * server checks the name too, so the dialog is not the only guard.
   *
   * Everything under the clinic (patients, ledger, notes, images) is never touched by this. That
   * is why Restore below is instant: put the header back and it is all reachable again.
   */
  const handleDeleteClinic = async (clinicId: string, name: string) => {
    const typed = await prompt(
      `You are about to delete "${name}". Its staff will lose access immediately. Type the clinic's name exactly to continue.`,
      {
        title: "Delete clinic",
        placeholder: name,
        confirmLabel: "Delete",
        required: true,
      }
    );
    if (typed === null) return;
    if (!typedNameMatches(typed, name)) {
      showToast("The name you typed does not match. Nothing was deleted.", "error");
      return;
    }
    try {
      const res = await callClinicTrash({ action: "delete", clinicId, confirmName: typed });
      if (!res.ok) throw new Error(res.error);
      showToast(`"${name}" moved to Recently deleted. Restore it from the bottom of this page.`, "success");
      void loadTrash();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error deleting clinic", "error");
    }
  };

  const handleRestoreClinic = async (clinicId: string, name: string) => {
    if (!(await confirm(`Restore "${name}"? Its staff get access back immediately.`, { title: "Restore clinic", confirmLabel: "Restore" }))) return;
    try {
      const res = await callClinicTrash({ action: "restore", clinicId });
      if (!res.ok) throw new Error(res.error);
      showToast(`"${name}" is back.`, "success");
      void loadTrash();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error restoring clinic", "error");
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

  // The console's own face: Open Sans and Montserrat for Latin, Cairo for every Arabic letter —
  // in English too, since clinic names are often Arabic. In Arabic, Cairo leads.
  const fontCls = `${cairo.variable} superadmin-ui ${isAr ? "arabic-ui" : ""}`;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-page"><Loader2 className="animate-spin text-ink-muted" size={32} /></div>;
  }

  return (
    <div className={`min-h-[100dvh] bg-surface-page text-ink lg:flex ${fontCls}`}>
      <SuperAdminNav
        active={activeTab}
        onPick={setActiveTab}
        counts={{ clinics: clinics.length, users: allUsers.length }}
        email={user?.email}
      />

      <main className="flex-1 min-w-0 px-4 py-6 md:px-8 lg:px-10 lg:py-8 flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow")}</span>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-ink">{t(TAB_TITLE[activeTab])}</h1>
        </header>

        {activeTab === "clinics" && (
          <>
            <KpiStrip clinics={consoleClinics} />
            <AttentionList
              clinics={consoleClinics}
              onOpen={setSelectedClinicId}
              onExtend={(c, days) => handleUpdateClinic(c.id, { expiresAt: extendedExpiry(c, days) })}
              onAddCredits={(c, n) => handleUpdateClinic(c.id, { features: { ...(c.features || {}), extraAiCredits: (c.features?.extraAiCredits || 0) + n } })}
            />
            <ClinicsTable clinics={consoleClinics} loading={loadingClinics} onOpen={setSelectedClinicId} onBulk={handleBulk} />

            {/* Recently deleted — the header copies the delete route keeps. Restore puts one back. */}
            {trash.length > 0 && (
              <section className="bg-surface rounded-3xl border border-danger/25 overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex flex-col gap-1">
                  <h2 className="font-display text-base font-bold text-ink flex items-center gap-2">
                    <Trash2 size={16} className="text-danger" aria-hidden /> {t("trashTitle")}
                  </h2>
                  <p className="text-[13px] text-ink-muted">{t("trashSub")}</p>
                </div>
                <ul className="divide-y divide-line">
                  {trash.map((item) => (
                    <li key={item.id} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-6">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-ink truncate" dir="auto">{item.name}</p>
                        <p className="text-xs text-ink-muted font-mono truncate" dir="ltr">{item.id}</p>
                      </div>
                      <div className="text-xs text-ink-muted">
                        {item.subscriptionTier ? <span className="me-3">{item.subscriptionTier}</span> : null}
                        {item.deletedAt ? <span>{t("trashDeleted", { d: date(new Date(item.deletedAt)) })}</span> : null}
                        {item.deletedByEmail ? <span> {t("trashBy", { e: item.deletedByEmail })}</span> : null}
                        {item.members === null ? (
                          // Deleted before the trash took staff access with the clinic: its members
                          // can still sign into it. Restore and delete again to let them go.
                          <span className="block text-warn font-semibold mt-1">{t("trashStaffStill")}</span>
                        ) : item.members > 0 ? (
                          <span className="ms-3">{t("trashWaiting", { n: num(item.members) })}</span>
                        ) : null}
                      </div>
                      <button
                        onClick={() => handleRestoreClinic(item.id, item.name)}
                        className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-xl border border-line-strong bg-surface text-ink hover:bg-surface-subtle font-semibold text-sm"
                      >
                        <RefreshCcw size={14} aria-hidden /> {t("restore")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {/* Where Sara's tour loses people, across every clinic. */}
        {activeTab === "tour" && <DarkPanel><TourTab /></DarkPanel>}
        {/* Supplier invoices per clinic. Superadmin only — a clinic sees credits, never money. */}
        {activeTab === "costs" && <DarkPanel><CostsTab /></DarkPanel>}
        {activeTab === "analytics" && <AnalyticsTab clinics={clinics} />}
        {activeTab === "users" && <UsersTab users={allUsers} onToggleSuperAdmin={handleToggleSuperAdmin} />}
        {activeTab === "meta" && <MetaTab />}
        {activeTab === "supply" && <DarkPanel><SupplyStoreTab /></DarkPanel>}
        {activeTab === "migrate" && <MigrateTab clinics={clinics} />}
        {activeTab === "misplaced" && <DarkPanel><MisplacedRecordsTab /></DarkPanel>}
        {activeTab === "platform" && <PlatformTab />}
      </main>

      {selectedClinicId && (
        <>
          <div
            className="fixed inset-0 bg-ink-slab/30 backdrop-blur-sm z-40 animate-in fade-in duration-200"
            onClick={() => setSelectedClinicId(null)}
          />
          <ClinicDetailPanel
            key={selectedClinicId}
            clinic={consoleClinics.find((c) => c.id === selectedClinicId) || null}
            users={allUsers}
            onClose={() => setSelectedClinicId(null)}
            onUpdateClinic={handleUpdateClinic}
            onDeleteClinic={handleDeleteClinic}
            onPlanChange={handlePlanChange}
          />
        </>
      )}
    </div>
  );
}

/**
 * Costs, Supply store, Tour and Data audit were written in light-on-dark colours. On the light
 * console page their white text vanished, so they sit on the menu's own near-black slab instead.
 */
function DarkPanel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-ink-slab text-slate-200 p-4 md:p-6">{children}</div>;
}
