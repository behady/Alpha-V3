"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Plug,
  PlugZap,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import type { SettingsPanelProps } from "@/components/settings/panels";

/**
 * "Connect your AI assistant" — where a clinic issues a key to Claude or any other MCP client.
 *
 * The owner pastes two things into his assistant: the address of /api/mcp, and a key minted
 * here. From then on he can ask his own assistant about his own clinic, in his own words, on his
 * phone. Nothing about the conversation passes through this screen; it only hands out the key.
 *
 * Two pieces of the design are load-bearing rather than cosmetic:
 *
 *   1. **The secret is shown once.** Only its hash is stored, so there is no second chance to
 *      copy it and no support route that can recover it. The screen says so before the key is
 *      created, not after, because "I closed the box" is otherwise a guaranteed support call.
 *
 *   2. **Write access is a separate, deliberate choice**, with its own warning. A read key
 *      answers questions; a write key can book, charge and delete in the live clinic on the
 *      strength of something an assistant inferred from a sentence.
 */

type KeyRow = {
  id: string;
  label: string;
  scope: "read" | "full";
  createdAtMs: number;
  createdByName: string;
  lastUsedAtMs: number | null;
  revokedAtMs: number | null;
};

const COPY = {
  en: {
    title: "Connect your AI assistant",
    lead: "Give Claude — or any assistant that supports connectors — a key to this clinic. You can then ask it about your patients, appointments, money and staff in your own words, from your phone.",
    address: "Connection address",
    addressHint: "Paste this into your assistant's connector settings, then it will ask for the key.",
    newKey: "Create a new key",
    label: "What is this key for?",
    labelPlaceholder: "e.g. My phone — Claude",
    access: "Access",
    read: "Read only — answers questions",
    full: "Full — can also change and delete records",
    fullWarning:
      "A full-access key lets the assistant create, change and delete real records in this clinic. There is no undo. Only choose this if you understand that.",
    create: "Create key",
    creating: "Creating…",
    linkTitle: "Paste this whole link into Claude — shown only once",
    linkBody: "In Claude: Settings → Connectors → Add custom connector, and paste this as the URL. Your key is already part of it.",
    onceTitle: "Or, if your assistant asks for the key on its own",
    onceBody: "We store only a scrambled copy, so this exact text cannot be shown again. If you lose it, delete the key and make a new one.",
    copy: "Copy",
    copyLink: "Copy link",
    copied: "Copied",
    existing: "Keys in use",
    none: "No keys yet.",
    refresh: "Refresh",
    never: "never used",
    lastUsed: "last used",
    revoke: "Delete",
    revokeConfirm: "Delete this key? Any assistant using it loses access immediately.",
    revoked: "Key deleted.",
    failed: "Something went wrong. Try again.",
    actsAs: "Acts as you",
    actsAsBody: "A key can only see what your own account can see. If you cannot open the finance screen, neither can the assistant.",
    privacy: "Your clinic's data leaves this system",
    privacyBody: "When you ask your assistant a question, the answer travels to that company's servers (Anthropic, OpenAI, Google) to be read by their model. That is how these assistants work. Only connect one if you are comfortable with that for your patients' data.",
  },
  ar: {
    title: "اربط المساعد الذكي بتاعك",
    lead: "ادِّي Claude — أو أي مساعد بيدعم الربط — مفتاح للعيادة دي. بعدها تقدر تسأله عن المرضى والمواعيد والفلوس والموظفين بكلامك العادي، من موبايلك.",
    address: "عنوان الربط",
    addressHint: "الصق العنوان ده في إعدادات الربط عند المساعد، وبعدين هيطلب منك المفتاح.",
    newKey: "اعمل مفتاح جديد",
    label: "المفتاح ده لإيه؟",
    labelPlaceholder: "مثال: موبايلي — Claude",
    access: "الصلاحية",
    read: "قراءة فقط — يرد على الأسئلة",
    full: "كاملة — يقدر كمان يعدّل ويمسح",
    fullWarning:
      "المفتاح الكامل بيخلي المساعد يقدر يضيف ويعدّل ويمسح بيانات حقيقية في العيادة. مفيش تراجع. اختاره بس لو ده مفهوم.",
    create: "اعمل المفتاح",
    creating: "بيتعمل…",
    linkTitle: "الصق اللينك ده كله في Claude — هيظهر مرة واحدة بس",
    linkBody: "في Claude: Settings ← Connectors ← Add custom connector، والصق ده كـ URL. المفتاح جواه خلاص.",
    onceTitle: "أو لو المساعد بيطلب المفتاح لوحده",
    onceBody: "إحنا بنخزّن نسخة مشفّرة بس، يعني النص ده مش هيتعرض تاني. لو ضاع منك، امسح المفتاح واعمل واحد جديد.",
    copy: "نسخ",
    copyLink: "نسخ اللينك",
    copied: "اتنسخ",
    existing: "المفاتيح المستخدمة",
    none: "مفيش مفاتيح لسه.",
    refresh: "تحديث",
    never: "لسه مااتستخدمش",
    lastUsed: "آخر استخدام",
    revoke: "مسح",
    revokeConfirm: "تمسح المفتاح ده؟ أي مساعد شغال بيه هيقف فورًا.",
    revoked: "اتمسح المفتاح.",
    failed: "حصلت مشكلة. جرّب تاني.",
    actsAs: "بيشتغل باسمك إنت",
    actsAsBody: "المفتاح مش بيشوف غير اللي حسابك إنت بيشوفه. لو مش بتفتح شاشة الحسابات، المساعد كمان مش هيشوفها.",
    privacy: "بيانات العيادة بتخرج من النظام",
    privacyBody: "لما تسأل المساعد سؤال، الإجابة بتروح لسيرفرات الشركة بتاعته (Anthropic أو OpenAI أو Google) عشان الموديل يقراها. دي طريقة شغل المساعدات دي. اربطه بس لو ده مريّحك بالنسبة لبيانات مرضاك.",
  },
} as const;

