"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { Loader2, Search, X, FlaskConical, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";
import { MoneyApiError, setProcedureLabFee } from "@/lib/moneyApi";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { localYmd } from "@/lib/clinicDate";
import { matchesTokenizedSubstring, patientMatchesSearch } from "@/lib/flexibleSearch";
import { findLab, labPriceFor, type DentalLab } from "@/lib/dentalLabs";
import {
  LAB_CASES_COLLECTION,
  ABUTMENT_OPTIONS,
  GUIDE_TYPE_OPTIONS,
  GUM_SHADE_SUGGESTIONS,
  LAB_WORK_TYPES,
  RETENTION_OPTIONS,
  TOOTH_SHADES,
  CERVICAL_SHADES,
  formatPalmer,
  parseToothInput,
  addDays,
  workTypeFor,
  type LabCase,
  type LabCaseSeed,
  type LabWorkTypeId,
} from "@/lib/labCases";
import { createLabCase, updateLabCase } from "@/lib/labCaseWrite";
import type { ClinicBranch } from "@/lib/clinicLocations";
import { branchCodeFor } from "@/lib/labCases";

type PatientLite = { id: string; name: string; phone?: string; fileId?: string };
type StaffLite = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when raising a new case. */
  existing?: LabCase | null;
  /** Prefill for a case raised straight off a saved treatment. */
  seed?: LabCaseSeed | null;
  labs: DentalLab[];
  branches: ClinicBranch[];
  defaultBranchId: string;
  currentUserName?: string;
  onSaved: (result: { id: string; code: string; isNew: boolean }) => void;
};

const INPUT =
  "w-full px-3 py-2.5 bg-surface border border-line rounded-xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all";
const LABEL = "block text-[11px] font-black uppercase tracking-wider text-ink-muted mb-1.5";



/** The part of a name that goes on paper. Handles "Dr. " prefixes and extra whitespace. */
function firstNameOf(full: string): string {
  const cleaned = String(full || "").replace(/^(dr\.?|د\.?|الدكتور)\s+/i, "").trim();
  return cleaned.split(/\s+/)[0] || cleaned;
}

