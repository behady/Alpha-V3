"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Lock, QrCode, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { isAnyUnlocked, SUPPORT_WHATSAPP } from "@/lib/featureCatalog";
import { logActivity } from "@/lib/logger";
import { useAuth } from "@/context/AuthContext";

/**
 * Setup step: connect the clinic's own WhatsApp number by scanning a QR.
 *
 * The same two routes Settings → WhatsApp uses (`/api/admin/wapilot-config` for "is anything
 * connected already?", `/api/admin/wapilot-config/gateway` for the QR), so a number connected here
 * is exactly the number that screen shows. What this adds is the part a first-time owner actually
 * needs: which phone, which number, where the "Linked devices" menu is on Android versus iPhone,
 * and the three habits that keep an ordinary WhatsApp number from being restricted.
 *
 * Nothing here is required. With no gateway on the deployment, or no WhatsApp add-on on the plan,
 * the step says so and the wizard moves on.
 */

type Gateway = {
  available: boolean;
  managed: boolean;
  state?: string;
  phone?: string | null;
  qr?: string | null;
};

/**
 * States in which something is about to change on its own, so the card keeps asking. `closed` is
 * here because the gateway passes through it right after a scan (WhatsApp's "restart required").
 */
const LIVE_STATES = new Set(["qr", "connecting", "logged_out", "starting", "closed"]);

async function authedFetch(url: string, init?: RequestInit) {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  const idToken = await u.getIdToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && data.ok === true, data };
}

function readGateway(d: Record<string, unknown>): Gateway {
  return {
    available: d.available === true,
    managed: d.managed === true,
    state: typeof d.state === "string" ? d.state : undefined,
    phone: typeof d.phone === "string" ? d.phone : null,
    qr: typeof d.qr === "string" ? d.qr : null,
  };
}

