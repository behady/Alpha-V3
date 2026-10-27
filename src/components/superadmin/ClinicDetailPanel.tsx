"use client";

// The clinic control drawer: everything the platform owner changes about one clinic.
import React, { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Save, X } from "lucide-react";
import { Clinic, SubscriptionTier } from "@/types/saas";
import { TIER_LIMITS, hasFeature } from "@/lib/subscriptions";
import { FEATURE_CATALOG, FEATURE_GROUPS, featureInfo, type FeatureKey } from "@/lib/featureCatalog";
import { useUI } from "@/context/UIContext";
import { TIERS, balanceOwed, extendedExpiry, monthlyValue, toDate, type ConsoleClinic } from "./clinicMath";
import { useSuperAdminText, type SAKey } from "./i18n";

interface ClinicDetailPanelProps {
  clinic: ConsoleClinic | null;
  users: any[];
  onClose: () => void;
  onUpdateClinic: (clinicId: string, updates: Partial<Clinic>) => Promise<void>;
  onDeleteClinic: (clinicId: string, clinicName: string) => void;
  onPlanChange: (clinic: ConsoleClinic, tier: SubscriptionTier) => Promise<void>;
}

const TIER_KEY: Record<SubscriptionTier, SAKey> = { "Free Trial": "tierFree", Basic: "tierBasic", Pro: "tierPro", Premium: "tierPremium" };
const STATUSES: { value: Clinic["status"]; label: SAKey }[] = [
  { value: "Active", label: "stActive" },
  { value: "Suspended", label: "stSuspended" },
  { value: "Expired", label: "stExpired" },
];