export default function LabCaseModal({
  open,
  onClose,
  existing,
  seed,
  labs,
  branches,
  defaultBranchId,
  currentUserName,
  onSaved,
}: Props) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const isEdit = Boolean(existing);

  const [saving, setSaving] = useState(false);

  // --- form state ---------------------------------------------------------
  const [labId, setLabId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [workType, setWorkType] = useState<LabWorkTypeId>("zirconia");
  const [workDescription, setWorkDescription] = useState("");
  const [units, setUnits] = useState("");
  const [teethText, setTeethText] = useState("");
  const [bodyShade, setBodyShade] = useState("");
  const [cervicalShade, setCervicalShade] = useState("");
  const [gumShade, setGumShade] = useState("");
  const [material, setMaterial] = useState("");
  const [implantSystem, setImplantSystem] = useState("");
  const [implantPlatform, setImplantPlatform] = useState("");
  const [abutmentType, setAbutmentType] = useState("");
  const [retention, setRetention] = useState("");
  const [guideType, setGuideType] = useState("");
  const [sleeveSystem, setSleeveSystem] = useState("");
  const [notes, setNotes] = useState("");
  const [agreedPrice, setAgreedPrice] = useState("");
  const [sentVia, setSentVia] = useState<"driver" | "digital">("driver");
  const [needsTryIn, setNeedsTryIn] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [sendNow, setSendNow] = useState(true);

  // --- patient + doctor pickers -------------------------------------------
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [patientQuery, setPatientQuery] = useState("");
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [patientsLoaded, setPatientsLoaded] = useState(false);
  const [doctorId, setDoctorId] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [staff, setStaff] = useState<StaffLite[]>([]);

  const wt = workTypeFor(workType);

  /**
   * Implant systems this clinic has actually used, read back from past cases.
   *
   * The user pushed back on configuring a list of brands up front, and they were right to: an
   * implant crown needs the system named or the technician cannot pick a matching abutment, but
   * that is a fact the clinic already demonstrates every time it raises one. So the field learns.
   *
   * Loaded here rather than passed in, because this modal opens from two places — the lab board
   * and the prompt after a treatment is saved — and a datalist owned by one of them silently does
   * nothing in the other. Read only once an implant work type is actually picked, so the ninety
   * percent of orders that are crowns and dentures never pay for it.
   */
  const [implantSuggestions, setImplantSuggestions] = useState<string[]>([]);
  /**
   * A ref, not state.
   *
   * As state it was in this effect's own dependency array, so setting it re-ran the effect — which
   * fired the previous cleanup, flipped `cancelled` to true, and threw away the reply to the fetch
   * that was still in flight. The suggestions could never arrive.
   */
  const implantsLoaded = useRef(false);

  useEffect(() => {
    if (!open || !wt.implant || implantsLoaded.current) return;
    let cancelled = false;
    implantsLoaded.current = true;
    getDocs(query(getClinicCollection(LAB_CASES_COLLECTION), orderBy("codeNumber", "desc"), limit(300)))
      .then((snap) => {
        if (cancelled) return;
        const seen = new Set<string>();
        for (const d of snap.docs) {
          const v = String((d.data() as Record<string, unknown>).implantSystem || "").trim();
          if (v) seen.add(v);
        }
        setImplantSuggestions([...seen].sort());
      })
      .catch(() => {
        // Suggestions are a convenience. The field is free text either way, so a failed read
        // costs nothing a person cannot type.
      });
    return () => {
      cancelled = true;
    };
  }, [open, wt.implant]);

  /**
   * Load patients and staff once the modal is first opened, not on mount.
   *
   * The board renders this component alongside the list, and a clinic with four thousand patients
   * should not pay for that read every time somebody opens the lab page to look at a case.
   */
  useEffect(() => {
    if (!open || patientsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [pSnap, sSnap] = await Promise.all([
          getDocs(query(getClinicCollection("patients"), limit(3000))),
          getDocs(query(getClinicCollection("staff"), limit(200))),
        ]);
        if (cancelled) return;
        setPatients(
          pSnap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name: String(data.name || ""),
              phone: String(data.phone || ""),
              fileId: String(data.fileId || ""),
            };
          })
        );
        setStaff(
          sSnap.docs
            .map((d) => ({ id: d.id, name: String((d.data() as Record<string, unknown>).name || "") }))
            .filter((s) => s.name)
        );
      } catch {
        // A failed patient list is not a reason to block a standalone case: the name can be
        // typed. Silently degrading beats a modal that refuses to open.
      } finally {
        if (!cancelled) setPatientsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientsLoaded]);

  /**
   * Seed the form once per opening, from either the record or the treatment that raised it.
   *
   * Guarded by a ref rather than left to the dependency array. The array has to name `labs` and
   * `seed`, and in the clinical-notes path the lab directory is fetched lazily WHEN the prompt
   * appears — so it can easily arrive a second after the form is already open, change identity,
   * re-run this effect and wipe everything the assistant has typed. Keying on "which record is
   * this" makes a late-arriving prop a no-op instead.
   */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    const key = existing?.id || "new";
    if (seededFor.current === key) return;
    seededFor.current = key;

    const src = existing;
    setLabId(src?.labId || (labs.length === 1 ? labs[0].id : ""));
    setBranchId(src?.branchId || seed?.branchId || defaultBranchId || "");
    setWorkType((src?.workType as LabWorkTypeId) || "zirconia");
    setWorkDescription(src?.workDescription || seed?.workDescription || "");
    setUnits(src?.units != null ? String(src.units) : seed?.units != null ? String(seed.units) : "");
    setTeethText((src?.teeth?.length ? src.teeth : seed?.teeth || []).join(", "));
    setBodyShade(src?.bodyShade || "");
    setCervicalShade(src?.cervicalShade || "");
    setGumShade(src?.gumShade || "");
    setMaterial(src?.material || "");
    setImplantSystem(src?.implantSystem || "");
    setImplantPlatform(src?.implantPlatform || "");
    setAbutmentType(src?.abutmentType || "");
    setRetention(src?.retention || "");
    setGuideType(src?.guideType || "");
    setSleeveSystem(src?.sleeveSystem || "");
    setNotes(src?.notes || "");
    const seededAgreed = src
      ? src.agreedPrice
        ? String(src.agreedPrice)
        : ""
      : seed?.agreedPrice
        ? String(Math.round(seed.agreedPrice))
        : "";
    // Kept so the lab-price effect can fall back to it when the chosen lab has no agreed rate for
    // this work, instead of leaving a figure that belonged to a different lab.
    seededPrice.current = seededAgreed;
    setAgreedPrice(seededAgreed);
    setSentVia(src?.sentVia || (workTypeFor(src?.workType || "zirconia").digitalByDefault ? "digital" : "driver"));
    setNeedsTryIn(src ? src.needsTryIn : false);
    setDueDate(src?.dueDate || "");
    setSendNow(src ? src.status !== "draft" : true);
    setPatientId(src?.patientId || seed?.patientId || "");
    setPatientName(src?.patientName || seed?.patientName || "");
    setPatientPhone(src?.patientPhone || seed?.patientPhone || "");
    setPatientQuery("");
    setDoctorId(src?.doctorId || seed?.doctorId || "");
    setDoctorName(src?.doctorName || seed?.doctorName || "");
  }, [open, existing, seed, defaultBranchId, labs]);

  /**
   * Picking a work type re-applies that type's defaults — but only when raising a new case.
   *
   * On an edit these would overwrite the answers already recorded on a real case that is out at a
   * lab, which is worse than an unhelpful default.
   */
  useEffect(() => {
    if (!open || isEdit) return;
    const t = workTypeFor(workType);
    setNeedsTryIn(t.tryInByDefault);
    setSentVia(t.digitalByDefault ? "digital" : "driver");
  }, [workType, open, isEdit]);

  /**
   * A clinic with exactly one lab should never have to pick it.
   *
   * Separate from the seeding effect above, which now runs once per opening and so would miss a
   * directory that finished loading after the form appeared — the very case this covers.
   */
  useEffect(() => {
    if (!open || labId || labs.length !== 1) return;
    setLabId(labs[0].id);
  }, [open, labId, labs]);

  /**
   * What this treatment was actually charged for its lab work.
   *
   * Read on demand for the one case being looked at, rather than swept across the whole board:
   * the person who can judge whether a correction is right is the person with the case open in
   * front of them, and a batch screen of "17 treatments disagree" invites clicking Apply on all of
   * them without reading any.
   */
  const [bookedLabFee, setBookedLabFee] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    if (!open || !existing?.ledgerId) {
      setBookedLabFee(null);
      return;
    }
    let cancelled = false;
    getDoc(getClinicDoc("ledger", existing.ledgerId))
      .then((snap) => {
        if (cancelled) return;
        setBookedLabFee(snap.exists() ? Number(snap.data()?.labFee) || 0 : null);
      })
      .catch(() => {
        // A charge that cannot be read is one this screen simply will not offer to correct.
      });
    return () => {
      cancelled = true;
    };
  }, [open, existing?.ledgerId]);

  const agreedNumber = Number(agreedPrice) || 0;
  // A piastre of rounding is not a correction worth offering anybody.
  const feeDrift =
    bookedLabFee !== null && agreedNumber > 0 && Math.abs(agreedNumber - bookedLabFee) >= 1
      ? Number((agreedNumber - bookedLabFee).toFixed(2))
      : 0;

  const applyFeeCorrection = async () => {
    if (!existing?.ledgerId || !feeDrift) return;
    setCorrecting(true);
    try {
      await setProcedureLabFee(
        existing.ledgerId,
        agreedNumber,
        `Agreed with ${existing.labName || "the lab"} on case ${existing.code}`
      );
      setBookedLabFee(agreedNumber);
      showToast(
        isAr
          ? "اتعدلت تكلفة المعمل، والعمولة اتحسبت من جديد"
          : "Lab cost corrected, and the commission recalculated",
        "success"
      );
    } catch (err) {
      console.error("Lab fee correction failed", err);
      showToast(
        err instanceof MoneyApiError
          ? err.message
          : isAr ? "فشل التعديل" : "Could not correct it",
        "error"
      );
    } finally {
      setCorrecting(false);
    }
  };

  const selectedLab = findLab(labs, labId);

  /** The lab's usual turnaround fills the due date in — the reason it is worth recording. */
  /**
   * The price this lab charges for this kind of work.
   *
   * Keyed on the lab AND the work type, so it re-runs exactly when one of the two things that
   * determine a price changes — and never while somebody is typing in the box.
   *
   * The seeded estimate is remembered rather than discarded: when the chosen lab has no agreed
   * price for this work, the field falls back to the clinic's own `estimatedLabFee` from the
   * treatment that raised the order. Leaving another lab's figure sitting under a new lab's name
   * is the failure to avoid — it looks agreed when nobody agreed it.
   */
  const seededPrice = useRef<string>("");

  useEffect(() => {
    if (!open || isEdit) return;
    const agreed = labPriceFor(selectedLab, workType);
    if (agreed !== null) {
      setAgreedPrice(String(agreed));
    } else if (selectedLab) {
      setAgreedPrice(seededPrice.current);
    }
  }, [selectedLab, workType, open, isEdit]);

  useEffect(() => {
    if (!open || isEdit) return;
    // Switching to a lab that has no recorded turnaround CLEARS the date rather than leaving it.
    // A date derived from a different lab's schedule, still sitting in the box under a new lab's
    // name, is worse than an empty field: it looks agreed when nobody agreed it.
    if (!selectedLab?.turnaroundDays) {
      if (selectedLab) setDueDate("");
      return;
    }
    setDueDate(addDays(localYmd(), selectedLab.turnaroundDays));
  }, [selectedLab, open, isEdit]);

  const patientMatches = useMemo(() => {
    const q = patientQuery.trim();
    if (q.length < 2) return [];
    return patients
      .filter((p) => patientMatchesSearch(q, p.name, p.phone) || matchesTokenizedSubstring(p.fileId || "", q))
      .slice(0, 8);
  }, [patientQuery, patients]);

  const teeth = useMemo(
    () =>
      teethText
        .split(/[^0-9]+/)
        .map((t) => parseInt(t, 10))
        .filter((n) => !Number.isNaN(n) && n >= 11 && n <= 85),
    [teethText]
  );

  const branch = branches.find((b) => b.id === branchId) || null;
  const branchIndex = branch ? branches.indexOf(branch) : 0;
  const previewCode = `${branchCodeFor(branch, branchIndex)}-####`;

  const canSave = Boolean(labId) && !saving;

  const handleSave = async () => {
    if (!labId) {
      showToast(isAr ? "اختار المعمل الأول" : "Pick a lab first", "error");
      return;
    }
    setSaving(true);
    try {
      const lab = findLab(labs, labId);
      const common = {
        labId,
        labName: lab?.name || "",
        workType,
        workDescription: workDescription.trim(),
        // Zero rather than undefined when the box is empty or the work type has no unit count.
        // `compact()` in updateLabCase drops undefined, so an emptied field would otherwise leave
        // the old number in place — a crown edited down from three units to none still billing as
        // three. Zero is written, read back as "no count", and printed as nothing.
        units: wt.units && units.trim() ? Number(units) : 0,
        teeth,
        // Cleared per work type rather than kept: a case switched from a crown to a surgical guide
        // must not carry a shade the printed order would then hide but the record still claims.
        bodyShade: wt.bodyShade ? bodyShade : "",
        cervicalShade: wt.cervicalShade ? cervicalShade : "",
        gumShade: wt.gumShade ? gumShade : "",
        material: material.trim(),
        implantSystem: wt.implant ? implantSystem.trim() : "",
        implantPlatform: wt.implant ? implantPlatform.trim() : "",
        abutmentType: wt.implant ? abutmentType : "",
        retention: wt.implant ? retention : "",
        guideType: wt.guide ? guideType : "",
        sleeveSystem: wt.guide ? sleeveSystem.trim() : "",
        notes: notes.trim(),
        agreedPrice: Number(agreedPrice) || 0,
        sentVia,
        needsTryIn,
        dueDate: dueDate || "",
        patientId: patientId || "",
        patientName: patientName.trim(),
        patientFirstName: firstNameOf(patientName),
        patientPhone: patientPhone.trim(),
        doctorId: doctorId || "",
        doctorName: doctorName.trim(),
      };

      if (existing) {
        // Fields the user may legitimately have emptied have to reach Firestore as "" rather than
        // being dropped, or the previous value survives the save and the screen quietly disagrees
        // with the record. Every optional string on the form is listed — including the two ids,
        // because detaching a patient or a dentist from a case is a real edit and "" is how it is
        // expressed. `units` is not here: it is written as a number (0 when cleared) above.
        const clearable = [
          "bodyShade", "cervicalShade", "gumShade", "material", "implantSystem", "implantPlatform",
          "abutmentType", "retention", "guideType", "sleeveSystem", "notes", "workDescription",
          "dueDate", "patientPhone", "doctorName", "patientName", "patientFirstName",
          "patientId", "doctorId",
        ].filter((k) => !String((common as Record<string, unknown>)[k] ?? "").trim());

        await updateLabCase(existing.id, common as Partial<LabCase>, clearable);
        onSaved({ id: existing.id, code: existing.code, isNew: false });
        showToast(isAr ? "تم حفظ الحالة" : "Case saved", "success");
      } else {
        const created = await createLabCase({
          ...common,
          branchId: branch?.id || "",
          branchName: branch?.name || "",
          branchCode: branchCodeFor(branch, branchIndex),
          status: sendNow ? "at_lab" : "draft",
          sentAt: sendNow ? localYmd() : undefined,
          createdBy: currentUserName,
        });
        onSaved({ id: created.id, code: created.code, isNew: true });
        showToast(
          isAr ? `اتعملت الحالة ${created.code}` : `Case ${created.code} created`,
          "success"
        );
      }
      onClose();
    } catch (err) {
      console.error("Lab case save failed", err);
      showToast(
        isAr ? "فشل الحفظ — راجع صلاحياتك" : "Save failed — check your permissions",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
      <div
        className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom sm:zoom-in-95"
        dir={isAr ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-7 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center shrink-0">
              <FlaskConical size={20} className="text-sky-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-ink tracking-tight truncate">
                {isEdit
                  ? isAr ? `تعديل ${existing?.code}` : `Edit ${existing?.code}`
                  : isAr ? "أمر معمل جديد" : "New lab order"}
              </h2>
              {!isEdit && (
                <p className="text-[11px] font-bold text-slate-400 mt-0.5" dir="ltr">
                  {previewCode}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-surface-muted rounded-xl transition-colors shrink-0"
            aria-label={isAr ? "إغلاق" : "Close"}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 space-y-5 custom-scrollbar">
          {labs.length === 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs font-bold text-amber-800 leading-relaxed">
                {isAr
                  ? "مفيش معامل مسجلة. روح الإعدادات ← المعامل وضيف معمل الأول."
                  : "No labs are set up yet. Go to Settings → Dental Labs and add one first."}
              </p>
            </div>
          )}

          {/* Lab + branch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{isAr ? "المعمل" : "Lab"} *</label>
              <select value={labId} onChange={(e) => setLabId(e.target.value)} className={INPUT}>
                <option value="">{isAr ? "اختار معمل…" : "Choose a lab…"}</option>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.turnaroundDays ? ` (${l.turnaroundDays}${isAr ? " يوم" : "d"})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{isAr ? "الفرع" : "Branch"}</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className={INPUT}
                disabled={isEdit}
              >
                <option value="">{isAr ? "بدون فرع" : "No branch"}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {isEdit && (
                <p className="text-[10px] font-semibold text-slate-400 mt-1 leading-relaxed">
                  {isAr
                    ? "الفرع مش بيتغير بعد ما الكود اتطبع."
                    : "The branch is fixed once the code has been printed."}
                </p>
              )}
            </div>
          </div>

          {/* Patient */}
          <div>
            <label className={LABEL}>{isAr ? "المريض" : "Patient"}</label>
            {patientName ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-subtle border border-line rounded-xl">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">{patientName}</p>
                  <p className="text-[11px] font-bold text-slate-400 truncate" dir="ltr">
                    {patientPhone || (isAr ? "بدون تليفون" : "no phone")}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setPatientId("");
                    setPatientName("");
                    setPatientPhone("");
                  }}
                  className="text-[11px] font-black uppercase tracking-wide text-slate-400 hover:text-rose-500 shrink-0"
                >
                  {isAr ? "تغيير" : "Change"}
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder={
                    isAr ? "دور بالاسم أو التليفون… (اختياري)" : "Search by name or phone… (optional)"
                  }
                  className={`${INPUT} ps-9`}
                />
                {patientMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-surface border border-line rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                    {patientMatches.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPatientId(p.id);
                          setPatientName(p.name);
                          setPatientPhone(p.phone || "");
                          setPatientQuery("");
                        }}
                        className="w-full text-start px-4 py-2.5 hover:bg-surface-subtle transition-colors"
                      >
                        <span className="block text-sm font-bold text-slate-700">{p.name}</span>
                        <span className="block text-[11px] font-semibold text-slate-400" dir="ltr">
                          {[p.fileId, p.phone].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10px] font-semibold text-slate-400 mt-1.5 leading-relaxed">
                  {isAr
                    ? "الورقة اللي بتروح المعمل فيها الاسم الأول والكود بس — الاسم الكامل مش بيخرج من العيادة."
                    : "Only the first name and the code are printed. The full name never leaves the clinic."}
                </p>
              </div>
            )}
          </div>

          {/* Doctor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{isAr ? "الطبيب" : "Dentist"}</label>
              <select
                value={doctorId}
                onChange={(e) => {
                  setDoctorId(e.target.value);
                  setDoctorName(staff.find((s) => s.id === e.target.value)?.name || "");
                }}
                className={INPUT}
              >
                <option value="">{doctorName || (isAr ? "غير محدد" : "Not set")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>{isAr ? "نوع الشغل" : "Work type"} *</label>
              <select
                value={workType}
                onChange={(e) => setWorkType(e.target.value as LabWorkTypeId)}
                className={INPUT}
              >
                {LAB_WORK_TYPES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {isAr ? w.ar : w.en}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description + teeth */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>{isAr ? "وصف الشغل" : "What the lab is making"}</label>
              <input
                value={workDescription}
                onChange={(e) => setWorkDescription(e.target.value)}
                placeholder={isAr ? "مثال: تاجين كامل" : "e.g. 2 x full crown"}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>{isAr ? "الأسنان" : "Teeth"}</label>
              <input
                value={teethText}
                onChange={(e) => setTeethText(e.target.value)}
                placeholder="UR5, UR4"
                dir="ltr"
                className={INPUT}
              />
              {/* Palmer is what gets confirmed back, because Palmer is what goes on the order and
                  what the technician reads. The box itself takes either notation: a case raised
                  from a treatment arrives prefilled in FDI from the chart. */}
              <p className="text-[10px] font-semibold text-slate-400 mt-1 leading-relaxed">
                {isAr
                  ? "اكتب بالمر (UR5) أو FDI (15) — الاتنين شغالين."
                  : "Type Palmer (UR5) or FDI (15) — both work."}
              </p>
              {teeth.length > 0 && (
                <p className="text-xs font-black text-sky-700 mt-1 tracking-wider" dir="ltr">
                  {formatPalmer(teeth)}
                </p>
              )}
            </div>
          </div>

          {/* Per-work-type technical fields */}
          <div className="rounded-2xl border border-line bg-slate-50/60 p-4 space-y-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">
              {isAr ? "تفاصيل فنية" : "Technical details"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {wt.units && (
                <div>
                  <label className={LABEL}>{isAr ? "العدد" : "Units"}</label>
                  <input
                    type="number"
                    min={1}
                    dir="ltr"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    className={INPUT}
                  />
                </div>
              )}
              {wt.bodyShade && (
                <div>
                  <label className={LABEL}>{isAr ? "لون الجسم" : "Body shade"}</label>
                  <select value={bodyShade} onChange={(e) => setBodyShade(e.target.value)} className={INPUT}>
                    <option value="">—</option>
                    {TOOTH_SHADES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {wt.cervicalShade && (
                <div>
                  <label className={LABEL}>{isAr ? "لون العنق" : "Cervical shade"}</label>
                  <select value={cervicalShade} onChange={(e) => setCervicalShade(e.target.value)} className={INPUT}>
                    <option value="">—</option>
                    {CERVICAL_SHADES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {/* The whole point of a second shade: a crown built to one flat colour reads as
                      a crown. Natural teeth are darker at the gum. */}
                  <p className="text-[10px] font-semibold text-slate-400 mt-1 leading-relaxed">
                    {isAr
                      ? "أغمق من لون الجسم عادةً، عشان التاج يبان زي جيرانه."
                      : "Usually a step darker than the body, so the crown reads like its neighbours."}
                  </p>
                </div>
              )}
              {wt.gumShade && (
                <div>
                  <label className={LABEL}>{isAr ? "لون اللثة" : "Gum shade"}</label>
                  <input
                    value={gumShade}
                    onChange={(e) => setGumShade(e.target.value)}
                    list="lab-gum-shades"
                    className={INPUT}
                  />
                  <datalist id="lab-gum-shades">
                    {GUM_SHADE_SUGGESTIONS.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </div>
              )}
              <div className={wt.units || wt.bodyShade ? "" : "sm:col-span-2"}>
                <label className={LABEL}>{isAr ? "الخامة / تفاصيل" : "Material / detail"}</label>
                <input
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder={isAr ? "مثال: مونوليثك" : "e.g. monolithic"}
                  className={INPUT}
                />
              </div>
            </div>

            {wt.implant && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-line">
                <div>
                  <label className={LABEL}>{isAr ? "نظام الزرعة" : "Implant system"}</label>
                  <input
                    value={implantSystem}
                    onChange={(e) => setImplantSystem(e.target.value)}
                    list="lab-implant-systems"
                    placeholder={isAr ? "اكتب الماركة" : "Type the brand"}
                    className={INPUT}
                  />
                  <datalist id="lab-implant-systems">
                    {implantSuggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <p className="text-[10px] font-semibold text-slate-400 mt-1 leading-relaxed">
                    {isAr
                      ? "من غير الماركة والمقاس، الفني مش هيعرف يجيب الدعامة الصح."
                      : "Without the brand and platform the technician cannot pick a matching abutment."}
                  </p>
                </div>
                <div>
                  <label className={LABEL}>{isAr ? "المقاس / المنصة" : "Platform"}</label>
                  <input
                    value={implantPlatform}
                    onChange={(e) => setImplantPlatform(e.target.value)}
                    placeholder="e.g. RC 4.1"
                    dir="ltr"
                    className={INPUT}
                  />
                </div>
                {!wt.guide && (
                  <>
                    <div>
                      <label className={LABEL}>{isAr ? "الدعامة" : "Abutment"}</label>
                      <select value={abutmentType} onChange={(e) => setAbutmentType(e.target.value)} className={INPUT}>
                        <option value="">—</option>
                        {ABUTMENT_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {isAr ? o.ar : o.en}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>{isAr ? "التثبيت" : "Retention"}</label>
                      <select value={retention} onChange={(e) => setRetention(e.target.value)} className={INPUT}>
                        <option value="">—</option>
                        {RETENTION_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {isAr ? o.ar : o.en}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            )}

            {wt.guide && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-line">
                <div>
                  <label className={LABEL}>{isAr ? "نوع الدليل" : "Guide type"}</label>
                  <select value={guideType} onChange={(e) => setGuideType(e.target.value)} className={INPUT}>
                    <option value="">—</option>
                    {GUIDE_TYPE_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {isAr ? o.ar : o.en}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>{isAr ? "نظام الكُم" : "Sleeve system"}</label>
                  <input value={sleeveSystem} onChange={(e) => setSleeveSystem(e.target.value)} className={INPUT} />
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className={LABEL}>{isAr ? "ملاحظات للفني" : "Notes to the technician"}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isAr ? "أي حاجة الفني محتاج يعرفها" : "Anything the technician needs to know"}
              className={`${INPUT} resize-none`}
            />
          </div>

          {/* Logistics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={LABEL}>{isAr ? "ميعاد الرجوع" : "Due back"}</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={INPUT}
              />
              {selectedLab?.turnaroundDays && !isEdit && (
                <p className="text-[10px] font-semibold text-slate-400 mt-1">
                  {isAr
                    ? `من مدة ${selectedLab.name}: ${selectedLab.turnaroundDays} يوم`
                    : `From ${selectedLab.name}'s usual ${selectedLab.turnaroundDays} days`}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>{isAr ? "السعر المتفق عليه" : "Agreed price"}</label>
              <input
                type="number"
                min={0}
                dir="ltr"
                value={agreedPrice}
                onChange={(e) => setAgreedPrice(e.target.value)}
                placeholder="EGP"
                className={INPUT}
              />
              {/* The estimate the treatment was actually booked at, when it disagrees.
                  Offered here rather than applied automatically: it moves money between the
                  dentist and the clinic on every payment already taken, so it is a decision
                  somebody makes, with both numbers in front of them. */}
              {feeDrift !== 0 && (
                <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <p className="text-[11px] font-bold text-amber-900 leading-relaxed">
                    {isAr
                      ? `العلاج اتحسب بـ ${Math.round(bookedLabFee || 0)} تكلفة معمل، وانت متفق على ${Math.round(agreedNumber)}.`
                      : `The treatment was booked at ${Math.round(bookedLabFee || 0)} for lab work; you agreed ${Math.round(agreedNumber)}.`}
                  </p>
                  <Protect permission="finance.edit">
                    <button
                      type="button"
                      onClick={() => void applyFeeCorrection()}
                      disabled={correcting}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[10px] font-black uppercase tracking-wide hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      {correcting && <Loader2 size={12} className="animate-spin" />}
                      {isAr ? "صحّح الحسابات" : "Correct the books"}
                    </button>
                  </Protect>
                  <p className="text-[10px] font-semibold text-amber-700 mt-1.5 leading-relaxed">
                    {isAr
                      ? "هيعيد حساب عمولة الطبيب وربح العيادة على التكلفة الحقيقية، وهيتسجل مين عمل كده."
                      : "Recalculates the dentist's commission and the clinic's profit on the true cost, and records who did it."}
                  </p>
                </div>
              )}

              {/* Where the number came from. A price that appears on its own is a price nobody
                  checks — saying which lab's rate it is makes it worth glancing at, and makes an
                  out-of-date rate visible instead of silently agreed. */}
              {!isEdit && selectedLab && (
                <p className="text-[10px] font-semibold text-slate-400 mt-1 leading-relaxed">
                  {labPriceFor(selectedLab, workType) !== null
                    ? isAr
                      ? `سعر ${selectedLab.name} للشغل ده`
                      : `${selectedLab.name}'s rate for this work`
                    : agreedPrice
                      ? isAr
                        ? "تقديري من قائمة أسعار العيادة — مش متفق عليه مع المعمل ده"
                        : "Your clinic's estimate — not a rate agreed with this lab"
                      : isAr
                        ? "مفيش سعر متفق عليه مع المعمل ده للشغل ده"
                        : "No agreed rate with this lab for this work"}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>{isAr ? "بتروح إزاي" : "How it leaves"}</label>
              <select
                value={sentVia}
                onChange={(e) => setSentVia(e.target.value as "driver" | "digital")}
                className={INPUT}
              >
                <option value="driver">{isAr ? "مع مندوب" : "Handed to a driver"}</option>
                <option value="digital">{isAr ? "ملفات رقمية" : "Sent as files"}</option>
              </select>
            </div>
          </div>

          {/* Try-in + send now */}
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 bg-surface border border-line rounded-xl cursor-pointer hover:bg-surface-subtle transition-colors">
              <input
                type="checkbox"
                checked={needsTryIn}
                onChange={(e) => setNeedsTryIn(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-sky-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-700">
                  {isAr ? "الحالة دي محتاجة بروفة" : "This case needs a try-in"}
                </span>
                <span className="block text-[11px] font-semibold text-slate-400 mt-0.5 leading-relaxed">
                  {isAr
                    ? "بيفتح مرحلة البروفة، وممكن تلف أكتر من مرة. متظبطة لوحدها للأطقم."
                    : "Adds the try-in stage, which can loop as many times as it needs. On by default for dentures."}
                </span>
              </span>
            </label>

            {!isEdit && (
              <label className="flex items-start gap-3 p-3 bg-surface border border-line rounded-xl cursor-pointer hover:bg-surface-subtle transition-colors">
                <input
                  type="checkbox"
                  checked={sendNow}
                  onChange={(e) => setSendNow(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-sky-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-700">
                    {isAr ? "بتتبعت للمعمل دلوقتي" : "Going to the lab now"}
                  </span>
                  <span className="block text-[11px] font-semibold text-slate-400 mt-0.5 leading-relaxed">
                    {isAr
                      ? "شيل العلامة دي لو لسه بتحضّرها — هتفضل مسودة لحد ما تبعتها."
                      : "Uncheck if you are still preparing it — the case stays a draft until you send it."}
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 sm:px-7 py-4 border-t border-slate-100 bg-slate-50/60 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide text-ink-muted hover:bg-slate-200/60 transition-colors"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wide shadow-md hover:bg-slate-700 disabled:opacity-40 transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
            {isEdit ? (isAr ? "حفظ" : "Save") : isAr ? "إنشاء الأمر" : "Create order"}
          </button>
        </div>
      </div>
    </div>
  );
}
