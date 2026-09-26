"use client";

/**
 * Settings → Receipt.
 *
 * The form on one side, the receipt on the other, redrawn from sample data with every keystroke.
 * A setting you cannot see the effect of is a setting people change by trial and error, print,
 * and change back — so the preview is not a nicety here, it is the screen.
 *
 * Saves the whole `settings/receipt` document (it has no other owner). The receipt NUMBER is not
 * on this screen: it is minted by the ledger API inside the payment's own transaction, and the
 * only thing here that touches it is the prefix.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDoc, onSnapshot, setDoc } from "firebase/firestore";
import {
  Check,
  ExternalLink,
  Loader2,
  Printer,
  RotateCcw,
  Save,
  type LucideIcon,
  Palette,
  ListChecks,
  Hash,
  Landmark,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicDoc } from "@/lib/db-utils";
import { getClinicLogo, type ClinicLogoAsset } from "@/lib/clinicLogo";
import { logActivity } from "@/lib/logger";
import { useSettingsDraft } from "@/lib/settingsDraft";
import { useSettingsText } from "@/lib/useSettingsText";
import {
  DEFAULT_RECEIPT_SETTINGS,
  RECEIPT_COUNTER_DOC,
  RECEIPT_SETTINGS_DOC,
  etaMissingFields,
  formatReceiptNumber,
  normalizeReceiptSettings,
  type ReceiptSettings,
  type ReceiptShowFlags,
} from "@/lib/receiptSettings";
import { buildDentalReceiptSrcDoc, downloadDentalReceiptPdf, sampleReceiptPayload } from "@/lib/receiptPdfHtml";

const FIELD =
  "w-full rounded-2xl border border-line bg-surface-subtle px-4 py-3 text-sm font-medium text-ink " +
  "outline-none transition-all focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const ACCENT_SWATCHES = ["#111827", "#0f766e", "#1d4ed8", "#7c3aed", "#b91c1c", "#b45309", "#374151"];

function Group({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 font-display text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
        <Icon size={13} className="opacity-70" />
        {title}
      </h3>
      <div className="space-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">{label}</span>
      {children}
      {hint && <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>}
    </label>
  );
}

/** A row of exclusive choices. Radios dressed as chips: one is always on. */
function Choice<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink-body hover:bg-surface-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-start text-sm font-medium text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span>{label}</span>
      <span
        className={`relative inline-flex h-[24px] w-[42px] shrink-0 items-center rounded-full transition-colors ${
          on ? "bg-accent" : "bg-surface-muted"
        }`}
      >
        <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? "start-[21px]" : "start-[3px]"}`} />
      </span>
    </button>
  );
}

type ClinicLetterhead = {
  clinicName: string;
  clinicPhone: string;
  clinicAddress: string;
  clinicEmail?: string;
  leadDoctorName?: string;
  currency?: string;
  logo?: ClinicLogoAsset;
};

export default function ReceiptHost({ canEdit }: { canEdit: boolean }) {
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const { user } = useAuth();
  const txt = useSettingsText("receipt");

  const [stored, setStored] = useState<ReceiptSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nextSeq, setNextSeq] = useState(1);
  const [letterhead, setLetterhead] = useState<ClinicLetterhead>({ clinicName: "", clinicPhone: "", clinicAddress: "" });
  const [previewKind, setPreviewKind] = useState<"payment" | "statement">("payment");

  useEffect(() => {
    const unsub = onSnapshot(
      getClinicDoc("settings", RECEIPT_SETTINGS_DOC),
      (snap) => {
        setStored(normalizeReceiptSettings(snap.exists() ? snap.data() : null));
        setLoaded(true);
      },
      () => setLoaded(true)
    );
    return () => unsub();
  }, []);

  // The letterhead and the counter are read once: they are shown, never edited here.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [infoSnap, counterSnap, logo] = await Promise.all([
        getDoc(getClinicDoc("settings", "clinic_info")).catch(() => null),
        getDoc(getClinicDoc("settings", RECEIPT_COUNTER_DOC)).catch(() => null),
        getClinicLogo(),
      ]);
      if (cancelled) return;
      const d = (infoSnap?.exists() ? infoSnap.data() : {}) as Record<string, unknown>;
      setLetterhead({
        clinicName:
          (typeof d.name === "string" && d.name.trim()) ||
          (typeof d.clinicName === "string" && d.clinicName.trim()) ||
          (language === "ar" ? "اسم العيادة" : "Your clinic"),
        clinicPhone: typeof d.phone === "string" ? d.phone : "",
        clinicAddress: typeof d.address === "string" ? d.address : "",
        clinicEmail: typeof d.email === "string" ? d.email : undefined,
        leadDoctorName: typeof d.doctorName === "string" ? d.doctorName : undefined,
        currency: typeof d.currency === "string" && d.currency.trim() ? d.currency : "EGP",
        logo,
      });
      const last = Number(counterSnap?.exists() ? counterSnap.data()?.last : 0) || 0;
      setNextSeq(last + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  const { value: form, setValue: setForm, isDirty, discard, markSaved } = useSettingsDraft<ReceiptSettings>(
    "receipt",
    stored,
    DEFAULT_RECEIPT_SETTINGS
  );

  const patch = useCallback(
    (next: Partial<ReceiptSettings>) => setForm((cur) => ({ ...cur, ...next })),
    [setForm]
  );
  const patchShow = useCallback(
    (key: keyof ReceiptShowFlags) => setForm((cur) => ({ ...cur, show: { ...cur.show, [key]: !cur.show[key] } })),
    [setForm]
  );
  const patchEta = useCallback(
    (next: Partial<ReceiptSettings["eta"]>) => setForm((cur) => ({ ...cur, eta: { ...cur.eta, ...next } })),
    [setForm]
  );
  const patchEtaAddress = useCallback(
    (next: Partial<ReceiptSettings["eta"]["address"]>) =>
      setForm((cur) => ({ ...cur, eta: { ...cur.eta, address: { ...cur.eta.address, ...next } } })),
    [setForm]
  );

  // The sample receipt, rebuilt from the draft. Cheap enough to do on every render of the form.
  const previewSrc = useMemo(
    () => buildDentalReceiptSrcDoc(sampleReceiptPayload(previewKind, letterhead), form),
    [form, letterhead, previewKind]
  );

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const { updatedAt: _drop, ...rest } = normalizeReceiptSettings(form);
      void _drop;
      await setDoc(getClinicDoc("settings", RECEIPT_SETTINGS_DOC), { ...rest, updatedAt: new Date().toISOString() });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Settings Updated",
        "Receipt settings were updated."
      );
      markSaved();
      showToast(txt.saved, "success");
    } catch (err) {
      console.error(err);
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const printTest = () => {
    void downloadDentalReceiptPdf(sampleReceiptPayload(previewKind, letterhead), form);
  };

  const missing = etaMissingFields(form);
  const numberExample = formatReceiptNumber(form, nextSeq);
  const thermal = form.template === "thermal";

  if (!loaded) {
    return <div className="h-40 animate-pulse rounded-3xl bg-surface-muted" aria-hidden="true" />;
  }

  return (
    <div className="space-y-8 animate-in fade-in">
      <div className="border-b border-line pb-6">
        <h2 className="text-xl font-bold text-ink">{txt.title}</h2>
        <p className="mt-1 max-w-2xl text-sm font-medium leading-relaxed text-ink-muted">{txt.subtitle}</p>
        {!canEdit && <p className="mt-3 text-xs font-semibold text-warn">{txt.readOnly}</p>}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------------------------ form */}
        <div className="space-y-8">
          <Group icon={Palette} title={txt.groupStyle}>
            <Field label={txt.template}>
              <Choice
                value={form.template}
                disabled={!canEdit}
                onChange={(template) =>
                  patch({ template, paper: template === "thermal" ? "thermal80" : form.paper === "thermal80" ? "a4" : form.paper })
                }
                options={[
                  { id: "classic", label: txt.templateClassic, hint: txt.templateClassicHint },
                  { id: "modern", label: txt.templateModern, hint: txt.templateModernHint },
                  { id: "minimal", label: txt.templateMinimal, hint: txt.templateMinimalHint },
                  { id: "thermal", label: txt.templateThermal, hint: txt.templateThermalHint },
                ]}
              />
            </Field>

            <Field label={txt.accent} hint={txt.accentHint}>
              <div className="flex flex-wrap items-center gap-2">
                {ACCENT_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    disabled={!canEdit}
                    onClick={() => patch({ accent: c })}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-transform disabled:cursor-not-allowed ${
                      form.accent === c ? "scale-110 border-ink" : "border-transparent hover:scale-105"
                    }`}
                    style={{ background: c }}
                  >
                    {form.accent === c && <Check size={14} className="text-white" />}
                  </button>
                ))}
                <input
                  type="color"
                  value={form.accent}
                  disabled={!canEdit}
                  onChange={(e) => patch({ accent: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded-lg border border-line bg-surface p-0.5 disabled:cursor-not-allowed"
                  aria-label={txt.accent}
                />
                <span className="text-xs font-mono text-ink-muted">{form.accent}</span>
              </div>
            </Field>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label={txt.font}>
                <Choice
                  value={form.font}
                  disabled={!canEdit}
                  onChange={(font) => patch({ font })}
                  options={[
                    { id: "tajawal", label: txt.fontTajawal },
                    { id: "cairo", label: txt.fontCairo },
                    { id: "noto-naskh", label: txt.fontNaskh },
                    { id: "ibm-plex", label: txt.fontPlex },
                  ]}
                />
              </Field>
              <Field label={txt.paper}>
                <Choice
                  value={form.paper}
                  disabled={!canEdit || thermal}
                  onChange={(paper) => patch({ paper })}
                  options={[
                    { id: "a4", label: txt.paperA4 },
                    { id: "a5", label: txt.paperA5 },
                    { id: "thermal80", label: txt.paperThermal },
                  ]}
                />
              </Field>
              <Field label={txt.language}>
                <Choice
                  value={form.language}
                  disabled={!canEdit}
                  onChange={(lang) => patch({ language: lang })}
                  options={[
                    { id: "ar", label: txt.langAr },
                    { id: "en", label: txt.langEn },
                    { id: "both", label: txt.langBoth },
                  ]}
                />
              </Field>
              <Field label={txt.logoSize} hint={txt.logoNote}>
                <Choice
                  value={form.logoSize}
                  disabled={!canEdit}
                  onChange={(logoSize) => patch({ logoSize })}
                  options={[
                    { id: "none", label: txt.logoNone },
                    { id: "small", label: txt.logoSmall },
                    { id: "medium", label: txt.logoMedium },
                    { id: "large", label: txt.logoLarge },
                  ]}
                />
              </Field>
            </div>

            <Field label={txt.headerNote}>
              <input
                className={FIELD}
                value={form.headerNote}
                disabled={!canEdit}
                maxLength={200}
                placeholder={txt.headerNotePlaceholder}
                onChange={(e) => patch({ headerNote: e.target.value })}
              />
            </Field>
            <Field label={txt.footerText}>
              <input
                className={FIELD}
                value={form.footerText}
                disabled={!canEdit}
                maxLength={300}
                placeholder={txt.footerPlaceholder}
                onChange={(e) => patch({ footerText: e.target.value })}
              />
            </Field>
          </Group>

          <Group icon={ListChecks} title={txt.groupContent}>
            {(
              [
                [txt.showClinicHeading, ["clinicPhone", "clinicAddress", "clinicEmail", "leadDoctor"]],
                [txt.showPatientHeading, ["patientPhone", "patientAddress", "patientAgeSex", "patientFileNumber"]],
                [txt.showItemsHeading, ["teeth", "pricingBreakdown", "doctorPerItem", "discounts", "paymentsHistory"]],
                [txt.showPaymentHeading, ["paymentMethod", "collectedBy", "chargeProgress", "accountBalance"]],
                [txt.showOtherHeading, ["signatureLine", "footer"]],
              ] as [string, (keyof ReceiptShowFlags)[]][]
            ).map(([heading, keys]) => (
              <div key={heading}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">{heading}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {keys.map((key) => (
                    <Toggle
                      key={key}
                      on={form.show[key]}
                      disabled={!canEdit}
                      onChange={() => patchShow(key)}
                      label={txt[`show${key[0].toUpperCase()}${key.slice(1)}` as keyof typeof txt]}
                    />
                  ))}
                </div>
              </div>
            ))}
          </Group>

          <Group icon={Hash} title={txt.groupNumbering}>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label={txt.numberPrefix} hint={txt.numberPrefixHint}>
                <input
                  className={`${FIELD} font-mono`}
                  dir="ltr"
                  value={form.numberPrefix}
                  disabled={!canEdit}
                  maxLength={12}
                  onChange={(e) => patch({ numberPrefix: e.target.value.replace(/\s/g, "") })}
                />
              </Field>
              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">{txt.numberExample}</span>
                <div className="rounded-2xl border border-dashed border-line bg-surface-subtle px-4 py-3 font-mono text-lg font-bold text-ink" dir="ltr">
                  {numberExample}
                </div>
              </div>
            </div>
            <Toggle on={form.numberIncludesYear} disabled={!canEdit} onChange={() => patch({ numberIncludesYear: !form.numberIncludesYear })} label={txt.numberIncludesYear} />
            <div>
              <Toggle on={form.autoPrintAfterPayment} disabled={!canEdit} onChange={() => patch({ autoPrintAfterPayment: !form.autoPrintAfterPayment })} label={txt.autoPrint} />
              <p className="px-2 text-xs leading-relaxed text-ink-muted">{txt.autoPrintHint}</p>
            </div>
          </Group>

          <Group icon={Landmark} title={txt.groupTax}>
            <p className="text-sm leading-relaxed text-ink-body">{txt.etaIntro}</p>
            <a
              href="https://www.eta.gov.eg/ar/ereceipt-inquiry"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              {txt.etaInquiry}
              <ExternalLink size={14} />
            </a>
            <div>
              <Toggle on={form.eta.enabled} disabled={!canEdit} onChange={() => patchEta({ enabled: !form.eta.enabled })} label={txt.etaEnabled} />
              <p className="px-2 text-xs leading-relaxed text-ink-muted">{txt.etaEnabledHint}</p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label={txt.rin} hint={txt.rinHint}>
                <input className={`${FIELD} font-mono`} dir="ltr" inputMode="numeric" value={form.eta.rin} disabled={!canEdit} maxLength={30} onChange={(e) => patchEta({ rin: e.target.value })} />
              </Field>
              <Field label={txt.tradeName}>
                <input className={FIELD} value={form.eta.companyTradeName} disabled={!canEdit} maxLength={200} onChange={(e) => patchEta({ companyTradeName: e.target.value })} />
              </Field>
              <Field label={txt.branchCode} hint={txt.branchCodeHint}>
                <input className={`${FIELD} font-mono`} dir="ltr" value={form.eta.branchCode} disabled={!canEdit} maxLength={50} onChange={(e) => patchEta({ branchCode: e.target.value })} />
              </Field>
              <Field label={txt.deviceSerial} hint={txt.deviceSerialHint}>
                <input className={`${FIELD} font-mono`} dir="ltr" value={form.eta.deviceSerialNumber} disabled={!canEdit} maxLength={100} onChange={(e) => patchEta({ deviceSerialNumber: e.target.value })} />
              </Field>
              <Field label={txt.activityCode} hint={txt.activityCodeHint}>
                <input className={`${FIELD} font-mono`} dir="ltr" value={form.eta.activityCode} disabled={!canEdit} maxLength={10} onChange={(e) => patchEta({ activityCode: e.target.value })} />
              </Field>
              <Field label={txt.syndicate}>
                <input className={`${FIELD} font-mono`} dir="ltr" value={form.eta.syndicateLicenseNumber} disabled={!canEdit} maxLength={30} onChange={(e) => patchEta({ syndicateLicenseNumber: e.target.value })} />
              </Field>
            </div>

            <Field label={txt.vat} hint={txt.vatHint}>
              <div className="flex flex-wrap items-center gap-3">
                <Choice
                  value={form.eta.vat}
                  disabled={!canEdit}
                  onChange={(vat) => patchEta({ vat })}
                  options={[
                    { id: "exempt", label: txt.vatExempt },
                    { id: "standard", label: txt.vatStandard },
                  ]}
                />
                {form.eta.vat === "standard" && (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    className={`${FIELD} w-28`}
                    aria-label={txt.vatRate}
                    value={form.eta.vatRate}
                    disabled={!canEdit}
                    onChange={(e) => patchEta({ vatRate: Number(e.target.value) })}
                  />
                )}
              </div>
            </Field>

            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">{txt.addressHeading}</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={txt.governate}>
                  <input className={FIELD} value={form.eta.address.governate} disabled={!canEdit} maxLength={100} onChange={(e) => patchEtaAddress({ governate: e.target.value })} />
                </Field>
                <Field label={txt.regionCity}>
                  <input className={FIELD} value={form.eta.address.regionCity} disabled={!canEdit} maxLength={100} onChange={(e) => patchEtaAddress({ regionCity: e.target.value })} />
                </Field>
                <Field label={txt.street}>
                  <input className={FIELD} value={form.eta.address.street} disabled={!canEdit} maxLength={200} onChange={(e) => patchEtaAddress({ street: e.target.value })} />
                </Field>
                <Field label={txt.buildingNumber}>
                  <input className={FIELD} value={form.eta.address.buildingNumber} disabled={!canEdit} maxLength={100} onChange={(e) => patchEtaAddress({ buildingNumber: e.target.value })} />
                </Field>
                <Field label={txt.postalCode}>
                  <input className={`${FIELD} font-mono`} dir="ltr" value={form.eta.address.postalCode} disabled={!canEdit} maxLength={30} onChange={(e) => patchEtaAddress({ postalCode: e.target.value })} />
                </Field>
              </div>
            </div>

            {form.eta.enabled && (
              <div
                className={`rounded-2xl px-4 py-3 text-xs font-semibold leading-relaxed ${
                  missing.length ? "bg-warn-tint text-warn" : "bg-ok-tint text-ok"
                }`}
              >
                {missing.length ? (
                  <>
                    {txt.etaMissing} <span className="font-mono">{missing.join(", ")}</span>
                  </>
                ) : (
                  txt.etaComplete
                )}
              </div>
            )}
          </Group>
        </div>

        {/* --------------------------------------------------------------- preview */}
        <div className="xl:sticky xl:top-24 xl:self-start">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">{txt.preview}</div>
              <div className="text-xs text-ink-muted">{txt.previewHint}</div>
            </div>
            <div className="flex items-center gap-2">
              <Choice
                value={previewKind}
                onChange={setPreviewKind}
                options={[
                  { id: "payment", label: txt.previewPayment },
                  { id: "statement", label: txt.previewStatement },
                ]}
              />
              <button
                type="button"
                onClick={printTest}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-bold text-ink hover:bg-surface-muted"
              >
                <Printer size={14} />
                {txt.printPreview}
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-[#e5e7eb] p-3 sm:p-5">
            <iframe
              title={txt.preview}
              srcDoc={previewSrc}
              sandbox="allow-same-origin"
              className="mx-auto block bg-white shadow-xl"
              style={{
                width: thermal ? "80mm" : form.paper === "a5" ? "148mm" : "210mm",
                maxWidth: "100%",
                height: thermal ? "560px" : "760px",
                border: 0,
              }}
            />
          </div>
        </div>
      </div>

      {/* Save bar: arrives when there is something to save. */}
      {canEdit && isDirty && (
        <div
          className={`sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-line bg-ink px-5 py-3 text-surface shadow-2xl ${
            isRTL ? "flex-row-reverse" : ""
          }`}
        >
          <span className="text-sm font-bold">{txt.unsaved}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-surface/80 hover:bg-white/10"
            >
              <RotateCcw size={14} />
              {txt.discard}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-black text-ink-on-accent hover:bg-accent-strong disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? txt.saving : txt.save}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
