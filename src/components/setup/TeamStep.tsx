"use client";

import { useState } from "react";
import { KeyRound, Link2, Loader2, UserPlus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";
import { logActivity } from "@/lib/logger";
import { isFullAccessRole } from "@/lib/permissions";
import { MIN_STAFF_PASSWORD, SETUP_TEAM_ROLES, teamMemberProblem } from "@/lib/setupWizard";
import { formatStaffRoleLabel } from "@/lib/staffRoles";
import { createStaffLogin } from "@/lib/staffLogin";
import InviteLinks from "@/components/settings/InviteLinks";

export type TeamMember = {
  id: string;
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  isDentist?: boolean;
};

/**
 * Setup step: the people who work here.
 *
 * Two ways in, the same two Settings → Staff & logins has: create the login now (name, email, a
 * first password, the role) through the same call that screen makes, or make an invite link and
 * send it on WhatsApp — which IS that screen's invite panel, embedded, not a copy of it.
 *
 * The list comes from the page, which listens to `staff`, so a colleague who opens an invite link
 * while the owner is still on this step appears in it without a refresh — and the booking step
 * later knows how many dentists there are to choose from.
 */
export default function TeamStep({ team }: { team: TeamMember[] }) {
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";

  const [mode, setMode] = useState<"login" | "link">("login");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "Dentist", isDentist: false });

  // A half-typed colleague is work: "Next" asks before dropping it, as it does for an insurer.
  useDirtyFlag("setup-team", Boolean(form.name.trim() || form.email.trim() || form.password));

  const t = {
    onTeam: (n: number) =>
      ar ? `في الفريق دلوقتي (${n})` : `On the team now (${n})`,
    you: ar ? "إنت" : "You",
    login: ar ? "اعمل له حساب دلوقتي" : "Create their login",
    link: ar ? "ابعت له رابط دعوة" : "Send an invite link",
    loginHint: ar
      ? "اكتب اسمه وإيميله وباسورد مبدئي، وقوله عليهم. تقدر تغيّر الباسورد بعدين من الإعدادات ← الموظفون."
      : "Type their name, email and a first password, then give them both. You can reset the password later in Settings → Staff & logins.",
    name: ar ? "الاسم" : "Name",
    email: ar ? "الإيميل" : "Email",
    password: ar ? "باسورد مبدئي" : "First password",
    passwordHint: ar ? `${MIN_STAFF_PASSWORD} حروف على الأقل` : `At least ${MIN_STAFF_PASSWORD} characters`,
    role: ar ? "الدور" : "Role",
    roles: {
      Dentist: ar ? "طبيب" : "Dentist",
      Receptionist: ar ? "استقبال" : "Receptionist",
      Assistant: ar ? "مساعد" : "Assistant",
      Admin: ar ? "مدير" : "Admin",
    } as Record<string, string>,
    alsoDentist: ar ? "بيكشف على مرضى كمان (يظهر في قوائم الأطباء والمواعيد)" : "Also treats patients (shows in doctor lists and appointments)",
    add: ar ? "ضيفه للفريق" : "Add to the team",
    added: (name: string) => (ar ? `${name} اتضاف للفريق` : `${name} is on the team`),
    problems: {
      name: ar ? "اكتب الاسم." : "Type their name.",
      email: ar ? "الإيميل ده مش مظبوط." : "That email doesn't look right.",
      password: ar ? `الباسورد لازم يكون ${MIN_STAFF_PASSWORD} حروف على الأقل.` : `The password needs at least ${MIN_STAFF_PASSWORD} characters.`,
    },
    failed: ar ? "مقدرناش نضيفه. جرّب تاني." : "Couldn't add them. Try again.",
  };

  const add = async () => {
    const problem = teamMemberProblem(form);
    if (problem) {
      showToast(t.problems[problem], "error");
      return;
    }
    setSaving(true);
    try {
      const result = await createStaffLogin({ clinicId, ...form });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "User Created",
        `Created user ${form.name.trim()} (${form.email.trim().toLowerCase()}) from clinic setup`
      );
      if (!result.isNewUser && result.message) showToast(result.message, "info");
      else showToast(t.added(form.name.trim()), "success");
      // The role stays: a clinic adding its dentists adds them one after another.
      setForm((f) => ({ ...f, name: "", email: "", password: "", isDentist: false }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all";
  const labelCls = "block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2";
  const filled = Boolean(form.name.trim() && form.email.trim() && form.password);

  return (
    <div className="space-y-5">
      {team.length > 0 && (
        <div>
          <p className={labelCls}>{t.onTeam(team.length)}</p>
          <ul className="flex flex-wrap gap-2">
            {team.map((m) => (
              <li key={m.id} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-subtle ps-1.5 pe-3 py-1.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-tint text-[12px] font-black text-accent">
                  {(m.name || m.email || "?").trim().charAt(0).toUpperCase()}
                </span>
                <span className="text-sm font-bold text-ink">{m.name || m.email || "—"}</span>
                <span className="text-[11px] font-bold text-ink-muted">
                  {formatStaffRoleLabel(m, ar)}
                  {m.uid && m.uid === user?.uid ? ` · ${t.you}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="inline-flex rounded-xl border border-line p-1 bg-surface-subtle" role="tablist">
        {(["login", "link"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-black transition-colors ${
              mode === k ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            {k === "login" ? <KeyRound size={14} /> : <Link2 size={14} />}
            {k === "login" ? t.login : t.link}
          </button>
        ))}
      </div>

      {mode === "login" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <p className="text-sm font-medium text-ink-muted leading-relaxed">{t.loginHint}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className={labelCls}>{t.name}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} autoComplete="off" />
            </label>
            <label className="block">
              <span className={labelCls}>{t.role}</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value, isDentist: isFullAccessRole(e.target.value) ? form.isDentist : false })}
                className={inputCls}
              >
                {SETUP_TEAM_ROLES.map((r) => (
                  <option key={r} value={r}>{t.roles[r]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>{t.email}</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                dir="ltr"
                className={inputCls}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className={labelCls}>{t.password}</span>
              {/* Shown, not dotted: the owner is choosing it to hand to someone else. */}
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={t.passwordHint}
                dir="ltr"
                className={inputCls}
                autoComplete="new-password"
                spellCheck={false}
              />
            </label>
          </div>
          {isFullAccessRole(form.role) && (
            <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-line bg-surface-subtle p-4">
              <input
                type="checkbox"
                checked={form.isDentist}
                onChange={(e) => setForm({ ...form, isDentist: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-slate-900"
              />
              <span className="text-sm font-semibold text-ink-body leading-snug">{t.alsoDentist}</span>
            </label>
          )}
          <button
            type="submit"
            disabled={saving || !filled}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-ink-slab text-white text-sm font-black hover:bg-ink disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {t.add}
          </button>
        </form>
      ) : (
        <InviteLinks clinicId={clinicId} />
      )}
    </div>
  );
}