export default function WhatsAppConnectStep({ onConnectedChange }: { onConnectedChange?: (connected: boolean) => void }) {
  const { clinic, clinicId } = useClinic();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";
  const inPlan = isAnyUnlocked(clinic, ["whatsappIntegration", "whatsappBot"]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState<Gateway | null>(null);
  /** Connected some other way — the clinic's own Wapilot account. */
  const [viaWapilot, setViaWapilot] = useState<string | null>(null);
  const [phoneKind, setPhoneKind] = useState<"android" | "iphone">("android");

  const t = {
    intro: ar
      ? "وصّل رقم واتساب العيادة بالسيستم، زي ما بتفتح واتساب ويب بالظبط. بعد كده التأكيدات والتذكيرات وردود البوت بتطلع من رقم العيادة نفسه."
      : "Link the clinic's WhatsApp number to the system, exactly like opening WhatsApp Web. Confirmations, reminders and bot replies then go out from the clinic's own number.",
    before: ar ? "قبل ما تمسح" : "Before you scan",
    tip1: ar
      ? "استخدم رقم العيادة، مش رقمك الشخصي — ويفضّل على تطبيق WhatsApp Business."
      : "Use the clinic's number, not your personal one — ideally on the WhatsApp Business app.",
    tip2: ar
      ? "الأفضل رقم شغال على واتساب من فترة. الأرقام الجديدة خالص ممكن واتساب يقيّدها لو بعتت كتير من أول يوم."
      : "A number that has been on WhatsApp for a while is best. Brand-new numbers can be restricted if they send a lot on day one.",
    tip3: ar
      ? "خلي الموبايل ده مشحون وعليه نت، وافتح واتساب عليه مرة على الأقل كل أسبوعين — وإلا الربط بيفصل لوحده."
      : "Keep that phone charged and online, and open WhatsApp on it at least once every two weeks — otherwise the link drops on its own.",
    connect: ar ? "اعرض كود QR" : "Show the QR code",
    howTo: ar ? "إزاي تمسح الكود" : "How to scan it",
    android: "Android",
    iphone: "iPhone",
    stepsAndroid: ar
      ? ["افتح واتساب على موبايل العيادة", "اضغط على التلات نقط ⋮ فوق", "اختار «الأجهزة المرتبطة»", "اضغط «ربط جهاز» ووجّه الكاميرا على الكود"]
      : ["Open WhatsApp on the clinic's phone", "Tap the three dots ⋮ at the top", "Choose Linked devices", "Tap Link a device and point the camera at the code"],
    stepsIphone: ar
      ? ["افتح واتساب على موبايل العيادة", "ادخل «الإعدادات» تحت", "اختار «الأجهزة المرتبطة»", "اضغط «ربط جهاز» ووجّه الكاميرا على الكود"]
      : ["Open WhatsApp on the clinic's phone", "Go to Settings at the bottom", "Choose Linked Devices", "Tap Link a Device and point the camera at the code"],
    refreshes: ar ? "الكود بيتجدد لوحده كل كام ثانية — مفيش مشكلة لو اتأخرت شوية." : "The code refreshes itself every few seconds — no rush.",
    waiting: ar ? "جاري التجهيز…" : "Getting ready…",
    expired: ar ? "الكود انتهى قبل ما حد يمسحه." : "The code expired before anyone scanned it.",
    newQr: ar ? "كود جديد" : "New code",
    connected: ar ? "واتساب العيادة متوصّل" : "The clinic's WhatsApp is connected",
    connectedHint: ar
      ? "تقدر تقفل الصفحة دي عادي. الموبايل مش لازم يفضل فاتح واتساب، بس لازم يفضل عليه نت."
      : "You can leave this page. The phone does not need WhatsApp open, but it does need to stay online.",
    wapilot: ar ? "العيادة متوصّلة بالفعل عن طريق Wapilot" : "This clinic is already connected through Wapilot",
    restricted: ar
      ? "الإرسال متوقف مؤقتاً — واتساب فصل الرقم أكتر من مرة. افتح واتساب على الموبايل واتأكد إن مفيش تحذير، وبعدين كمّل من الإعدادات ← واتساب."
      : "Sending is paused — WhatsApp logged this number out more than once. Check WhatsApp on the phone for a warning, then continue from Settings → WhatsApp.",
    notAvailable: ar
      ? "الربط بمسح QR مش متاح على النسخة دي. تقدر توصّل بعدين من الإعدادات ← واتساب."
      : "QR linking isn't available on this installation. You can connect later from Settings → WhatsApp.",
    locked: ar
      ? "رسائل واتساب مش ضمن باقة العيادة. كلّمنا على واتساب وإحنا نفعّلها:"
      : "WhatsApp messages aren't in this clinic's plan. Message us and we'll switch it on:",
    openSettings: ar ? "الإعدادات ← واتساب" : "Settings → WhatsApp",
    failed: ar ? "حصلت مشكلة. جرّب تاني." : "Something went wrong. Try again.",
  };

  const load = useCallback(async () => {
    try {
      const q = `?clinicId=${encodeURIComponent(clinicId ?? "")}`;
      const [gw, cfg] = await Promise.all([
        authedFetch(`/api/admin/wapilot-config/gateway${q}`),
        authedFetch(`/api/admin/wapilot-config${q}`),
      ]);
      const g = gw.ok ? readGateway(gw.data) : { available: false, managed: false };
      setGateway(g);
      // "clinic" means this clinic has its own credentials; when they are not ours, it is Wapilot.
      const ownCreds = cfg.ok && cfg.data.configured === true && cfg.data.source === "clinic";
      setViaWapilot(ownCreds && !g.managed ? String(cfg.data.connectedPhoneHint || "") || "✓" : null);
    } catch {
      setGateway((g) => g ?? { available: false, managed: false });
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId) return;
    void load();
  }, [clinicId, load]);

  const connected = gateway?.state === "open" || viaWapilot !== null;
  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  // A QR rotates every ~20 s and the state flips the moment the phone scans it, so while one is
  // on screen the card asks again every few seconds. Parked states (expired, restricted, missing)
  // wait for a person to press something instead.
  useEffect(() => {
    if (!gateway?.managed || !gateway.state || !LIVE_STATES.has(gateway.state)) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [gateway?.managed, gateway?.state, load]);

  const act = async (action: "connect" | "relink") => {
    setBusy(true);
    try {
      const res = await authedFetch("/api/admin/wapilot-config/gateway", {
        method: "POST",
        body: JSON.stringify({ clinicId, action }),
      });
      if (!res.ok) throw new Error(typeof res.data.error === "string" ? res.data.error : t.failed);
      setGateway(readGateway(res.data));
      await logActivity({ uid: user?.uid, name: user?.name, role: user?.role }, `WhatsApp gateway: ${action} (setup)`, "settings/wapilot");
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.failed, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!clinicId || loading) {
    return (
      <div className="flex items-center gap-2 text-sm font-bold text-ink-muted py-6">
        <Loader2 size={16} className="animate-spin" /> {t.waiting}
      </div>
    );
  }

  if (!inPlan) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3">
        <Lock size={15} className="text-ink-muted" /> {t.locked}
        <a href={`https://wa.me/${SUPPORT_WHATSAPP.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="underline" dir="ltr">
          {SUPPORT_WHATSAPP}
        </a>
      </p>
    );
  }

  if (viaWapilot !== null) {
    return <Done text={t.wapilot} hint={viaWapilot !== "✓" ? viaWapilot : undefined} />;
  }

  if (!gateway?.available) {
    return (
      <p className="text-sm font-medium text-ink-body bg-surface-subtle border border-line rounded-xl px-4 py-3">
        {t.notAvailable}{" "}
        <Link href="/settings/whatsapp" className="font-bold underline">{t.openSettings}</Link>
      </p>
    );
  }

  if (gateway.state === "open") {
    return <Done text={t.connected} hint={`${gateway.phone ? `+${gateway.phone} · ` : ""}${t.connectedHint}`} />;
  }

  const steps = phoneKind === "android" ? t.stepsAndroid : t.stepsIphone;

  return (
    <div className="space-y-5">
      <p className="text-sm font-medium text-ink-body leading-relaxed">{t.intro}</p>

      {/* The three habits, before the button: once a QR is up nobody reads anything else. */}
      {!gateway.managed && (
        <div className="rounded-2xl border border-line bg-surface-subtle p-4">
          <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-ink-muted mb-2">
            <ShieldCheck size={14} /> {t.before}
          </p>
          <ul className="space-y-1.5 text-sm text-ink-body leading-relaxed list-disc ps-5">
            <li>{t.tip1}</li>
            <li>{t.tip2}</li>
            <li>{t.tip3}</li>
          </ul>
        </div>
      )}

      {gateway.state === "restricted" ? (
        <p className="text-sm text-danger bg-danger/5 border border-danger/25 rounded-xl px-4 py-3 leading-relaxed">
          {t.restricted}{" "}
          <Link href="/settings/whatsapp" className="font-bold underline">{t.openSettings}</Link>
        </p>
      ) : !gateway.managed || gateway.state === "missing" || gateway.state === "qr_expired" ? (
        <div className="space-y-2">
          {gateway.state === "qr_expired" && <p className="text-sm font-bold text-warn">{t.expired}</p>}
          <button
            type="button"
            onClick={() => void act("connect")}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-ink-slab text-white text-sm font-black hover:bg-ink disabled:opacity-50 transition-all"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
            {t.connect}
          </button>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row md:items-start gap-6">
          <div className="shrink-0 mx-auto md:mx-0 text-center">
            {gateway.state === "qr" && gateway.qr ? (
              // A data URL that changes every few seconds; next/image has nothing to optimise here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={gateway.qr} alt="WhatsApp QR" width={240} height={240} className="rounded-2xl border border-line bg-white p-2" />
            ) : (
              <div className="w-[240px] h-[240px] rounded-2xl border border-line bg-surface-subtle flex items-center justify-center text-ink-muted">
                <Loader2 size={22} className="animate-spin" />
              </div>
            )}
            <button
              type="button"
              onClick={() => void act("relink")}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-ink-muted hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={12} /> {t.newQr}
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="flex items-center gap-2 text-sm font-black text-ink">
              <Smartphone size={16} /> {t.howTo}
            </p>
            <div className="inline-flex rounded-xl border border-line p-1 bg-surface-subtle" role="tablist">
              {(["android", "iphone"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={phoneKind === k}
                  onClick={() => setPhoneKind(k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-colors ${phoneKind === k ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink"}`}
                >
                  {k === "android" ? t.android : t.iphone}
                </button>
              ))}
            </div>
            <ol className="text-sm text-ink-body leading-relaxed list-decimal ps-5 space-y-1.5">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="text-xs font-medium text-ink-muted">{t.refreshes}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Done({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
      <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-black text-emerald-800">{text}</p>
        {hint && <p className="text-xs font-medium text-emerald-700 mt-0.5" dir="auto">{hint}</p>}
      </div>
    </div>
  );
}
