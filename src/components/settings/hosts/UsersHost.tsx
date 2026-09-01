"use client";

/**
 * The team list, and the invite form that used to live in the settings page itself.
 *
 * `staff` is the source of truth for who works at this clinic — the user list is built from it
 * rather than from the platform-wide `users` collection, because a person can work at more than
 * one clinic and only their staff row is scoped to this one.
 *
 * The invite form is unchanged from the old page apart from where it lives. Creating the login
 * goes through /api/staff/create on the Admin SDK: the browser cannot create an Auth account, and
 * the route also refuses to hand an existing account a second clinic without saying so.
 */

import { useCallback, useEffect, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import { onSnapshot } from "firebase/firestore";
import { Badge, Lock, Mail, Save, User, X } from "lucide-react";
import UserManagement from "@/components/settings/UserManagement";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { auth } from "@/lib/firebase";
import { getClinicCollection } from "@/lib/db-utils";
import { logActivity } from "@/lib/logger";
import { isFullAccessRole } from "@/lib/permissions";

/**
 * Matches the shape UserManagement expects. The index signature is load-bearing: staff rows carry
 * clinic-specific fields (commission, working days) that this host never reads but must pass
 * through untouched.
 */
type StaffRecord = {
  id: string;
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  isDentist?: boolean;
  permissions?: string[];
  [key: string]: unknown;
};

export default function UsersHost() {
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { showToast } = useUI();

  const [staffMembers, setStaffMembers] = useState<StaffRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "Assistant",
    isDentist: false,
  });


  const txt = useSettingsText("users");

  useEffect(() => {
    const unsub = onSnapshot(getClinicCollection("staff"), (snap) => {
      setStaffMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffRecord));
    });
    return () => unsub();
  }, []);

  // `staff` IS the user list for this clinic; the uid is the user-document id when one exists.
  const usersList = staffMembers.map((staff) => ({
    id: staff.uid || staff.id,
    uid: staff.uid,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    isDentist: staff.isDentist,
    staffId: staff.id,
    permissions: staff.permissions || [],
  }));

  const openAddUser = useCallback(() => {
    setForm({ name: "", email: "", password: "", role: "Assistant", isDentist: false });
    setIsModalOpen(true);
  }, []);

  const handleSaveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const isDentist = isFullAccessRole(form.role) ? form.isDentist : false;
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/staff/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: form.email.toLowerCase(),
          password: form.password,
          name: form.name,
          role: form.role,
          createDbRecords: true,
          clinicId,
          isDentist,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to create auth login");

      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "User Created",
        `Created user ${form.name} (${form.email.toLowerCase()})`
      );

      if (result.isNewUser === false) showToast(result.message, "info");
      else showToast(result.message || "Account created!", "success");

      setIsModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Operation failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = `w-full py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all ${
    isRTL ? "pr-11 pl-4" : "pl-11 pr-4"
  }`;
  const labelClass = `text-[11px] font-bold text-ink-muted uppercase tracking-wider ${
    isRTL ? "pr-1" : "pl-1"
  }`;
  const iconClass = `absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`;

  return (
    <>
      <UserManagement
        usersList={usersList}
        currentUser={user}
        openAddUser={openAddUser}
        clinicId={clinicId}
      />

      {isModalOpen && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-surface rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-line">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-ink tracking-tight">{txt.title}</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                aria-label={txt.close}
                className="text-ink-muted bg-surface-subtle hover:bg-danger-tint hover:text-danger p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-5">
              <div className="space-y-1.5">
                <label className={labelClass}>{txt.fullName}</label>
                <div className="relative">
                  <User size={18} className={iconClass} />
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelClass}>{txt.email}</label>
                <div className="relative">
                  <Mail size={18} className={iconClass} />
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelClass}>{txt.password}</label>
                <div className="relative">
                  <Lock size={18} className={iconClass} />
                  <input
                    required
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={txt.passwordHint}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className={labelClass}>{txt.role}</label>
                <div className="relative">
                  <Badge size={18} className={iconClass} />
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        role: e.target.value,
                        isDentist: isFullAccessRole(e.target.value) ? form.isDentist : false,
                      })
                    }
                    className={`${fieldClass} appearance-none cursor-pointer`}
                  >
                    <option value="Dentist">{txt.roleDentist}</option>
                    <option value="Assistant">{txt.roleAssistant}</option>
                    <option value="Receptionist">{txt.roleReceptionist}</option>
                    <option value="Admin">{txt.roleAdmin}</option>
                  </select>
                </div>
              </div>

              {isFullAccessRole(form.role) && (
                <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-line bg-surface-subtle p-4">
                  <input
                    type="checkbox"
                    checked={form.isDentist}
                    onChange={(e) => setForm({ ...form, isDentist: e.target.checked })}
                    className="mt-0.5 w-4 h-4 rounded border-line-strong text-accent"
                  />
                  <span className="text-sm font-semibold text-ink-body leading-snug">
                    {txt.alsoDentist}
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-accent text-ink-on-accent py-4 rounded-xl font-bold text-sm shadow-md mt-6 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Save size={18} /> {txt.submit}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
