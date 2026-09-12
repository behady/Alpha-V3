"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Copy, MessageCircle, XCircle, RefreshCcw, Check } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { INVITABLE_ROLES, INVITE_TTL_DAYS, inviteLinkFor, inviteShareText } from "@/lib/inviteLinks";

/**
 * "Send them a link" — the panel on the Users screen that replaces reading out a Clinic ID.
 *
 * An admin picks the role, presses Create, and gets a link plus a WhatsApp button that opens a
 * ready-written message. The colleague opens the link, signs in or signs up, and is in with that
 * role. Links are single-use and last seven days; the list below shows who used which one and
 * lets the admin cancel one that went to the wrong person.
 *
 * Everything goes through /api/invites — the browser never touches the invites collection.
 */
type InviteRow = {
  code: string;
  role: string;
  status: "active" | "expired" | "revoked" | "used";
  maxUses: number;
  usedCount: number;
  createdAt: string | null;
  expiresAt: string | null;
  createdByName: string | null;
  usedBy: Array<{ name: string | null; email: string | null; at: string | null }>;
};

const ROLE_AR: Record<string, string> = { Dentist: "طبيب", Receptionist: "استقبال", Assistant: "مساعد" };

export default function InviteLinks({ clinicId }: { clinicId: string | null }) {
  const { clinic, isAdmin } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";
  const lang: "en" | "ar" = isAr ? "ar" : "en";

  const [role, setRole] = useState<string>("Receptionist");
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [latest, setLatest] = useState<{ code: string; role: string } | null>(null);

  const roleLabel = (r: string) => (isAr ? ROLE_AR[r] || r : r);

  const t = {
    title: isAr ? "رابط دعوة" : "Invite link",
    lead: isAr
      ? "اختار الدور، اعمل رابط، وابعته على واتساب. زميلك يفتحه ويسجّل دخول أو يعمل حساب — ويدخل على طول بالدور ده. الرابط لمرة واحدة وشغال ٧ أيام."
      : `Pick a role, make a link, send it on WhatsApp. Your colleague opens it, signs in or signs up, and is in with that role. One use, valid ${INVITE_TTL_DAYS} days.`,
    role: isAr ? "الدور" : "Role",
    create: isAr ? "إنشاء رابط" : "Create link",
    creating: isAr ? "بنعمل الرابط…" : "Creating…",
    copy: isAr ? "نسخ الرابط" : "Copy link",
    copied: isAr ? "تم نسخ الرابط" : "Link copied",
    copyFailed: isAr ? "تعذّر النسخ — حدّد الرابط وانسخه" : "Couldn't copy — select the link and copy it",
    whatsapp: isAr ? "إرسال على واتساب" : "Send on WhatsApp",
    active: isAr ? "الروابط الحالية" : "Your links",
    none: isAr ? "مفيش روابط لسه." : "No links yet.",
    cancel: isAr ? "إلغاء" : "Cancel",
    cancelAsk: (code: string) => (isAr ? `تلغي الرابط ${code}؟ مش هيشتغل تاني.` : `Cancel link ${code}? It will stop working.`),
    cancelled: isAr ? "تم إلغاء الرابط" : "Link cancelled",
    status: {
      active: isAr ? "شغال" : "Active",
      expired: isAr ? "انتهى" : "Expired",
      revoked: isAr ? "ملغي" : "Cancelled",
      used: isAr ? "اتستخدم" : "Used",
    } as Record<InviteRow["status"], string>,
    usedBy: isAr ? "استخدمه" : "Used by",
    expires: isAr ? "ينتهي" : "Expires",
    failed: isAr ? "حصل خطأ. جرّب تاني." : "Something went wrong. Try again.",
    refresh: isAr ? "تحديث" : "Refresh",
  };

  const call = useCallback(
    async (init: { method: "GET" } | { method: "POST"; body: Record<string, unknown> }) => {
      const token = await auth.currentUser?.getIdToken();
      if (!token || !clinicId) throw new Error("no session");
      const res = await fetch(
        init.method === "GET" ? `/api/invites?clinicId=${encodeURIComponent(clinicId)}` : "/api/invites",
        {
          method: init.method,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: init.method === "POST" ? JSON.stringify({ clinicId, ...init.body }) : undefined,
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || "request failed");
      return data;
    },
    [clinicId]
  );

  const load = useCallback(async () => {
    if (!clinicId || !isAdmin) return;
    setLoading(true);
    try {
      const data = await call({ method: "GET" });
      setRows(data.items as InviteRow[]);
    } catch {
      /* the list is a convenience; the create flow still works */
    } finally {
      setLoading(false);
    }
  }, [call, clinicId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const linkFor = (code: string) => inviteLinkFor(window.location.origin, code);

  const create = async () => {
    setCreating(true);
    try {
      const data = await call({ method: "POST", body: { action: "create", role } });
      setLatest({ code: data.code, role: data.role });
      void load();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      showToast(t.copied, "success");
    } catch {
      showToast(t.copyFailed, "error");
    }
  };

  const shareOnWhatsApp = (code: string, r: string) => {
    const text = inviteShareText({ clinicName: clinic?.name || "", roleLabel: roleLabel(r), link: linkFor(code) }, lang);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const revoke = async (code: string) => {
    if (!(await confirm(t.cancelAsk(code), { tone: "danger", confirmLabel: t.cancel }))) return;
    try {
      await call({ method: "POST", body: { action: "revoke", code } });
      if (latest?.code === code) setLatest(null);
      showToast(t.cancelled, "success");
      void load();
    } catch {
      showToast(t.failed, "error");
    }
  };

  if (!isAdmin || !clinicId) return null;

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(isAr ? "ar-EG" : "en-GB") : "");

  return (
    <section className="rounded-[1.75rem] border border-line bg-surface p-5 sm:p-6 space-y-5" dir={isRTL ? "rtl" : "ltr"} data-tour="invite-link">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-tint text-accent flex items-center justify-center shrink-0">
          <Link2 size={18} />
        </div>
        <div>
          <h3 className="text-base font-black text-ink">{t.title}</h3>
          <p className="text-xs font-medium text-ink-muted leading-relaxed mt-0.5 max-w-xl">{t.lead}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="block sm:w-56">
          <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.role}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-ink-on-accent shadow-md transition-all hover:bg-accent-strong disabled:opacity-60"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
          {creating ? t.creating : t.create}
        </button>
      </div>

      {latest && (
        <div className="rounded-2xl border border-ok/25 bg-ok-tint p-4 space-y-3">
          <p className="flex items-center gap-2 text-sm font-bold text-ok">
            <Check size={16} /> {isAr ? `رابط ${roleLabel(latest.role)} جاهز` : `${roleLabel(latest.role)} link ready`}
          </p>
          <code className="block select-all break-all rounded-lg bg-white/70 px-3 py-2 font-figure text-sm text-ink" dir="ltr">
            {linkFor(latest.code)}
          </code>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => copy(latest.code)} className="inline-flex items-center gap-2 rounded-xl bg-white border border-line px-4 py-2 text-sm font-bold text-ink hover:border-line-strong">
              <Copy size={14} /> {t.copy}
            </button>
            <button type="button" onClick={() => shareOnWhatsApp(latest.code, latest.role)} className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-bold text-white hover:brightness-95">
              <MessageCircle size={14} /> {t.whatsapp}
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-black text-ink-muted uppercase tracking-widest">{t.active}</p>
          <button type="button" onClick={() => void load()} className="text-[11px] font-bold text-ink-muted hover:text-ink inline-flex items-center gap-1">
            <RefreshCcw size={11} /> {t.refresh}
          </button>
        </div>
        {loading ? (
          <div className="py-4 flex justify-center"><Loader2 size={18} className="animate-spin text-ink-muted" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm font-medium text-ink-muted">{t.none}</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line overflow-hidden">
            {rows.map((row) => (
              <li key={row.code} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 bg-surface-subtle">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-ink">
                    {roleLabel(row.role)}
                    <span className={`ms-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                      row.status === "active" ? "bg-ok-tint text-ok" : row.status === "used" ? "bg-surface-muted text-ink-body" : "bg-danger-tint text-danger"
                    }`}>
                      {t.status[row.status]}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted font-mono" dir="ltr">{row.code}</p>
                  {row.usedBy.length > 0 && (
                    <p className="text-xs text-ink-muted mt-0.5">
                      {t.usedBy} {row.usedBy.map((u) => u.name || u.email).filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                <p className="text-xs text-ink-muted">{row.status === "active" && row.expiresAt ? `${t.expires} ${fmtDate(row.expiresAt)}` : fmtDate(row.createdAt)}</p>
                {row.status === "active" && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => copy(row.code)} title={t.copy} className="rounded-lg border border-line bg-white p-2 text-ink-muted hover:text-ink"><Copy size={14} /></button>
                    <button type="button" onClick={() => shareOnWhatsApp(row.code, row.role)} title={t.whatsapp} className="rounded-lg border border-line bg-white p-2 text-ok hover:bg-ok-tint"><MessageCircle size={14} /></button>
                    <button type="button" onClick={() => revoke(row.code)} title={t.cancel} className="rounded-lg border border-line bg-white p-2 text-danger hover:bg-danger-tint"><XCircle size={14} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
