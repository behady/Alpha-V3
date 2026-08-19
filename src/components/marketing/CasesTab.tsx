"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SignatureCanvas from "react-signature-canvas";
import {
  Search, Loader2, X, Check, ShieldCheck, ShieldOff, Camera, Trash2, Eraser,
  ImagePlus, Images, Palette,
} from "lucide-react";
import CaseComposer from "@/components/marketing/CaseComposer";
import { onSnapshot, orderBy, query, getDocs } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { getClinicCollection } from "@/lib/db-utils";

/**
 * The case library — consented before/after material, collected the legal way around.
 *
 * The order is the feature: consent is SIGNED first (on this screen, on a phone or tablet
 * handed to the patient), and only then does the photo upload unlock. The API enforces the
 * same rule server-side, so this UI is a convenience, not the security boundary. Faces stay
 * off by default — the smile-crop policy from the original plan — and each patient's face
 * permission is an explicit extra switch on their consent.
 */

type Consent = {
  id: string;
  status: "granted" | "revoked";
  /** "signed" carries a signature image; "verbal" is a staff-recorded agreement. */
  method?: "signed" | "verbal";
  patientName?: string;
  faceAllowed?: boolean;
  signedAt?: unknown;
};

export type MarketingCase = {
  id: string;
  patientId: string;
  patientName: string;
  procedure: string;
  description?: string;
  beforeUrl: string;
  afterUrl: string;
  beforePath?: string;
  afterPath?: string;
  faceAllowed?: boolean;
  createdAt?: unknown;
};

/** Phone photos arrive at 3-12MB; the library never needs more than screen size. */
function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("read"));
    };
    img.src = url;
  });
}

