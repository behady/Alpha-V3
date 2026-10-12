"use client";

/**
 * The "add a team member" form: a login plus a staff card at this clinic.
 *
 * Shared by Settings → Staff & logins and the Team page, so the two cannot drift. Creating the
 * login goes through lib/staffLogin (/api/staff/create on the Admin SDK): the browser cannot create
 * an Auth account, and the route refuses anyone who is not an admin of the clinic.
 *
 * Rendered only while open, so every opening starts from an empty form.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Badge, Lock, Mail, Save, User, X } from "lucide-react";
import { useSettingsText } from "@/lib/useSettingsText";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { logActivity } from "@/lib/logger";
import { isFullAccessRole } from "@/lib/permissions";
import { createStaffLogin } from "@/lib/staffLogin";

export default function AddUserModal({
  clinicId,
  onClose,
  initialRole = "Assistant",
}: {
  clinicId: string | null;
  onClose: () => void;
  initialRole?: string;
}) {
  const { isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useUI();
  const txt = useSettingsText("users");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: initialRole,
    isDentist: false,
  });

  const handleSaveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await createStaffLogin({ clinicId, ...form });

      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "User Created",
        `Created user ${form.name} (${form.email.toLowerCase()})`
      );

      if (!result.isNewUser && result.message) showToast(result.message, "info");
      else showToast(txt.created, "success");

      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : txt.failed, "error");
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

  // Portalled to <body>: a fixed overlay rendered inside <main> is clipped by it on some pages.
  return createPortal(
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4" dir={isRTL ? "rtl" : "ltr"}>
      <div className="bg-surface rounded-[2rem] p-6 sm:p-8 w-full max-w-md max-h-[92dvh] overflow-y-auto shadow-2xl animate-in zoom-in-95 border border-line">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-ink tracking-tight">{txt.title}</h2>
          <button
            type="button"
            onClick={onClose}
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
                data-tour="user-name"
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
                type="email" data-tour="user-email" autoComplete="off"
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
                type="password" data-tour="user-password" autoComplete="new-password"
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
                data-tour="user-role"
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
            data-tour="user-save"
            disabled={saving}
            className="w-full bg-accent text-ink-on-accent py-4 rounded-xl font-bold text-sm shadow-md mt-6 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save size={18} /> {txt.submit}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
