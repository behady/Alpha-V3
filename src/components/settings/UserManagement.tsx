"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Users, Shield, Trash2, AlertCircle, Plus, KeyRound, X, Save, Lock, Loader2, Search, ChevronDown, ChevronRight, Info, Stethoscope, Headset, HeartHandshake, Crown } from "lucide-react";
import { formatStaffRoleLabel, isDentistStaff } from "@/lib/staffRoles";
import { isFullAccessRole, isOwnerRole, rolePreset } from "@/lib/permissions";
import { useClinic } from "@/context/ClinicContext";
import { auth, db } from "@/lib/firebase";
import { doc, deleteDoc, getDoc } from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { logActivity } from "@/lib/logger";
import { PERMISSIONS_CATALOG, getAllPermissionIds, type PermissionCatalogGroup } from "@/config/permissionsCatalog";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import UserAccessModal from "./UserAccessModal";
import Protect from "@/components/Protect";
type StaffMember = { id: string; uid?: string; [k: string]: unknown };
type UserRow = {
  id: string;
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  isDentist?: boolean;
  staffId?: string;
  permissions?: string[];
};

type Props = {
  usersList: UserRow[];
  staffMembers: StaffMember[];
  currentUser: { uid?: string; name?: string; role?: string } | null;
  openAddUser: () => void;
  clinicId: string | null;
};