export default function CasesTab({
  clinicId,
  isAr,
  isAdmin,
  services,
  userName,
  clinicName,
  logoUrl,
  designUnlocked,
  showToast,
}: {
  clinicId: string;
  isAr: boolean;
  isAdmin: boolean;
  services: string[];
  userName?: string;
  clinicName: string;
  logoUrl: string;
  designUnlocked: boolean;
  showToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [composing, setComposing] = useState<MarketingCase | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalTarget(document.body), []);

  /* ------- live data ------- */

  const [consents, setConsents] = useState<Map<string, Consent>>(new Map());
  const [cases, setCases] = useState<MarketingCase[]>([]);
  const [patients, setPatients] = useState<{ id: string; name: string; phone: string }[]>([]);

  useEffect(() => {
    const unsub1 = onSnapshot(getClinicCollection("marketing_consents"), (snap) => {
      const map = new Map<string, Consent>();
      snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() } as Consent));
      setConsents(map);
    });
    const q2 = query(getClinicCollection("marketing_cases"), orderBy("createdAt", "desc"));
    const unsub2 = onSnapshot(q2, (snap) =>
      setCases(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MarketingCase)))
    );
    getDocs(getClinicCollection("patients"))
      .then((snap) =>
        setPatients(
          snap.docs.map((d) => ({
            id: d.id,
            name: String((d.data() as any)?.name || ""),
            phone: String((d.data() as any)?.phone || (d.data() as any)?.phoneNumber || ""),
          }))
        )
      )
      .catch(() => setPatients([]));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const api = async (payload: Record<string, unknown>) => {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/marketing/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clinicId, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || (isAr ? "فشل الطلب." : "Request failed."));
    return data;
  };

  /* ------- patient selection ------- */

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return patients.filter((p) => p.name.toLowerCase().includes(q) || p.phone.includes(q)).slice(0, 6);
  }, [search, patients]);

  const consent = selected ? consents.get(selected.id) : undefined;
  const consentGranted = consent?.status === "granted";

  /* ------- consent modal ------- */

  const [consentOpen, setConsentOpen] = useState(false);
  const [faceAllowed, setFaceAllowed] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const sigRef = useRef<SignatureCanvas | null>(null);

  const saveConsent = async () => {
    if (!selected) return;
    setConsentSaving(true);
    try {
      // Signature optional: an empty pad records a verbal consent (still stamped who + when).
      const signed = sigRef.current && !sigRef.current.isEmpty();
      await api({
        action: "consent",
        patientId: selected.id,
        faceAllowed,
        signatureDataUrl: signed ? sigRef.current!.getTrimmedCanvas().toDataURL("image/png") : "",
      });
      setConsentOpen(false);
      showToast(
        signed
          ? isAr ? "تم تسجيل الموافقة الموقعة ✅" : "Signed consent recorded ✅"
          : isAr ? "تم تسجيل الموافقة الشفهية ✅" : "Verbal consent recorded ✅",
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setConsentSaving(false);
    }
  };

  const revokeConsent = async () => {
    if (!selected) return;
    try {
      await api({ action: "revoke", patientId: selected.id });
      showToast(isAr ? "تم سحب الموافقة — لن تظهر صور هذا المريض للتسويق" : "Consent revoked — this patient's photos are off-limits", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  /* ------- add case ------- */

  const [procedure, setProcedure] = useState("");
  const [description, setDescription] = useState("");
  const [beforeImg, setBeforeImg] = useState("");
  const [afterImg, setAfterImg] = useState("");
  const [caseSaving, setCaseSaving] = useState(false);

  const pickImage = async (which: "before" | "after", file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      (which === "before" ? setBeforeImg : setAfterImg)(dataUrl);
    } catch {
      showToast(isAr ? "تعذر قراءة الصورة" : "Could not read that image", "error");
    }
  };

  const saveCase = async () => {
    if (!selected || !beforeImg || !afterImg || !procedure) return;
    setCaseSaving(true);
    try {
      await api({
        action: "create_case",
        patientId: selected.id,
        procedure,
        description,
        beforeImage: beforeImg,
        afterImage: afterImg,
      });
      setBeforeImg("");
      setAfterImg("");
      setDescription("");
      showToast(isAr ? "أُضيفت الحالة للمكتبة 🎉" : "Case added to the library 🎉", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCaseSaving(false);
    }
  };

  const deleteCase = async (c: MarketingCase) => {
    try {
      await api({ action: "delete_case", caseId: c.id });
      showToast(isAr ? "حُذفت الحالة وصورها نهائياً" : "Case and its photos deleted", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const photoBox = (which: "before" | "after", img: string) => (
    <label className="flex-1 cursor-pointer">
      <input type="file" accept="image/*" className="hidden" onChange={(e) => void pickImage(which, e.target.files?.[0] || null)} />
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={which} className="w-full h-36 object-cover rounded-xl border border-slate-200" />
      ) : (
        <div className="h-36 rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-400 flex flex-col items-center justify-center gap-1.5 text-slate-400 transition-colors">
          <ImagePlus size={20} />
          <span className="text-xs font-black">
            {which === "before" ? (isAr ? "صورة قبل" : "Before photo") : isAr ? "صورة بعد" : "After photo"}
          </span>
        </div>
      )}
    </label>
  );

  return (
    <div className="space-y-5">
      {/* Patient + consent */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
            <ShieldCheck size={15} />
          </div>
          <h3 className="text-sm font-black text-slate-900">{isAr ? "الموافقة أولاً — ثم الصور" : "Consent first — then photos"}</h3>
        </div>
        <p className="text-[11px] font-bold text-slate-400 mb-4">
          {isAr
            ? "صور المريض لا تدخل مكتبة التسويق إلا بعد توقيعه على الموافقة — النظام يمنع ذلك تقنياً، لا شفهياً. الوجه لا يظهر إلا بإذن صريح."
            : "A patient's photos can't enter the marketing library until they sign the consent — the system enforces it, not good intentions. Faces appear only with explicit permission."}
        </p>

        <div className="relative mb-3">
          <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
            }}
            dir="auto"
            placeholder={isAr ? "ابحث عن المريض بالاسم أو الرقم…" : "Search patient by name or phone…"}
            className="w-full ps-9 pe-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
          />
        </div>
        {!selected && matches.length > 0 && (
          <div className="border border-slate-100 rounded-xl overflow-hidden mb-3">
            {matches.map((p) => {
              const c = consents.get(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelected({ id: p.id, name: p.name });
                    setSearch(p.name);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:bg-emerald-50 border-b border-slate-50 last:border-0"
                >
                  <span dir="auto">
                    {p.name} <span className="text-slate-400" dir="ltr">{p.phone}</span>
                  </span>
                  {c?.status === "granted" ? (
                    <span className="text-[10px] font-black text-emerald-600">{isAr ? "موافقة موقعة ✓" : "consented ✓"}</span>
                  ) : c?.status === "revoked" ? (
                    <span className="text-[10px] font-black text-rose-500">{isAr ? "موافقة مسحوبة" : "revoked"}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="border border-slate-100 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p dir="auto" className="text-sm font-black text-slate-900">{selected.name}</p>
                {consentGranted ? (
                  <p className="text-[11px] font-black text-emerald-600 flex items-center gap-1 mt-0.5">
                    <ShieldCheck size={12} />
                    {isAr
                      ? `موافقة ${consent?.method === "verbal" ? "شفهية" : "موقعة"}${consent?.faceAllowed ? " — الوجه مسموح" : " — بدون وجه (ابتسامة فقط)"}`
                      : `${consent?.method === "verbal" ? "Verbal" : "Signed"} consent${consent?.faceAllowed ? " — face allowed" : " — no face (smile only)"}`}
                  </p>
                ) : (
                  <p className="text-[11px] font-black text-slate-400 flex items-center gap-1 mt-0.5">
                    <ShieldOff size={12} />
                    {consent?.status === "revoked"
                      ? isAr ? "الموافقة مسحوبة" : "Consent revoked"
                      : isAr ? "لا توجد موافقة موقعة بعد" : "No signed consent yet"}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {consentGranted ? (
                  <button
                    onClick={() => void revokeConsent()}
                    className="px-3 py-2 rounded-xl bg-white border border-rose-100 hover:bg-rose-50 text-rose-500 text-xs font-black transition-colors"
                  >
                    {isAr ? "سحب الموافقة" : "Revoke consent"}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setFaceAllowed(false);
                      setConsentOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition-colors"
                  >
                    {isAr ? "تسجيل موافقة موقعة" : "Record signed consent"}
                  </button>
                )}
              </div>
            </div>

            {/* Add case — unlocked by consent */}
            {consentGranted && (
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                <div className="flex gap-3">
                  {photoBox("before", beforeImg)}
                  {photoBox("after", afterImg)}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <select
                    value={procedure}
                    onChange={(e) => setProcedure(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
                  >
                    <option value="">{isAr ? "— نوع الإجراء —" : "— procedure —"}</option>
                    {services.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    <option value="Other">{isAr ? "أخرى" : "Other"}</option>
                  </select>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    dir="auto"
                    maxLength={600}
                    placeholder={isAr ? "وصف قصير للحالة (اختياري)" : "Short case description (optional)"}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-emerald-400"
                  />
                </div>
                <button
                  onClick={() => void saveCase()}
                  disabled={caseSaving || !beforeImg || !afterImg || !procedure}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-50"
                >
                  {caseSaving ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                  {caseSaving ? (isAr ? "جارٍ الرفع…" : "Uploading…") : isAr ? "إضافة الحالة للمكتبة" : "Add case to library"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Case library */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center">
            <Images size={15} />
          </div>
          <h3 className="text-sm font-black text-slate-900">
            {isAr ? `مكتبة الحالات (${cases.length})` : `Case library (${cases.length})`}
          </h3>
        </div>
        {cases.length === 0 ? (
          <p className="text-xs font-bold text-slate-400 text-center py-6">
            {isAr
              ? "لا حالات بعد — أول موافقة موقعة تفتح الباب."
              : "No cases yet — the first signed consent opens the door."}
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cases.map((c) => (
              <div key={c.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="grid grid-cols-2">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.beforeUrl} alt="before" className="w-full h-32 object-cover" />
                    <span className="absolute bottom-1.5 start-1.5 text-[9px] font-black bg-slate-900/80 text-white px-1.5 py-0.5 rounded">
                      {isAr ? "قبل" : "BEFORE"}
                    </span>
                  </div>
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.afterUrl} alt="after" className="w-full h-32 object-cover" />
                    <span className="absolute bottom-1.5 start-1.5 text-[9px] font-black bg-emerald-600/90 text-white px-1.5 py-0.5 rounded">
                      {isAr ? "بعد" : "AFTER"}
                    </span>
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p dir="auto" className="text-xs font-black text-slate-800 truncate">{c.procedure}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {designUnlocked && (
                        <button
                          onClick={() => setComposing(c)}
                          title={isAr ? "تصميم بوست قبل/بعد" : "Design a before/after post"}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-[10px] font-black transition-colors"
                        >
                          <Palette size={12} /> {isAr ? "صمّمه" : "Design"}
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => void deleteCase(c)}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p dir="auto" className="text-[11px] font-bold text-slate-400 truncate">
                    {c.patientName}
                    {c.faceAllowed ? "" : isAr ? " · بدون وجه" : " · no face"}
                  </p>
                  {c.description && (
                    <p dir="auto" className="text-[11px] text-slate-500 mt-1 line-clamp-2">{c.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Before/after composer */}
      {composing && (
        <CaseComposer
          caseItem={composing}
          clinicId={clinicId}
          clinicName={clinicName}
          logoUrl={logoUrl}
          isAr={isAr}
          onClose={() => setComposing(null)}
        />
      )}

      {/* Consent signing modal */}
      {consentOpen && selected && portalTarget &&
        createPortal(
          <div className="fixed inset-0 z-[330] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="text-base font-black text-slate-900">
                  {isAr ? "موافقة استخدام الصور" : "Photo usage consent"}
                </h3>
                <button onClick={() => setConsentOpen(false)} className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500">
                  <X size={16} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4">
                {/* The consent text the patient reads before signing — hand them the device. */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-start">
                  <p dir="rtl" className="text-sm font-bold text-slate-800 leading-relaxed">
                    أوافق أنا <span className="font-black">{selected.name}</span> على استخدام صور أسناني
                    (قبل وبعد العلاج) في المواد التعريفية والدعائية للعيادة، بما يشمل وسائل التواصل
                    الاجتماعي والإعلانات. أعلم أنه يمكنني سحب هذه الموافقة في أي وقت بإبلاغ العيادة،
                    فتتوقف الاستخدامات الجديدة لصوري.
                  </p>
                  <p dir="ltr" className="text-[11px] font-bold text-slate-500 leading-relaxed mt-2">
                    I, {selected.name}, consent to the use of my dental photos (before and after
                    treatment) in the clinic&apos;s promotional materials, including social media and ads.
                    I may withdraw this consent at any time by informing the clinic.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3">
                  <div>
                    <p className="text-xs font-black text-slate-800">{isAr ? "ظهور الوجه في الصور" : "Face visible in photos"}</p>
                    <p className="text-[11px] font-bold text-slate-400">
                      {isAr ? "الافتراضي: الابتسامة فقط بدون وجه" : "Default: smile only, no face"}
                    </p>
                  </div>
                  <button
                    onClick={() => setFaceAllowed((v) => !v)}
                    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${faceAllowed ? "bg-emerald-500" : "bg-slate-200"}`}
                  >
                    <div
                      className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow transition-transform ${
                        faceAllowed ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-black text-slate-500">
                      {isAr ? "توقيع المريض (اختياري — اتركه فارغاً للموافقة الشفهية)" : "Patient signature (optional — leave empty for verbal consent)"}
                    </label>
                    <button
                      onClick={() => sigRef.current?.clear()}
                      className="flex items-center gap-1 text-[11px] font-black text-slate-400 hover:text-slate-600"
                    >
                      <Eraser size={12} /> {isAr ? "مسح" : "Clear"}
                    </button>
                  </div>
                  <div className="border-2 border-dashed border-slate-300 rounded-2xl overflow-hidden bg-white">
                    <SignatureCanvas
                      ref={sigRef}
                      penColor="#0f172a"
                      canvasProps={{ className: "w-full", style: { width: "100%", height: 160 } }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => void saveConsent()}
                  disabled={consentSaving}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm transition-colors disabled:opacity-60"
                >
                  {consentSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {isAr ? `حفظ الموافقة الموقعة${userName ? ` (بمعرفة ${userName})` : ""}` : `Save signed consent${userName ? ` (recorded by ${userName})` : ""}`}
                </button>
              </div>
            </div>
          </div>,
          portalTarget
        )}
    </div>
  );
}