function inputDate(val: unknown): string {
  const d = toDate(val);
  if (!d) return "";
  return `${d.getFullYear().toString().padStart(4, "0")}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
}

/**
 * A number field that writes once, when it loses focus, instead of on every keystroke. Callers key
 * it on the saved value, so a change saved elsewhere replaces the draft.
 */
function NumberField({ label, value, onCommit }: { label: string; value: number | undefined; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  return (
    <label className="flex flex-col gap-1.5 text-xs text-ink-muted min-w-0">
      {label}
      <input
        type="number"
        min="0"
        inputMode="decimal"
        value={draft}
        placeholder="0"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseFloat(draft);
          const next = isNaN(n) ? 0 : n;
          if (next !== (value ?? 0)) onCommit(next);
        }}
        className="min-h-[40px] w-full rounded-xl border border-line-strong bg-surface px-3 text-sm font-figure text-ink outline-none focus:border-ink"
      />
    </label>
  );
}

const sectionTitle = "font-display text-xs font-bold uppercase tracking-[0.08em] text-ink-muted";
const chipBtn = "min-h-[36px] px-3 rounded-lg border border-line-strong bg-surface text-[13px] font-semibold text-ink hover:bg-surface-subtle";

export function ClinicDetailPanel({ clinic, users, onClose, onUpdateClinic, onDeleteClinic, onPlanChange }: ClinicDetailPanelProps) {
  const { t, num, money, date, isAr } = useSuperAdminText();
  const { prompt, showToast } = useUI();
  const [adminNotes, setAdminNotes] = useState(clinic?.adminNotes || "");
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!clinic) return null;

  const staff = users.filter((u) => u.clinicRoles && u.clinicRoles[clinic.id]);
  const f = clinic.features || {};
  const start = toDate(clinic.createdAt);
  const end = toDate(clinic.expiresAt);
  const span = start && end ? Math.max(1, end.getTime() - start.getTime()) : 0;
  const remainingMs = (clinic.daysRemaining ?? 0) * 86_400_000;
  const elapsedPct = span ? Math.min(100, Math.max(0, ((span - remainingMs) / span) * 100)) : 0;
  const price = Number(clinic.customPrice) || 0;
  const paid = Number(clinic.amountPaid) || 0;
  const owed = balanceOwed(clinic);
  const aiLeft = Math.max(0, clinic.aiLimit - clinic.aiUsed);
  const aiPct = clinic.aiLimit > 0 ? Math.min(100, (clinic.aiUsed / clinic.aiLimit) * 100) : 0;
  const addonsOn = FEATURE_CATALOG.filter((x) => hasFeature(clinic, x.key)).length;

  // Flips what the clinic EFFECTIVELY has, not the raw override: a Premium clinic with no
  // override shows "on" from its tier, and the first click has to switch it off, not on again.
  const handleToggleFeature = async (feature: FeatureKey) => {
    await onUpdateClinic(clinic.id, { features: { ...f, [feature]: !hasFeature(clinic, feature) } });
  };

  const extend = (days: number) => onUpdateClinic(clinic.id, { expiresAt: extendedExpiry(clinic, days) });

  const recordPayment = async () => {
    const typed = await prompt(t("recordPaymentQ", { name: clinic.name }), { title: t("recordPayment"), placeholder: "0", confirmLabel: t("recordPayment"), required: true });
    if (typed === null) return;
    const amount = parseFloat(typed.replace(/[^\d.]/g, ""));
    if (!amount || amount <= 0) return;
    await onUpdateClinic(clinic.id, { amountPaid: paid + amount });
    showToast(t("paymentAdded"), "success");
  };

  const handleSaveNotes = async () => {
    setIsSaving(true);
    await onUpdateClinic(clinic.id, { adminNotes });
    setIsSaving(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clinic-drawer-title"
      className="fixed inset-y-0 end-0 w-full max-w-[520px] bg-surface shadow-2xl z-50 flex flex-col border-s border-line animate-in fade-in duration-200"
    >
      <header className="bg-ink-slab text-white px-6 py-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <span className="text-xs text-white/60 flex items-center gap-2">
              <span className="font-mono" dir="ltr">{clinic.id}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(clinic.id);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 text-white/80 hover:text-white"
              >
                {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {copied ? t("copied") : t("copyId")}
              </button>
            </span>
            <h2 id="clinic-drawer-title" className="font-display text-2xl font-bold leading-tight truncate" dir="auto">{clinic.name}</h2>
            <span className="text-[13px] text-white/60 truncate">
              {clinic.ownerEmail ? <span dir="ltr">{clinic.ownerEmail}</span> : t("noOwner")}
              {start && <> · {t("joined", { d: date(start) })}</>}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")} className="w-11 h-11 rounded-xl border border-white/15 flex items-center justify-center hover:bg-white/10 shrink-0">
            <X size={18} aria-hidden />
          </button>
        </div>
        <a
          href={`/?clinic=${clinic.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[44px] rounded-xl bg-accent text-ink-on-accent font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-accent-strong"
        >
          <ExternalLink size={16} aria-hidden /> {t("enterClinic")}
        </a>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-7">
        {/* Status */}
        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>{t("status")}</h3>
          <div role="group" aria-label={t("status")} className="grid grid-cols-3 gap-1.5 p-1 bg-surface-muted rounded-xl">
            {STATUSES.map((s) => {
              const on = clinic.status === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => !on && onUpdateClinic(clinic.id, { status: s.value })}
                  className={`min-h-[40px] rounded-lg text-[13px] font-semibold ${on ? (s.value === "Active" ? "bg-ok text-white" : s.value === "Suspended" ? "bg-ink-slab text-white" : "bg-danger text-white") : "text-ink-body hover:bg-surface"}`}
                >
                  {t(s.label)}
                </button>
              );
            })}
          </div>
        </section>

        {/* Subscription */}
        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>{t("subscription")}</h3>
          <div role="group" aria-label={t("plan")} className="grid grid-cols-4 gap-1.5 p-1 bg-surface-muted rounded-xl">
            {TIERS.map((x) => {
              const on = clinic.subscriptionTier === x;
              return (
                <button
                  key={x}
                  type="button"
                  aria-pressed={on}
                  onClick={() => !on && onPlanChange(clinic, x)}
                  className={`min-h-[40px] rounded-lg text-[13px] font-semibold ${on ? "bg-ink-slab text-white" : "text-ink-body hover:bg-surface"}`}
                >
                  {t(TIER_KEY[x])}
                </button>
              );
            })}
          </div>
          <div className="border border-line rounded-2xl p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
                {t("started")}
                <input
                  type="date"
                  min="2020-01-01"
                  value={inputDate(clinic.createdAt)}
                  onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) onUpdateClinic(clinic.id, { createdAt: d }); }}
                  className="min-h-[40px] rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-ink"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
                {t("ends")}
                <input
                  type="date"
                  min="2020-01-01"
                  value={inputDate(clinic.expiresAt)}
                  onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) onUpdateClinic(clinic.id, { expiresAt: d }); }}
                  className="min-h-[40px] rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-ink"
                />
              </label>
            </div>
            {span > 0 && (
              <div className="h-2 rounded-full bg-surface-muted overflow-hidden" aria-hidden>
                <div className={`h-full ${(clinic.daysRemaining ?? 99) <= 7 ? "bg-danger" : "bg-ink-slab"}`} style={{ width: `${elapsedPct}%` }} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] text-ink-muted me-1">{t("extend")}</span>
              <button type="button" className={chipBtn} onClick={() => extend(7)}>{t("plus7")}</button>
              <button type="button" className={chipBtn} onClick={() => extend(14)}>{t("plus14")}</button>
              <button type="button" className={chipBtn} onClick={() => extend(30)}>{t("plus1m")}</button>
              <button type="button" className={chipBtn} onClick={() => extend(365)}>{t("plus1y")}</button>
            </div>
          </div>
        </section>

        {/* Billing */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline">
            <h3 className={`${sectionTitle} flex-1`}>{t("billing")}</h3>
            <button type="button" onClick={recordPayment} className="text-[13px] font-semibold text-ink underline underline-offset-4">{t("recordPayment")}</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-ink-muted min-w-0">
              {t("cycle")}
              <select
                value={clinic.billingCycle || "Monthly"}
                onChange={(e) => onUpdateClinic(clinic.id, { billingCycle: e.target.value as "Monthly" | "Yearly" | "2-Yearly" })}
                className="min-h-[40px] w-full rounded-xl border border-line-strong bg-surface px-2 text-sm text-ink outline-none focus:border-ink"
              >
                <option value="Monthly">{t("monthly")}</option>
                <option value="Yearly">{t("yearly")}</option>
                <option value="2-Yearly">{t("twoYearly")}</option>
              </select>
            </label>
            <NumberField key={`p${clinic.customPrice}`} label={t("agreedPrice")} value={clinic.customPrice} onCommit={(n) => onUpdateClinic(clinic.id, { customPrice: n })} />
            <NumberField key={`a${clinic.amountPaid}`} label={t("paid")} value={clinic.amountPaid} onCommit={(n) => onUpdateClinic(clinic.id, { amountPaid: n })} />
          </div>
          <div className="rounded-2xl bg-surface-subtle border border-line px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-[13px] text-ink-muted">{t("perMonth", { n: money(monthlyValue(clinic)) })}</span>
            {price > 0 && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${owed > 0 ? "bg-warn-tint text-warn" : "bg-ok-tint text-ok"}`}>
                {owed > 0 ? t("owed", { n: money(owed) }) : t("fullyPaid")}
              </span>
            )}
          </div>
        </section>

        {/* AI credits */}
        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>{t("aiCredits")}</h3>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-figure text-4xl font-semibold leading-none text-ink">{num(aiLeft)}</span>
            <span className="text-sm text-ink-muted">{t("aiLeft", { n: num(clinic.aiLimit) })} · {t("aiUsedOf", { used: num(clinic.aiUsed) })}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-muted overflow-hidden" aria-hidden>
            <div className={`h-full ${aiPct >= 90 ? "bg-danger" : "bg-ink-slab"}`} style={{ width: `${aiPct}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-ink-muted me-1">{t("topUp")}</span>
            {[250, 500, 1000].map((n) => (
              <button
                key={n}
                type="button"
                className={chipBtn}
                onClick={() => onUpdateClinic(clinic.id, { features: { ...f, extraAiCredits: (f.extraAiCredits || 0) + n } })}
              >
                +{num(n)}
              </button>
            ))}
            {(f.extraAiCredits || 0) > 0 && (
              <button type="button" className="min-h-[36px] px-2 text-[13px] text-ink-muted underline underline-offset-4" onClick={() => onUpdateClinic(clinic.id, { features: { ...f, extraAiCredits: 0 } })}>
                {t("resetBonus")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <NumberField
              key={`b${f.aiMonthlyCredits}`}
              label={t("baseCredits")}
              value={f.aiMonthlyCredits ?? (TIER_LIMITS[clinic.subscriptionTier || "Free Trial"]?.aiMonthlyCredits || 0)}
              onCommit={(n) => onUpdateClinic(clinic.id, { features: { ...f, aiMonthlyCredits: n } })}
            />
            <span className="text-xs text-ink-muted pb-2.5">
              {t("bonus", { n: num(f.extraAiCredits || 0) })} · {t("creditsNote")}
            </span>
          </div>
        </section>

        {/* Add-ons */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline">
            <h3 className={`${sectionTitle} flex-1`}>{t("addons")}</h3>
            <span className="text-[13px] text-ink-muted">{t("addonsOn", { n: num(addonsOn), total: num(FEATURE_CATALOG.length) })}</span>
          </div>
          {FEATURE_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-1.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint px-1">{isAr ? group.labelAr : group.labelEn}</p>
              <div className="border border-line rounded-2xl divide-y divide-line">
                {FEATURE_CATALOG.filter((x) => x.group === group.id).map((x) => {
                  const on = hasFeature(clinic, x.key);
                  const parentOff = !!x.requires && !hasFeature(clinic, x.requires);
                  const overridden = typeof f[x.key] === "boolean";
                  return (
                    <div key={x.key} className={`flex items-center gap-3 px-4 py-3 ${parentOff ? "opacity-60" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-ink">{isAr ? x.labelAr : x.labelEn}</span>
                          {!overridden && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint border border-line rounded px-1">{t("fromTier")}</span>
                          )}
                        </div>
                        <p className="text-xs text-ink-muted leading-snug">
                          {isAr ? x.descAr : x.descEn}
                          {parentOff && (
                            <span className="text-warn font-semibold"> — {t("needs", { x: isAr ? featureInfo(x.requires!).labelAr : featureInfo(x.requires!).labelEn })}</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${isAr ? x.labelAr : x.labelEn}: ${on ? t("switchOff") : t("switchOn")}`}
                        onClick={() => handleToggleFeature(x.key)}
                        className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${on ? "bg-ink-slab" : "bg-line-strong"}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-surface shadow transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* Staff */}
        <section className="flex flex-col gap-3">
          <h3 className={sectionTitle}>{t("staff")} · <span className="font-figure">{num(staff.length)}</span></h3>
          <div className="border border-line rounded-2xl divide-y divide-line">
            {staff.length === 0 ? (
              <p className="p-4 text-sm text-ink-muted text-center">{t("noStaff")}</p>
            ) : (
              staff.map((member) => (
                <div key={member.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-ink truncate" dir="auto">{member.name || "—"}</div>
                    <div className="text-xs text-ink-muted truncate" dir="ltr">{member.email}</div>
                  </div>
                  <span className="px-2 py-1 bg-surface-muted text-ink-body rounded-md text-xs font-semibold">{member.clinicRoles[clinic.id]}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Notes */}
        <section className="flex flex-col gap-2">
          <label htmlFor="admin-notes" className={sectionTitle}>{t("notes")}</label>
          <textarea
            id="admin-notes"
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder={t("notesPh")}
            dir="auto"
            className="w-full h-28 rounded-2xl border border-line-strong bg-surface p-3 text-sm text-ink outline-none focus:border-ink resize-none"
          />
          <button
            type="button"
            onClick={handleSaveNotes}
            disabled={isSaving || adminNotes === (clinic.adminNotes || "")}
            className="self-start min-h-[40px] px-4 rounded-xl bg-ink-slab text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40"
          >
            <Save size={15} aria-hidden /> {isSaving ? t("saving") : t("saveNotes")}
          </button>
        </section>

        {/* Careful */}
        <section className="rounded-2xl border border-danger/30 p-4 flex flex-col gap-3">
          <h3 className="font-display text-xs font-bold uppercase tracking-[0.08em] text-danger">{t("careful")}</h3>
          <div className="flex flex-wrap gap-2">
            {clinic.status === "Suspended" ? (
              <button type="button" onClick={() => onUpdateClinic(clinic.id, { status: "Active" })} className="min-h-[40px] px-4 rounded-xl border border-line-strong bg-surface text-sm font-semibold text-ink hover:bg-surface-subtle">
                {t("activateClinic")}
              </button>
            ) : (
              <button type="button" onClick={() => onUpdateClinic(clinic.id, { status: "Suspended" })} className="min-h-[40px] px-4 rounded-xl border border-line-strong bg-surface text-sm font-semibold text-ink hover:bg-surface-subtle">
                {t("suspendClinic")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onClose();
                onDeleteClinic(clinic.id, clinic.name);
              }}
              className="min-h-[40px] px-4 rounded-xl bg-danger text-white text-sm font-semibold hover:opacity-90"
            >
              {t("deleteClinic")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