export default function AiConnectorSettings({ canEdit }: SettingsPanelProps) {
  const { clinic } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";
  const t = COPY[isAr ? "ar" : "en"];

  const clinicId = clinic?.id ?? null;
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"read" | "full">("read");
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "link" | null>(null);

  // window is undefined during the server pass; the panel is ssr:false but the first client
  // render still happens before layout, so this is computed lazily rather than at module scope.
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => setEndpoint(`${window.location.origin}/api/mcp`), []);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/mcp-keys?clinicId=${encodeURIComponent(clinicId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setRows(Array.isArray(data.keys) ? data.keys : []);
    } catch {
      showToast(t.failed, "error");
    } finally {
      setLoading(false);
    }
  }, [clinicId, showToast, t.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!clinicId || creating) return;
    setCreating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/admin/mcp-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, label, scope }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "failed");
      setFreshSecret(data.secret as string);
      setLabel("");
      setCopied(null);
      void load();
    } catch {
      showToast(t.failed, "error");
    } finally {
      setCreating(false);
    }
  };

  const copyText = async (text: string, which: "key" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      showToast(t.failed, "error");
    }
  };

  const revoke = async (id: string) => {
    if (!clinicId) return;
    const yes = await confirm(t.revokeConfirm);
    if (!yes) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(
        `/api/admin/mcp-keys?clinicId=${encodeURIComponent(clinicId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("failed");
      showToast(t.revoked, "success");
      void load();
    } catch {
      showToast(t.failed, "error");
    }
  };

  const fmt = (ms: number | null) =>
    ms ? new Date(ms).toLocaleDateString(isAr ? "ar-EG" : "en-GB") : null;

  const live = rows.filter((r) => !r.revokedAtMs);

  return (
    <div className="space-y-5" dir={isRTL ? "rtl" : "ltr"}>
      <section className="rounded-[1.75rem] border border-line bg-surface p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-tint text-accent flex items-center justify-center shrink-0">
            <PlugZap size={18} />
          </div>
          <div>
            <h3 className="text-base font-black text-ink">{t.title}</h3>
            <p className="text-xs font-medium text-ink-muted leading-relaxed mt-0.5 max-w-xl">{t.lead}</p>
          </div>
        </div>

        <div>
          <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">
            {t.address}
          </span>
          <code
            className="block select-all break-all rounded-xl border border-line bg-surface-subtle px-4 py-3 font-figure text-sm text-ink"
            dir="ltr"
          >
            {endpoint || "…"}
          </code>
          <p className="text-xs font-medium text-ink-muted mt-2">{t.addressHint}</p>
        </div>
      </section>

      {canEdit && (
        <section className="rounded-[1.75rem] border border-line bg-surface p-5 sm:p-6 space-y-4">
          <p className="text-[11px] font-black text-ink-muted uppercase tracking-widest">{t.newKey}</p>

          <label className="block">
            <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">
              {t.label}
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t.labelPlaceholder}
              className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">
              {t.access}
            </legend>
            {(["read", "full"] as const).map((value) => (
              <label
                key={value}
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  scope === value ? "border-accent-soft bg-accent-tint" : "border-line bg-surface-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="mcp-scope"
                  value={value}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  className="mt-1"
                />
                <span className="text-sm font-bold text-ink">{value === "read" ? t.read : t.full}</span>
              </label>
            ))}
          </fieldset>

          {scope === "full" && (
            <p className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-tint p-3 text-xs font-bold text-danger leading-relaxed">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              {t.fullWarning}
            </p>
          )}

          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-ink-on-accent shadow-md transition-all hover:bg-accent-strong disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
            {creating ? t.creating : t.create}
          </button>

          {freshSecret && (
            <div className="rounded-2xl border border-ok/25 bg-ok-tint p-4 space-y-4">
              {/* The whole address first, because claude.ai's connector dialog asks for a URL and
                  offers nowhere to type a key. The bare key stays below for the clients that do. */}
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm font-bold text-ok">
                  <Check size={16} /> {t.linkTitle}
                </p>
                <code
                  className="block select-all break-all rounded-lg bg-white/70 px-3 py-2 font-figure text-sm text-ink"
                  dir="ltr"
                >
                  {`${endpoint}/${freshSecret}`}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText(`${endpoint}/${freshSecret}`, "link")}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-line px-4 py-2 text-sm font-bold text-ink hover:border-line-strong"
                >
                  {copied === "link" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "link" ? t.copied : t.copyLink}
                </button>
                <p className="text-xs font-medium text-ink-body leading-relaxed">{t.linkBody}</p>
              </div>

              <div className="space-y-2 border-t border-ok/20 pt-3">
                <p className="text-[11px] font-black text-ink-muted uppercase tracking-widest">
                  {t.onceTitle}
                </p>
                <code
                  className="block select-all break-all rounded-lg bg-white/70 px-3 py-2 font-figure text-sm text-ink"
                  dir="ltr"
                >
                  {freshSecret}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText(freshSecret, "key")}
                  className="inline-flex items-center gap-2 rounded-xl bg-white border border-line px-4 py-2 text-sm font-bold text-ink hover:border-line-strong"
                >
                  {copied === "key" ? <Check size={14} /> : <Copy size={14} />}
                  {copied === "key" ? t.copied : t.copy}
                </button>
              </div>

              <p className="text-xs font-medium text-ink-body leading-relaxed">{t.onceBody}</p>
            </div>
          )}
        </section>
      )}

      <section className="rounded-[1.75rem] border border-line bg-surface p-5 sm:p-6 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-black text-ink-muted uppercase tracking-widest">{t.existing}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-[11px] font-bold text-ink-muted hover:text-ink inline-flex items-center gap-1"
          >
            <RefreshCcw size={11} /> {t.refresh}
          </button>
        </div>

        {loading ? (
          <div className="py-4 flex justify-center">
            <Loader2 size={18} className="animate-spin text-ink-muted" />
          </div>
        ) : live.length === 0 ? (
          <p className="text-sm font-medium text-ink-muted">{t.none}</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line overflow-hidden">
            {live.map((row) => (
              <li
                key={row.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3 bg-surface-subtle"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-ink">
                    {row.label}
                    <span
                      className={`ms-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                        row.scope === "full" ? "bg-danger-tint text-danger" : "bg-surface-muted text-ink-body"
                      }`}
                    >
                      {row.scope === "full" ? t.full.split(" —")[0] : t.read.split(" —")[0]}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted font-medium">
                    {row.lastUsedAtMs ? `${t.lastUsed} ${fmt(row.lastUsedAtMs)}` : t.never}
                    {row.createdByName ? ` · ${row.createdByName}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void revoke(row.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-danger hover:border-danger/40"
                  >
                    <Trash2 size={13} /> {t.revoke}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[1.75rem] border border-line bg-surface-subtle p-5 sm:p-6 space-y-4">
        <div>
          <p className="text-sm font-black text-ink">{t.actsAs}</p>
          <p className="text-xs font-medium text-ink-muted leading-relaxed mt-1">{t.actsAsBody}</p>
        </div>
        <div>
          <p className="text-sm font-black text-ink">{t.privacy}</p>
          <p className="text-xs font-medium text-ink-muted leading-relaxed mt-1">{t.privacyBody}</p>
        </div>
      </section>
    </div>
  );
}
