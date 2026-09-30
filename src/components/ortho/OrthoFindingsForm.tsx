"use client";

import { Loader2, Save } from "lucide-react";
import { ORTHO_HABITS, type OrthoClinicalFindings } from "@/lib/orthoAi";

/**
 * The clinical examination the orthodontist enters at the chair — the input the AI diagnosis
 * rests on. Every field is optional; a blank is "not recorded", never "normal". Stored on the
 * ortho case (`clinicalFindings`) by the parent, which owns the save.
 */
const FIELD = "w-full p-2.5 bg-surface border border-line hover:border-purple-300 focus:border-purple-500 rounded-xl outline-none font-bold text-sm text-slate-700 transition-all";
const LABEL = "text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1";

function SelectField({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { v: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
      {opts.map((o) => (
        <option key={o.v} value={o.v}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function OrthoFindingsForm({
  value,
  onChange,
  onSave,
  saving,
  dirty,
  ar,
}: {
  value: OrthoClinicalFindings;
  onChange: (next: OrthoClinicalFindings) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  ar: boolean;
}) {
  const set = <K extends keyof OrthoClinicalFindings>(key: K, v: OrthoClinicalFindings[K]) => onChange({ ...value, [key]: v });
  const numVal = (v: number | null) => (v === null ? "" : String(v));
  const num = (s: string) => (s.trim() === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);

  const L = {
    title: ar ? "الفحص السريري" : "Clinical examination",
    hint: ar ? "اللي تسجّله هنا هو اللي التشخيص هيتبني عليه. الفاضي يعني «مش متسجل»، مش «طبيعي»." : "What you record here is what the diagnosis rests on. Blank means not recorded, never normal.",
    chief: ar ? "شكوى المريض" : "Chief complaint",
    dentition: ar ? "الإسنان" : "Dentition",
    growth: ar ? "النمو" : "Growth",
    molar: ar ? "علاقة الضروس" : "Molar relationship",
    canine: ar ? "علاقة الأنياب" : "Canine relationship",
    right: ar ? "يمين" : "Right",
    left: ar ? "شمال" : "Left",
    overjet: ar ? "أوفرجيت (مم)" : "Overjet (mm)",
    overbite: ar ? "أوفربايت (مم)" : "Overbite (mm)",
    crowdU: ar ? "تزاحم علوي (مم، بالسالب = مسافات)" : "Upper crowding (mm, negative = spacing)",
    crowdL: ar ? "تزاحم سفلي (مم، بالسالب = مسافات)" : "Lower crowding (mm, negative = spacing)",
    midline: ar ? "خط المنتصف" : "Midline",
    crossbite: ar ? "عضة معكوسة" : "Crossbite",
    profile: ar ? "البروفايل" : "Profile",
    lips: ar ? "الشفايف" : "Lips",
    habits: ar ? "العادات" : "Habits",
    missing: ar ? "أسنان ناقصة (FDI)" : "Missing teeth (FDI)",
    impacted: ar ? "أسنان منطمرة / لم تبزغ" : "Impacted / unerupted",
    hygiene: ar ? "نظافة الفم" : "Oral hygiene",
    perio: ar ? "حالة اللثة" : "Periodontal",
    tmj: ar ? "المفصل الفكي" : "TMJ",
    notes: ar ? "ملاحظات الفاحص" : "Examiner's notes",
    save: ar ? "حفظ الفحص" : "Save examination",
    unsaved: ar ? "تغييرات غير محفوظة" : "Unsaved changes",
    none: ar ? "—" : "—",
  };

  const opt = (v: string, en: string, arL: string) => ({ v, label: ar ? arL : en });
  const classOpts = [opt("", "—", "—"), opt("I", "Class I", "صنف I"), opt("II", "Class II", "صنف II"), opt("III", "Class III", "صنف III")];
  const habitLabel: Record<(typeof ORTHO_HABITS)[number], string> = {
    thumb_sucking: ar ? "مص الإصبع" : "Thumb sucking",
    mouth_breathing: ar ? "تنفس من الفم" : "Mouth breathing",
    tongue_thrust: ar ? "دفع اللسان" : "Tongue thrust",
    nail_biting: ar ? "قضم الأظافر" : "Nail biting",
    lip_biting: ar ? "عض الشفة" : "Lip biting",
    bruxism: ar ? "صرير الأسنان" : "Bruxism",
  };

  const field = FIELD;
  const label = LABEL;

  return (
    <div className="bg-surface-subtle rounded-2xl border border-line p-4 md:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-ink flex items-center gap-2">
            {L.title}
            {dirty && <span className="bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded-md">{L.unsaved}</span>}
          </div>
          <p className="text-[11px] font-bold text-slate-400 mt-0.5">{L.hint}</p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-100 disabled:text-slate-400 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 transition-all"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {L.save}
        </button>
      </div>

      <div>
        <label className={label}>{L.chief}</label>
        <input value={value.chiefComplaint} onChange={(e) => set("chiefComplaint", e.target.value)} className={field} placeholder={ar ? "«أسناني بارزة»، «مش عاجبني ضحكتي»…" : "“My teeth stick out”, “I don't like my smile”…"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>{L.dentition}</label>
          <SelectField value={String(value.dentition ?? "")} onChange={(v) => set("dentition", v as never)} opts={[opt("", "—", "—"), opt("primary", "Primary", "لبني"), opt("mixed", "Mixed", "مختلط"), opt("permanent", "Permanent", "دائم")]} />
        </div>
        <div>
          <label className={label}>{L.growth}</label>
          <SelectField value={String(value.growth ?? "")} onChange={(v) => set("growth", v as never)} opts={[opt("", "—", "—"), opt("growing", "Growing", "في مرحلة نمو"), opt("nearly_complete", "Nearly complete", "شبه مكتمل"), opt("complete", "Complete", "مكتمل")]} />
        </div>
        <div>
          <label className={label}>{L.profile}</label>
          <SelectField value={String(value.profile ?? "")} onChange={(v) => set("profile", v as never)} opts={[opt("", "—", "—"), opt("straight", "Straight", "مستقيم"), opt("convex", "Convex", "محدب"), opt("concave", "Concave", "مقعر")]} />
        </div>
        <div>
          <label className={label}>{L.lips}</label>
          <SelectField value={String(value.lips ?? "")} onChange={(v) => set("lips", v as never)} opts={[opt("", "—", "—"), opt("competent", "Competent", "منطبقة"), opt("incompetent", "Incompetent", "غير منطبقة")]} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>{L.molar} — {L.right}</label>
          <SelectField value={String(value.molarRight ?? "")} onChange={(v) => set("molarRight", v as never)} opts={classOpts} />
        </div>
        <div>
          <label className={label}>{L.molar} — {L.left}</label>
          <SelectField value={String(value.molarLeft ?? "")} onChange={(v) => set("molarLeft", v as never)} opts={classOpts} />
        </div>
        <div>
          <label className={label}>{L.canine} — {L.right}</label>
          <SelectField value={String(value.canineRight ?? "")} onChange={(v) => set("canineRight", v as never)} opts={classOpts} />
        </div>
        <div>
          <label className={label}>{L.canine} — {L.left}</label>
          <SelectField value={String(value.canineLeft ?? "")} onChange={(v) => set("canineLeft", v as never)} opts={classOpts} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>{L.overjet}</label>
          <input type="number" step="0.5" value={numVal(value.overjetMm)} onChange={(e) => set("overjetMm", num(e.target.value))} className={field} placeholder="—" />
        </div>
        <div>
          <label className={label}>{L.overbite}</label>
          <input type="number" step="0.5" value={numVal(value.overbiteMm)} onChange={(e) => set("overbiteMm", num(e.target.value))} className={field} placeholder="—" />
        </div>
        <div>
          <label className={label}>{L.crowdU}</label>
          <input type="number" step="0.5" value={numVal(value.crowdingUpperMm)} onChange={(e) => set("crowdingUpperMm", num(e.target.value))} className={field} placeholder="—" />
        </div>
        <div>
          <label className={label}>{L.crowdL}</label>
          <input type="number" step="0.5" value={numVal(value.crowdingLowerMm)} onChange={(e) => set("crowdingLowerMm", num(e.target.value))} className={field} placeholder="—" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={label}>{L.midline}</label>
          <SelectField
            value={String(value.midline ?? "")}
            onChange={(v) => set("midline", v as never)}
            opts={[opt("", "—", "—"), opt("coincident", "Coincident", "متطابق"), opt("upper_left", "Upper shifted left", "العلوي لليسار"), opt("upper_right", "Upper shifted right", "العلوي لليمين"), opt("lower_left", "Lower shifted left", "السفلي لليسار"), opt("lower_right", "Lower shifted right", "السفلي لليمين")]}
          />
        </div>
        <div>
          <label className={label}>{L.crossbite}</label>
          <SelectField
            value={String(value.crossbite ?? "")}
            onChange={(v) => set("crossbite", v as never)}
            opts={[opt("", "—", "—"), opt("none", "None", "لا يوجد"), opt("anterior", "Anterior", "أمامية"), opt("posterior_unilateral", "Posterior, one side", "خلفية من جهة"), opt("posterior_bilateral", "Posterior, both sides", "خلفية من الجهتين"), opt("anterior_and_posterior", "Anterior and posterior", "أمامية وخلفية")]}
          />
        </div>
        <div>
          <label className={label}>{L.hygiene}</label>
          <SelectField value={String(value.oralHygiene ?? "")} onChange={(v) => set("oralHygiene", v as never)} opts={[opt("", "—", "—"), opt("good", "Good", "جيدة"), opt("fair", "Fair", "متوسطة"), opt("poor", "Poor", "ضعيفة")]} />
        </div>
        <div>
          <label className={label}>{L.missing}</label>
          <input value={value.missingTeeth} onChange={(e) => set("missingTeeth", e.target.value)} className={field} placeholder="15, 25…" />
        </div>
      </div>

      <div>
        <label className={label}>{L.habits}</label>
        <div className="flex flex-wrap gap-2">
          {ORTHO_HABITS.map((h) => {
            const on = value.habits.includes(h);
            return (
              <button
                key={h}
                type="button"
                onClick={() => set("habits", on ? value.habits.filter((x) => x !== h) : [...value.habits, h])}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${on ? "bg-purple-600 text-white border-purple-600" : "bg-surface text-slate-600 border-line hover:border-purple-300"}`}
              >
                {habitLabel[h]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className={label}>{L.impacted}</label>
          <input value={value.impactedTeeth} onChange={(e) => set("impactedTeeth", e.target.value)} className={field} placeholder="13, 23…" />
        </div>
        <div>
          <label className={label}>{L.perio}</label>
          <input value={value.periodontal} onChange={(e) => set("periodontal", e.target.value)} className={field} placeholder={ar ? "التهاب لثة، جيوب…" : "gingivitis, pockets…"} />
        </div>
        <div>
          <label className={label}>{L.tmj}</label>
          <input value={value.tmj} onChange={(e) => set("tmj", e.target.value)} className={field} placeholder={ar ? "طقطقة، ألم…" : "clicking, pain…"} />
        </div>
      </div>

      <div>
        <label className={label}>{L.notes}</label>
        <textarea value={value.notes} onChange={(e) => set("notes", e.target.value)} className={`${field} min-h-[70px] resize-y`} placeholder={ar ? "أي حاجة تانية لاحظتها…" : "Anything else you noticed…"} />
      </div>
    </div>
  );
}