export default function UserManagement({ usersList, staffMembers, currentUser, openAddUser, clinicId }: Props) {
  const { showToast, confirm } = useUI();
  const { language, isRTL } = useLanguage();
  /**
   * Read from the clinic, not from the `currentUser` prop. That prop carries the legacy flat
   * `role` field, which is whichever clinic the account last touched — for someone who works at
   * two clinics it can name the wrong one, and "may this person hand the clinic over" is not a
   * question to answer from a stale field.
   */
  const { isOwner: viewerIsOwner } = useClinic();
  const isAr = language === "ar";
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [accessModalUser, setAccessModalUser] = useState<UserRow | null>(null);

  const [resetTarget, setResetTarget] = useState<{ uid: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const totalAssignable = getAllPermissionIds().length;

  /**
   * Give this clinic's founder the Owner role, once.
   *
   * Every clinic made before the role existed granted its founder `Admin` and recorded them in
   * `clinics/{id}.ownerId`, and nothing ever read the two together — so the person paying for the
   * clinic was indistinguishable from the locum Admin they invited for a fortnight. Done on open
   * rather than behind a button because the person who needs it is the one least likely to know
   * it exists. Idempotent: every visit after the first writes nothing and says nothing.
   */
  const ownerCheckRan = useRef(false);
  useEffect(() => {
    if (!clinicId || ownerCheckRan.current) return;
    ownerCheckRan.current = true;

    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch("/api/admin/ensure-owner", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ clinicId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.ok && data.promoted) {
          showToast(
            isAr ? "تم تعيين صاحب العيادة كمالك" : "The clinic's founder is now its Owner",
            "info"
          );
        }
      } catch {
        // Nothing to do. Owner adds protection, not access — a clinic that stays on Admin keeps
        // working exactly as it did, and the next visit tries again.
      }
    })();
  }, [clinicId, isAr, showToast]);

  const txt = {
    title: isAr ? "إدارة المستخدمين والموظفين" : "User & Staff Management",
    sub: isAr ? "إدارة عمليات تسجيل الدخول والأدوار والصلاحيات." : "Manage logins, roles, and granular permissions.",
    addBtn: isAr ? "إضافة عضو للفريق" : "Add Team Member",
    clinicIdTitle: isAr ? "معرّف العيادة" : "Clinic ID",
    clinicIdHelp: isAr
      ? "ابعت المعرّف ده لأي زميل عايز ينضم للعيادة. هيحطه في شاشة «انضم لعيادة موجودة» بعد ما يعمل حساب، وهيوصلك طلبه في تبويب «طلبات الانضمام»."
      : "Send this to a colleague who needs to join. They enter it on the \"Join an existing clinic\" screen after creating an account, and their request lands in the Join Requests tab.",
    clinicIdCopy: isAr ? "نسخ" : "Copy",
    clinicIdCopied: isAr ? "تم نسخ معرّف العيادة" : "Clinic ID copied",
    clinicIdCopyFailed: isAr ? "تعذّر النسخ — حدّد النص وانسخه يدوياً" : "Couldn't copy — select the text and copy it manually",
    broken: isAr ? "ملف غير مكتمل" : "Broken Profile",
    unnamed: isAr ? "مستخدم بدون اسم" : "Unnamed User",
    unknown: isAr ? "غير معروف" : "Unknown",
    deleteMsg: isAr
      ? "هل أنت متأكد من حذف هذا المستخدم نهائياً؟ سيتم إزالته من جميع جداول النظام."
      : "Permanently delete this user? They will be removed from all logins and schedules.",
    accessControl: isAr ? "صلاحيات الوصول" : "Permissions",
    authStatus: isAr ? "تسجيل الدخول:" : "Auth Login:",
    staffStatus: isAr ? "ملف الموظف:" : "Staff Profile:",
    active: isAr ? "نشط" : "Active",
    missing: isAr ? "مفقود! (احذف وأعد الإنشاء)" : "Missing! (Delete & Recreate)",
    successMsg: isAr ? "تم تحديث الصلاحيات" : "Permission updated",
    errorMsg: isAr ? "فشل التحديث" : "Update failed",
    resetBtnTitle: isAr ? "تغيير كلمة المرور" : "Direct Password Override",
    searchPlaceholder: isAr ? "بحث في الصلاحيات..." : "Search permissions...",
    permCount: isAr ? "مفعّل" : "enabled",
    of: isAr ? "من" : "of",
    sidebarNote: isAr
      ? "القائمة: يظهر كل قسم إذا وُجد access.اسم_الصفحة أو أي مفتاح قديم مثل patients.add. الإعدادات: settings أو access.settings."
      : "Sidebar: each item shows if you grant access.<page> or a legacy action key (e.g. patients.add). Settings icon: settings or access.settings.",
    adminBypass: isAr ? "المدير Admin يتجاوز كل القيود تلقائياً." : "Admin role bypasses all permission checks.",
    systemRole: isAr ? "دور النظام" : "System role",
    alsoDentist: isAr ? "يعمل أيضاً كطبيب (يظهر في المواعيد والتقارير)" : "Also works as dentist (appointments & reports)",
    roleUpdated: isAr ? "تم تحديث الدور" : "Role updated",
    roleChangeWarn: (role: string, n: number) =>
      isAr
        ? `تغيير الدور لـ ${role} هيعيد ضبط صلاحيات الشخص ده على الإعداد الجاهز للدور (${n} صلاحية) وهيلغي أي تعديل يدوي. تكمل؟`
        : `Changing the role to ${role} re-deals this person's switches from the ${role} preset (${n} switches) and discards anything tuned by hand. Continue?`,
    presetApplied: isAr ? "تمت إعادة الضبط على الإعداد الجاهز" : "Reset to the role preset",
    presetConfirm: (role: string, n: number) =>
      isAr
        ? `إعادة ضبط الصلاحيات على الإعداد الجاهز لدور ${role} (${n} صلاحية)؟ أي تعديل يدوي هيتلغي.`
        : `Reset the switches to the ${role} preset (${n} switches)? Anything tuned by hand is discarded.`,
    transferConfirm: (name: string) =>
      isAr
        ? `نقل ملكية العيادة لـ ${name}؟ هو هيبقى المالك وإنت هتبقى مدير (Admin). مش هتقدر تتراجع بنفسك — هو وحده اللي يقدر يرجّعها لك.`
        : `Hand this clinic to ${name}? They become the owner and you become an Admin. You can't undo this yourself — only they can hand it back.`,
    transferred: isAr ? "تم نقل ملكية العيادة" : "Clinic ownership transferred",
    dentistFlagUpdated: isAr ? "تم تحديث إعداد الطبيب" : "Dentist setting updated",
  };

  const ROLES = ["Admin", "Dentist", "Assistant", "Receptionist"] as const;

  const handleDeleteUser = async (userId: string, uid: string | undefined, staffId: string | undefined) => {
    if (await confirm(txt.deleteMsg)) {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/delete-user", { 
          method: "POST", 
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          }, 
          body: JSON.stringify({ uid, userId, staffId, clinicId }) 
        });
        
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Delete failed");
        }

        await logActivity(
          currentUser?.name || "Admin",
          "User Deleted",
          `Removed user ID: ${userId} from clinic`,
          "system_logs",
          { severity: "CRITICAL", module: "users" }
        );
        showToast(isAr ? "تم إزالة المستخدم من العيادة" : "User removed from clinic", "info");
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : txt.errorMsg, "error");
      }
    }
  };

  const executePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || newPassword.length < 6) return;

    setIsResetting(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error(isAr ? "سجّل الدخول أولاً" : "Sign in required");

      const token = await firebaseUser.getIdToken();
      
      const response = await fetch("/api/staff/reset-password", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` 
        },
        // clinicId is what scopes the reset: the route refuses any account that is not a member
        // of the clinic the caller administers, so an Admin can only ever reset their own staff.
        body: JSON.stringify({ uid: resetTarget.uid, newPassword, clinicId }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      showToast(isAr ? "تم تغيير كلمة المرور بنجاح" : "Password forcefully updated", "success");
      await logActivity(
        currentUser?.name || "Admin",
        "Password Overridden",
        `Forced new password for: ${resetTarget.name}`,
        "system_logs",
        { severity: "CRITICAL", module: "users" }
      );
      setResetTarget(null);
      setNewPassword("");
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : "Failed to update password", "error");
    } finally {
      setIsResetting(false);
    }
  };

  const updateUserViaApi = async (userId: string, patch: Record<string, unknown>) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error(isAr ? "سجّل الدخول أولاً" : "Sign in required");

    const token = await firebaseUser.getIdToken();
    const res = await fetch("/api/admin/update-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userDocId: userId, patch, clinicId }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || txt.errorMsg);
    }
  };

  /** The switches a role starts with — what the warnings below count. */
  const presetSize = (role: string) => rolePreset(role).length;

  /**
   * Changing a role re-deals the new role's switches, so it asks first.
   *
   * update-user re-expands from the incoming role when no permission edit accompanies it, which
   * is right — switching someone to Dentist should deal them the Dentist floor — but it also
   * means anything tuned by hand for the old role is gone. Silent is the wrong way to do that.
   */
  const handleRoleChange = async (userId: string, newRole: string, targetUser: UserRow) => {
    if (newRole === targetUser.role) return;
    if (!(await confirm(txt.roleChangeWarn(newRole, presetSize(newRole))))) return;

    setUpdatingUserId(userId);
    try {
      const patch: Record<string, unknown> = { role: newRole };
      if (!isFullAccessRole(newRole)) patch.isDentist = false;
      await updateUserViaApi(userId, patch);
      if (accessModalUser && accessModalUser.id === userId) {
        setAccessModalUser(prev => prev ? {
          ...prev,
          role: newRole,
          isDentist: isFullAccessRole(newRole) ? prev.isDentist : false,
          // The server re-expands from the new role; mirror it so the switches below the dropdown
          // redraw at once instead of showing the old role's list until a refresh.
          permissions: rolePreset(newRole),
        } : null);
      }
      await logActivity(
        { uid: currentUser?.uid, name: currentUser?.name, role: currentUser?.role },
        "Role Updated",
        `Set role to ${newRole} for ${targetUser?.name || "Unknown"}`
      );
      showToast(txt.roleUpdated, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.errorMsg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleToggleAlsoDentist = async (userId: string, targetUser: UserRow, next: boolean) => {
    if (!isFullAccessRole(targetUser.role)) return;
    setUpdatingUserId(userId);
    try {
      await updateUserViaApi(userId, { isDentist: next });
      if (accessModalUser && accessModalUser.id === userId) {
        setAccessModalUser(prev => prev ? { ...prev, isDentist: next } : null);
      }
      await logActivity(
        { uid: currentUser?.uid, name: currentUser?.name, role: currentUser?.role },
        "Dentist Flag Updated",
        `${targetUser?.name || "Unknown"}: also dentist = ${next}`
      );
      showToast(txt.dentistFlagUpdated, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.errorMsg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const togglePermission = async (userId: string, currentPerms: string[], key: string, targetUser: UserRow) => {
    const newPerms = currentPerms.includes(key) ? currentPerms.filter((p) => p !== key) : [...currentPerms, key];
    setUpdatingUserId(userId);
    try {
      await updateUserViaApi(userId, { permissions: newPerms });
      if (accessModalUser && accessModalUser.id === userId) {
        setAccessModalUser(prev => prev ? { ...prev, permissions: newPerms } : null);
      }
      await logActivity(
        { uid: currentUser?.uid, name: currentUser?.name, role: currentUser?.role },
        "Permissions Updated",
        `Updated permissions for ${targetUser?.name || "Unknown"}`
      );
      showToast(txt.successMsg, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.errorMsg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const activeCount = (perms: string[] | undefined) => (perms || []).filter((p) => getAllPermissionIds().includes(p)).length;

  /** Puts someone back on their role's switches, discarding whatever was tuned by hand. */
  const applyRolePreset = async (userId: string, targetUser: UserRow) => {
    const role = targetUser.role || "Assistant";
    if (!(await confirm(txt.presetConfirm(role, presetSize(role))))) return;

    const next = rolePreset(role);
    setUpdatingUserId(userId);
    try {
      await updateUserViaApi(userId, { permissions: next });
      if (accessModalUser && accessModalUser.id === userId) {
        setAccessModalUser(prev => prev ? { ...prev, permissions: next } : null);
      }
      await logActivity(
        { uid: currentUser?.uid, name: currentUser?.name, role: currentUser?.role },
        "Permissions Reset",
        `Reset ${targetUser?.name || "Unknown"} to the ${role} preset`
      );
      showToast(txt.presetApplied, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.errorMsg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  /**
   * Hands the clinic to somebody else.
   *
   * Only ever offered to the current owner, and confirmed in words that say what cannot be
   * undone: the outgoing owner keeps every day-to-day power — they become an Admin — and gives up
   * only the protection, which is then the new owner's to hand back or not.
   */
  const transferOwnership = async (targetUser: UserRow) => {
    if (!(await confirm(txt.transferConfirm(targetUser.name || targetUser.email || "this person")))) return;

    setUpdatingUserId(targetUser.id);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error(isAr ? "سجّل الدخول الأول" : "Sign in required");
      const token = await firebaseUser.getIdToken();

      const res = await fetch("/api/admin/transfer-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, toUserDocId: targetUser.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || txt.errorMsg);

      await logActivity(
        { uid: currentUser?.uid, name: currentUser?.name, role: currentUser?.role },
        "Ownership Transferred",
        `Clinic handed to ${targetUser?.name || "Unknown"}`
      );
      setAccessModalUser(null);
      showToast(txt.transferred, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.errorMsg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const togglePermissionGroup = async (userId: string, currentPerms: string[], keys: string[], targetUser: UserRow, setAll: boolean) => {
    let newPerms = [...currentPerms];
    if (setAll) {
      keys.forEach(k => { if (!newPerms.includes(k)) newPerms.push(k); });
    } else {
      newPerms = newPerms.filter(p => !keys.includes(p));
    }
    
    setUpdatingUserId(userId);
    try {
      await updateUserViaApi(userId, { permissions: newPerms });
      if (accessModalUser && accessModalUser.id === userId) {
        setAccessModalUser(prev => prev ? { ...prev, permissions: newPerms } : null);
      }
      await logActivity(
        { uid: currentUser?.uid, name: currentUser?.name, role: currentUser?.role },
        "Permissions Updated",
        `Updated permission group for ${targetUser?.name || "Unknown"}`
      );
      showToast(txt.successMsg, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.errorMsg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  /**
   * Opens Manage Access showing the ENFORCED list, not the staff card's copy.
   *
   * The card list is seeded equal to the enforced map and kept equal on every save, but accounts
   * from before that discipline can differ — the backfill wrote the map (role floor + old ticks)
   * without rewriting the cards. Editing the stale copy would silently discard the difference on
   * first save. One read of the user document closes the gap; if the read fails, the card copy is
   * still a sane starting point.
   */
  const openAccessModal = async (u: UserRow) => {
    setAccessModalUser(u);
    try {
      const snap = await getDoc(doc(db, "users", u.id));
      const data = snap.data() || {};
      const map = clinicId ? (data.clinicPermissions || {})[clinicId] : undefined;
      const flat = data.permissions;
      const effective = Array.isArray(map) ? map : Array.isArray(flat) ? flat : null;
      if (effective) {
        setAccessModalUser((prev) =>
          prev && prev.id === u.id ? { ...prev, permissions: effective } : prev
        );
      }
    } catch {
      // The staff-card copy already on screen stands.
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in" dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 bg-white p-6 md:p-8 rounded-3xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
            <Users size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">{txt.title}</h3>
            <p className="text-sm font-semibold text-slate-500 mt-1">{txt.sub}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openAddUser}
          className="w-full sm:w-auto bg-slate-900 text-white px-6 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-slate-800 active:scale-95 transition-all shrink-0"
        >
          <Plus size={18} /> {txt.addBtn}
        </button>
      </div>

      {/* The onboarding screen tells anyone joining an existing clinic to "ask your admin for the
          Clinic ID — they'll find it in Settings". Until now it was shown nowhere in Settings, so
          that instruction was a dead end and new colleagues had no way to reach the clinic. */}
      {clinicId && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200/60 shadow-sm">
          <h4 className="text-sm font-black text-slate-900">{txt.clinicIdTitle}</h4>
          <p className="text-xs font-semibold text-slate-500 mt-1 leading-relaxed">{txt.clinicIdHelp}</p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <code className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm text-slate-800 break-all select-all">
              {clinicId}
            </code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(clinicId);
                  showToast(txt.clinicIdCopied, "success");
                } catch {
                  // Clipboard is blocked on insecure origins and in some in-app browsers; the code
                  // above is `select-all`, so it can still be copied by hand.
                  showToast(txt.clinicIdCopyFailed, "error");
                }
              }}
              className="px-5 py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 active:scale-95 transition-all shrink-0"
            >
              {txt.clinicIdCopy}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {usersList.map((u) => {
          const linkedStaff = staffMembers.find((s) => s.id === u.staffId || s.uid === u.uid || (s.email && u.email && (s.email as string).toLowerCase() === (u.email as string).toLowerCase()));
          const isOrphan = !u.name;
          const perms = u.permissions || [];
          const enabled = activeCount(perms);

          return (
            <div
              key={u.id}
              className={`bg-white rounded-3xl border shadow-sm transition-all hover:shadow-md relative overflow-hidden flex flex-col ${
                isOrphan ? "border-red-200 bg-red-50/10" : updatingUserId === u.id ? "border-accent-soft opacity-70" : "border-slate-200/60 hover:border-slate-300"
              }`}
            >
              {isOrphan && (
                <div className="absolute top-0 left-0 w-full bg-red-500 text-white text-[10px] font-black uppercase text-center py-1 tracking-widest flex justify-center items-center gap-1 z-10">
                  <AlertCircle size={12} /> {txt.broken}
                </div>
              )}

              {/* Top Action Buttons (Absolute) */}
              <div className={`absolute top-4 ${isRTL ? "left-4" : "right-4"} flex items-center gap-1 z-10 ${isOrphan ? "mt-4" : ""}`}>
                {/* The owner's password is theirs alone — the API refuses this too. */}
                {u.uid && !(isOwnerRole(u.role) && u.uid !== currentUser?.uid) && (
                  <button
                    type="button"
                    onClick={() => {
                      setResetTarget({ uid: u.uid!, name: u.name || "User" });
                      setNewPassword("");
                    }}
                    title={txt.resetBtnTitle}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                  >
                    <KeyRound size={16} />
                  </button>
                )}

                {/*
                  The owner is not removable, by anyone — including themselves. Their way out is
                  Transfer ownership, which hands the clinic on in one step rather than leaving it
                  with an `ownerId` pointing at an account that no longer runs it. The API refuses
                  this too; hiding the button just stops it being a dead end.
                */}
                {u.uid !== currentUser?.uid && !isOwnerRole(u.role) && (
                  <button
                    type="button"
                    onClick={() => handleDeleteUser(u.id, u.uid, u.staffId)}
                    title="Delete User"
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* Profile Info (Centered) */}
              <div className={`p-6 md:p-8 flex-1 flex flex-col items-center text-center ${isOrphan ? "pt-10" : ""}`}>
                <div
                  className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center shadow-sm mb-4 overflow-hidden ${
                    isOrphan ? "bg-red-50 text-red-500 border border-red-200/60" : "bg-slate-50 border border-slate-200/60"
                  }`}
                >
                  {isOrphan ? (
                    <AlertCircle size={36} strokeWidth={1.5} />
                  ) : (
                    <img 
                      src={
                        isFullAccessRole(u.role) ? "/avatars/admin.png" :
                        u.role === "Dentist" || isDentistStaff(u) ? "/avatars/dentist.png" :
                        u.role === "Receptionist" ? "/avatars/receptionist.png" :
                        u.role === "Assistant" ? "/avatars/assistant.png" :
                        "/avatars/assistant.png" // Fallback
                      }
                      alt={u.role || "User"}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                
                <h4 className="font-bold text-slate-900 text-lg mb-2 px-4 w-full truncate">
                  {u.name || txt.unnamed}
                </h4>
                
                <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
                  <span
                    className={`text-[10px] px-2.5 py-1 rounded-lg font-bold uppercase tracking-wider border flex items-center gap-1 ${
                      isOwnerRole(u.role)
                        ? "bg-amber-50 border-amber-200 text-amber-700"
                        : "bg-slate-100 border-slate-200 text-slate-600"
                    }`}
                  >
                    {isOwnerRole(u.role) && <Crown size={10} />}
                    {formatStaffRoleLabel(u, isAr)}
                  </span>
                  {isDentistStaff(u) && isFullAccessRole(u.role) && (
                    <span className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg font-bold flex items-center gap-1 uppercase tracking-wider">
                      <Stethoscope size={10} /> {isAr ? "طبيب" : "Dentist"}
                    </span>
                  )}
                </div>

                <p className="text-sm font-medium text-slate-500 w-full truncate px-4">
                  {u.email}
                </p>
              </div>

              {/* Bottom Actions */}
              <div className="p-6 md:p-8 pt-0 mt-auto">
                <div className="pt-6 border-t border-slate-100">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Shield size={14} /> {txt.accessControl}
                    </p>
                    {!isOrphan && (
                      <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-slate-50 text-slate-500 border border-slate-200/60">
                        {enabled} {txt.of} {totalAssignable}
                      </span>
                    )}
                  </div>

                  {isOrphan ? (
                    <div className="text-xs font-semibold space-y-2 bg-slate-50 p-3 rounded-xl">
                      <p className="text-slate-600 flex justify-between">
                        <span>{txt.authStatus}</span> 
                        <span className="text-green-600 font-bold">{txt.active}</span>
                      </p>
                      <p className="text-slate-600 flex justify-between">
                        <span>{txt.staffStatus}</span>
                        <span className="text-red-500 font-bold">{txt.missing}</span>
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openAccessModal(u)}
                      disabled={updatingUserId === u.id}
                      className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Shield size={16} className={updatingUserId === u.id ? "animate-pulse" : ""} />
                      {isAr ? "إدارة الصلاحيات" : "Manage Access"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {resetTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                {isAr ? "كلمة مرور جديدة لـ" : "New Password For"}{" "}
                <span className="text-accent-soft">{resetTarget.name}</span>
              </h2>
              <button type="button" onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={executePasswordReset} className="space-y-5">
              <div className="p-4 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold border border-amber-200">
                {isAr
                  ? "هذا الإجراء سيقوم بتغيير كلمة المرور فوراً وبدون الحاجة لبريد إلكتروني."
                  : "This will forcefully override the password instantly without an email verification."}
              </div>

              <div className="space-y-1.5">
                <label className={`text-[11px] font-bold text-slate-500 uppercase tracking-wider ${isRTL ? "pr-1" : "pl-1"}`}>
                  {isAr ? "اكتب كلمة المرور الجديدة" : "Type New Password"}
                </label>
                <div className="relative">
                  <Lock size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`} />
                  <input
                    autoFocus
                    required
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className={`w-full py-3.5 bg-slate-50 rounded-xl border border-slate-200/60 font-semibold text-slate-900 outline-none focus:bg-white focus:border-accent-soft transition-all ${
                      isRTL ? "pr-11 pl-4" : "pl-11 pr-4"
                    }`}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isResetting || newPassword.length < 6}
                className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-sm shadow-md mt-6 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {isResetting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {isAr ? "حفظ وتحديث النظام" : "Force Update System"}
              </button>
            </form>
          </div>
        </div>
      )}

      <UserAccessModal
        user={accessModalUser}
        isOpen={!!accessModalUser}
        onClose={() => setAccessModalUser(null)}
        language={language}
        isRTL={isRTL}
        updatingUserId={updatingUserId}
        handleRoleChange={handleRoleChange}
        handleToggleAlsoDentist={handleToggleAlsoDentist}
        togglePermission={togglePermission}
        togglePermissionGroup={togglePermissionGroup}
        viewerIsOwner={viewerIsOwner}
        applyRolePreset={applyRolePreset}
        transferOwnership={transferOwnership}
      />
    </div>
  );
}
