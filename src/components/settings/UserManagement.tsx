"use client";

import { useEffect, useRef, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import { Users, Shield, Trash2, AlertCircle, Plus, KeyRound, X, Save, Lock, Loader2, Copy, Stethoscope, Crown } from "lucide-react";
import { formatStaffRoleLabel, isDentistStaff } from "@/lib/staffRoles";
import { isFullAccessRole, isOwnerRole, rolePreset } from "@/lib/permissions";
import { useClinic } from "@/context/ClinicContext";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { logActivity } from "@/lib/logger";
import { getAllPermissionIds } from "@/config/permissionsCatalog";
import { countedNoun } from "@/lib/arabicCount";
import UserAccessModal from "./UserAccessModal";
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
  currentUser: { uid?: string; name?: string; role?: string } | null;
  openAddUser: () => void;
  clinicId: string | null;
};

export default function UserManagement({ usersList, currentUser, openAddUser, clinicId }: Props) {
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

    ...useSettingsText("userManagement"),

    roleChangeWarn: (role: string, n: number) =>
      isAr
        ? `تغيير الدور لـ ${role} هيعيد ضبط صلاحيات الشخص ده على الإعداد الجاهز للدور (${n} صلاحية) وهيلغي أي تعديل يدوي. تكمل؟`
        : `Changing the role to ${role} re-deals this person's switches from the ${role} preset (${n} switches) and discards anything tuned by hand. Continue?`,

    presetConfirm: (role: string, n: number) =>
      isAr
        ? `إعادة ضبط الصلاحيات على الإعداد الجاهز لدور ${role} (${n} صلاحية)؟ أي تعديل يدوي هيتلغي.`
        : `Reset the switches to the ${role} preset (${n} switches)? Anything tuned by hand is discarded.`,

    transferConfirm: (name: string) =>
      isAr
        ? `نقل ملكية العيادة لـ ${name}؟ هو هيبقى المالك وإنت هتبقى مدير (Admin). مش هتقدر تتراجع بنفسك — هو وحده اللي يقدر يرجّعها لك.`
        : `Hand this clinic to ${name}? They become the owner and you become an Admin. You can't undo this yourself — only they can hand it back.`,

  };

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

  /**
   * Who can change anything. The number an admin opens this page to check is not how many people
   * there are, it is how many of them are unrestricted — so the rail says that rather than making
   * them count role chips.
   */
  const fullAccessCount = usersList.filter((u) => isFullAccessRole(u.role)).length;
  const brokenCount = usersList.filter((u) => !u.name).length;

  const people = countedNoun(usersList.length, isAr, {
    one: txt.signedInPersonOne,
    two: txt.signedInPersonTwo,
    few: txt.signedInPersonFew,
    many: txt.signedInPersonMany,
  });

  // The verb agrees with the count as well as the noun, and "one of them" is not a number
  // in Arabic — so the second clause is written out rather than interpolated.
  const headline = isAr
    ? `${people} ${usersList.length === 1 ? "يقدر يدخل" : "يقدروا يدخلوا"} العيادة دي، ` +
      (fullAccessCount === 0
        ? "ومحدش فيهم يقدر يغيّر أي حاجة."
        : fullAccessCount === 1
          ? "منهم واحد يقدر يغيّر أي حاجة."
          : `منهم ${fullAccessCount} يقدروا يغيّروا أي حاجة.`)
    : `${people} can sign in to this clinic. ${fullAccessCount} of them can change anything.`;

  const copyClinicId = async () => {
    if (!clinicId) return;
    try {
      await navigator.clipboard.writeText(clinicId);
      showToast(txt.clinicIdCopied, "success");
    } catch {
      // Clipboard is blocked on insecure origins and in some in-app browsers; the code is
      // `select-all`, so it can still be copied by hand.
      showToast(txt.clinicIdCopyFailed, "error");
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* What this screen is for, said before the list: how many people hold a key, how many of
          those keys open everything, and the id a new colleague is waiting on. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <Users size={12} />
              {txt.title}
            </p>
            <p className="font-display text-lg font-bold leading-snug text-white sm:text-xl">{headline}</p>

            {clinicId && (
              <div className="pt-2">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
                  {txt.clinicIdTitle}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code
                    className="select-all break-all font-figure text-[15px] tracking-tight text-white/75"
                    dir="ltr"
                  >
                    {clinicId}
                  </code>
                  <button
                    type="button"
                    onClick={copyClinicId}
                    title={txt.clinicIdCopy}
                    aria-label={txt.clinicIdCopy}
                    className="rounded-lg bg-white/10 p-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <p className="mt-1.5 max-w-md text-[11px] leading-relaxed text-white/40">
                  {txt.clinicIdHelp}
                </p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                brokenCount > 0 ? "bg-amber-400/20 text-amber-200" : "bg-white/12 text-white"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${brokenCount > 0 ? "bg-amber-400" : "bg-emerald-400"}`}
              />
              {brokenCount > 0
                ? countedNoun(brokenCount, isAr, {
                    one: txt.brokenProfileOne,
                    two: txt.brokenProfileTwo,
                    few: txt.brokenProfileFew,
                    many: txt.brokenProfileMany,
                  })
                : isAr
                  ? "كل الحسابات سليمة"
                  : "All accounts linked"}
            </span>
            <button
              type="button"
              onClick={openAddUser}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent shadow-md transition-all hover:bg-accent-strong active:scale-95"
            >
              <Plus size={16} /> {txt.addBtn}
            </button>
          </div>
        </div>
      </div>

      {/* One row each. Comparing two colleagues' access used to mean looking across two cards in
          different columns; the switch counts line up now. */}
      <ul className="space-y-2">
        {usersList.map((u) => {
          const isOrphan = !u.name;
          const perms = u.permissions || [];
          const enabled = activeCount(perms);
          const isUpdating = updatingUserId === u.id;

          return (
            <li
              key={u.id}
              className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 transition-colors sm:flex-row sm:items-center ${
                isOrphan
                  ? "border-danger/30 bg-danger-tint"
                  : isUpdating
                    ? "border-accent-soft bg-surface-subtle opacity-70"
                    : "border-line bg-surface-subtle hover:border-line-strong"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border ${
                  isOrphan ? "border-danger/30 bg-surface text-danger" : "border-line bg-surface"
                }`}
              >
                {isOrphan ? (
                  <AlertCircle size={20} strokeWidth={1.75} />
                ) : (
                  <img
                    src={
                      isFullAccessRole(u.role)
                        ? "/avatars/admin.png"
                        : u.role === "Dentist" || isDentistStaff(u)
                          ? "/avatars/dentist.png"
                          : u.role === "Receptionist"
                            ? "/avatars/receptionist.png"
                            : "/avatars/assistant.png"
                    }
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-black text-ink">{u.name || txt.unnamed}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      isOwnerRole(u.role)
                        ? "border-accent/30 bg-accent-tint text-accent"
                        : u.role
                          ? "border-line bg-surface text-ink-body"
                          : "border-dashed border-line-strong bg-transparent text-ink-muted"
                    }`}
                  >
                    {isOwnerRole(u.role) && <Crown size={10} />}
                    {formatStaffRoleLabel(u, isAr)}
                  </span>
                  {isDentistStaff(u) && isFullAccessRole(u.role) && (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-body">
                      <Stethoscope size={10} /> {isAr ? "طبيب" : "Dentist"}
                    </span>
                  )}
                  {isOrphan && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-danger px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                      <AlertCircle size={10} /> {txt.broken}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-medium text-ink-muted">
                  {isOrphan
                    ? `${txt.authStatus} ${txt.active} · ${txt.staffStatus} ${txt.missing}`
                    : u.email || txt.noEmail}
                </p>
              </div>
              </div>

              {/* Every slot from here to the row's end holds its width whether or not it has
                  something in it. These buttons are conditional — an owner cannot be deleted, an
                  account with no login has no password to reset — and letting the row pack them
                  tight put each colleague's Access button at a different distance from the edge. */}
              <div className="flex shrink-0 items-center justify-end gap-2">
              <span
                className="flex w-[4.75rem] shrink-0 items-center justify-end gap-1.5 text-ink-muted"
                title={txt.accessControl}
              >
                {!isOrphan && (
                  <>
                    <Shield size={13} className="shrink-0" />
                    <span className="font-figure text-sm font-bold text-ink-body">
                      {enabled}
                      <span className="text-ink-muted">/{totalAssignable}</span>
                    </span>
                  </>
                )}
              </span>

              <div className="flex items-center gap-1">
                <span className="flex w-[6.25rem]">
                  {!isOrphan && (
                    <button
                      type="button"
                      onClick={() => void openAccessModal(u)}
                      disabled={isUpdating}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11px] font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
                    >
                      <Shield size={13} className={isUpdating ? "animate-pulse" : ""} />
                      {isAr ? "الصلاحيات" : "Access"}
                    </button>
                  )}
                </span>

                {/* The owner's password is theirs alone — the API refuses this too. */}
                <span className="flex w-9 justify-center">
                  {u.uid && !(isOwnerRole(u.role) && u.uid !== currentUser?.uid) && (
                    <button
                      type="button"
                      onClick={() => {
                        setResetTarget({ uid: u.uid!, name: u.name || "User" });
                        setNewPassword("");
                      }}
                      title={txt.resetBtnTitle}
                      aria-label={txt.resetBtnTitle}
                      className="rounded-lg p-2 text-ink-muted transition-all hover:bg-surface-muted hover:text-ink"
                    >
                      <KeyRound size={15} />
                    </button>
                  )}
                </span>

                {/*
                  The owner is not removable, by anyone — including themselves. Their way out is
                  Transfer ownership, which hands the clinic on in one step rather than leaving it
                  with an `ownerId` pointing at an account that no longer runs it. The API refuses
                  this too; hiding the button just stops it being a dead end.
                */}
                <span className="flex w-9 justify-center">
                  {u.uid !== currentUser?.uid && !isOwnerRole(u.role) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(u.id, u.uid, u.staffId)}
                      title={isAr ? "إزالة المستخدم" : "Remove user"}
                      aria-label={isAr ? "إزالة المستخدم" : "Remove user"}
                      className="rounded-lg p-2 text-ink-muted transition-all hover:bg-danger-tint hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </div>
              </div>
            </li>
          );
        })}
      </ul>

      {resetTarget && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-surface rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-line">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-ink tracking-tight">
                {isAr ? "كلمة مرور جديدة لـ" : "New Password For"}{" "}
                <span className="text-accent-soft">{resetTarget.name}</span>
              </h2>
              <button type="button" onClick={() => setResetTarget(null)} className="text-ink-muted bg-surface-subtle hover:bg-danger-tint hover:text-danger p-2 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={executePasswordReset} className="space-y-5">
              <div className="p-4 rounded-xl border border-warn/25 bg-warn-tint text-xs font-bold text-warn">
                {isAr
                  ? "هذا الإجراء سيقوم بتغيير كلمة المرور فوراً وبدون الحاجة لبريد إلكتروني."
                  : "This will forcefully override the password instantly without an email verification."}
              </div>

              <div className="space-y-1.5">
                <label className={`text-[11px] font-bold text-ink-muted uppercase tracking-wider ${isRTL ? "pr-1" : "pl-1"}`}>
                  {isAr ? "اكتب كلمة المرور الجديدة" : "Type New Password"}
                </label>
                <div className="relative">
                  <Lock size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`} />
                  <input
                    autoFocus
                    required
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className={`w-full py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all ${
                      isRTL ? "pr-11 pl-4" : "pl-11 pr-4"
                    }`}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isResetting || newPassword.length < 6}
                className="w-full bg-accent text-ink-on-accent py-4 rounded-xl font-bold text-sm shadow-md mt-6 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
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
