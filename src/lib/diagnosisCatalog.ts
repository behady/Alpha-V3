import {
  CheckCircle2,
  AlertCircle,
  Shield,
  XCircle,
  Activity,
  Bug,
  ThermometerSnowflake,
  Zap,
  Bone,
  PlusSquare,
  type LucideIcon,
} from "lucide-react";

export type DiagnosisCategory = {
  id: string;
  labelEn: string;
  labelAr: string;
  color: string;
  ring: string;
  soft: string;
  icon: LucideIcon;
};

export type DiagnosisOption = {
  id: string;
  cat: string;
  labelEn: string;
  labelAr: string;
  descEn?: string;
  descAr?: string;
  treatmentsEn?: string[];
  treatmentsAr?: string[];
};

export const DIAGNOSIS_CATEGORIES: DiagnosisCategory[] = [
  { id: "healthy",     labelEn: "Healthy",                labelAr: "سليم",                color: "#10b981", ring: "ring-emerald-400/40", soft: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  { id: "caries",      labelEn: "Dental Caries",          labelAr: "تسوس الأسنان",        color: "#ef4444", ring: "ring-rose-400/40",    soft: "bg-rose-50 text-rose-700 border-rose-200",         icon: Bug },
  { id: "pulp",        labelEn: "Pulpal Status",          labelAr: "حالة العصب",          color: "#f97316", ring: "ring-orange-400/40",  soft: "bg-orange-50 text-orange-700 border-orange-200",   icon: Activity },
  { id: "periapical",  labelEn: "Periapical Status",      labelAr: "الأنسجة الذروية",     color: "#b45309", ring: "ring-amber-500/40",   soft: "bg-amber-50 text-amber-800 border-amber-200",      icon: Bone },
  { id: "sensitivity", labelEn: "Hypersensitivity",       labelAr: "حساسية الأسنان",      color: "#eab308", ring: "ring-yellow-400/40",  soft: "bg-yellow-50 text-yellow-800 border-yellow-200",   icon: Zap },
  { id: "wear",        labelEn: "Tooth Wear / NCCL",      labelAr: "تآكل الأسنان",        color: "#8b5cf6", ring: "ring-violet-400/40",  soft: "bg-violet-50 text-violet-700 border-violet-200",   icon: ThermometerSnowflake },
  { id: "trauma",      labelEn: "Traumatic Injuries",     labelAr: "إصابات وكسور",        color: "#6366f1", ring: "ring-indigo-400/40",  soft: "bg-indigo-50 text-indigo-700 border-indigo-200",   icon: AlertCircle },
  { id: "perio",       labelEn: "Periodontal",            labelAr: "أمراض اللثة",         color: "#14b8a6", ring: "ring-teal-400/40",    soft: "bg-teal-50 text-teal-700 border-teal-200",         icon: Activity },
  { id: "development", labelEn: "Developmental",          labelAr: "النمو والبزوغ",       color: "#3b82f6", ring: "ring-blue-400/40",    soft: "bg-blue-50 text-blue-700 border-blue-200",         icon: PlusSquare },
  { id: "restoration", labelEn: "Restoration / Prosthesis", labelAr: "التركيبات السابقة", color: "#64748b", ring: "ring-slate-400/40",   soft: "bg-slate-100 text-slate-700 border-slate-200",     icon: Shield },
  { id: "surgery",     labelEn: "Surgical / Extracted",   labelAr: "جراحة / خلع",         color: "#1e293b", ring: "ring-slate-800/40",   soft: "bg-slate-900/5 text-slate-800 border-slate-300",   icon: XCircle },
];

export const DIAGNOSIS_OPTIONS: DiagnosisOption[] = [
  { id: "healthy",                cat: "healthy",     labelEn: "Healthy / No Pathology",                 labelAr: "سليم" },

  { id: "caries_incipient",       cat: "caries",      labelEn: "Incipient (Enamel only)",                labelAr: "تسوس مبدئي (طبقة المينا)" },
  { 
    id: "caries_moderate",        
    cat: "caries",      
    labelEn: "Moderate (Dentin involved)",             
    labelAr: "تسوس متوسط (طبقة العاج)",
    descEn: "Decay has progressed beyond the enamel and into the softer dentin layer. The tooth may become sensitive to sweet, hot, or cold foods and drinks.",
    descAr: "تجاوز التسوس طبقة المينا ووصل إلى طبقة العاج الأكثر ليونة. قد يصبح السن حساساً للأطعمة والمشروبات الحلوة أو الساخنة أو الباردة.",
    treatmentsEn: ["Composite Filling", "Amalgam Filling"],
    treatmentsAr: ["حشوة تجميلية", "حشوة أملغم"]
  },
  { id: "caries_severe",          cat: "caries",      labelEn: "Severe (Approaching pulp)",              labelAr: "تسوس عميق (قريب من العصب)" },
  { id: "caries_secondary",       cat: "caries",      labelEn: "Secondary / Recurrent",                  labelAr: "تسوس ثانوي (تحت حشوة)" },
  { id: "caries_arrested",        cat: "caries",      labelEn: "Arrested",                               labelAr: "تسوس متوقف" },
  { id: "caries_root",            cat: "caries",      labelEn: "Root Caries",                            labelAr: "تسوس الجذور" },

  { id: "pulp_normal",            cat: "pulp",        labelEn: "Normal Pulp",                            labelAr: "عصب سليم" },
  { id: "pulp_reversible",        cat: "pulp",        labelEn: "Reversible Pulpitis",                    labelAr: "التهاب عصب قابل للشفاء" },
  { id: "pulp_irreversible_symp", cat: "pulp",        labelEn: "Symptomatic Irreversible Pulpitis",      labelAr: "التهاب عصب غير قابل للشفاء (بأعراض)" },
  { id: "pulp_irreversible_asymp",cat: "pulp",        labelEn: "Asymptomatic Irreversible Pulpitis",     labelAr: "التهاب عصب غير قابل للشفاء (بدون أعراض)" },
  { 
    id: "pulp_necrosis",          
    cat: "pulp",        
    labelEn: "Pulp Necrosis",                          
    labelAr: "تموت العصب",
    descEn: "Death of the dental pulp, often resulting from bacterial infection, trauma, or chemical irritation. It may be asymptomatic or present with pain, swelling, or discoloration.",
    descAr: "موت اللب السني (العصب)، وغالباً ما ينتج عن عدوى بكتيرية أو صدمة. قد يكون بدون أعراض أو يصاحبه ألم أو تورم أو تغير في لون السن.",
    treatmentsEn: ["Root Canal Treatment", "Extraction"],
    treatmentsAr: ["علاج العصب", "خلع السن"]
  },
  { id: "pulp_prev_treated",      cat: "pulp",        labelEn: "Previously Treated",                     labelAr: "معالج عصبياً مسبقاً" },
  { id: "pulp_prev_initiated",    cat: "pulp",        labelEn: "Previously Initiated Therapy",           labelAr: "علاج عصب غير مكتمل" },

  { id: "peri_normal",            cat: "periapical",  labelEn: "Normal Apical Tissues",                  labelAr: "أنسجة ذروية سليمة" },
  { id: "peri_symp",              cat: "periapical",  labelEn: "Symptomatic Apical Periodontitis",       labelAr: "التهاب ذروي بأعراض" },
  { id: "peri_asymp",             cat: "periapical",  labelEn: "Asymptomatic Apical Periodontitis",      labelAr: "التهاب ذروي بدون أعراض" },
  { id: "peri_acute_abscess",     cat: "periapical",  labelEn: "Acute Apical Abscess",                   labelAr: "خراج ذروي حاد" },
  { id: "peri_chronic_abscess",   cat: "periapical",  labelEn: "Chronic Apical Abscess",                 labelAr: "خراج ذروي مزمن" },
  { id: "peri_osteitis",          cat: "periapical",  labelEn: "Condensing Osteitis",                    labelAr: "التهاب عظمي مكثف" },

  { id: "sens_cold",              cat: "sensitivity", labelEn: "Thermal — Cold",                         labelAr: "حساسية للمؤثرات الباردة" },
  { id: "sens_hot",               cat: "sensitivity", labelEn: "Thermal — Hot",                          labelAr: "حساسية للمؤثرات الساخنة" },
  { id: "sens_sweet",             cat: "sensitivity", labelEn: "Chemical — Sweet",                       labelAr: "حساسية للسكريات" },
  { id: "sens_acidic",            cat: "sensitivity", labelEn: "Chemical — Acidic",                      labelAr: "حساسية للأحماض" },
  { id: "sens_tactile",           cat: "sensitivity", labelEn: "Tactile — Brushing / Probing",           labelAr: "حساسية عند اللمس/التفريش" },

  { id: "wear_attrition",         cat: "wear",        labelEn: "Attrition",                              labelAr: "احتكاك الأسنان (صرير)" },
  { id: "wear_abrasion",          cat: "wear",        labelEn: "Abrasion",                               labelAr: "سحج ميكانيكي (تفريش عنيف)" },
  { id: "wear_erosion",           cat: "wear",        labelEn: "Erosion",                                labelAr: "تآكل كيميائي/حمضي" },
  { id: "wear_abfraction",        cat: "wear",        labelEn: "Abfraction",                             labelAr: "تكسر عنقي (إجهاد ميكانيكي)" },

  { id: "trauma_infraction",      cat: "trauma",      labelEn: "Enamel Infraction",                      labelAr: "تشقق المينا" },
  { id: "trauma_uncomplicated",   cat: "trauma",      labelEn: "Uncomplicated Crown Fracture",           labelAr: "كسر التاج (غير معقد)" },
  { id: "trauma_complicated",     cat: "trauma",      labelEn: "Complicated Crown Fracture",             labelAr: "كسر التاج (معقد/انكشاف العصب)" },
  { id: "trauma_crown_root",      cat: "trauma",      labelEn: "Crown-Root Fracture",                    labelAr: "كسر التاج والجذر" },
  { id: "trauma_root",            cat: "trauma",      labelEn: "Root Fracture",                          labelAr: "كسر الجذر" },
  { id: "trauma_concussion",      cat: "trauma",      labelEn: "Concussion",                             labelAr: "ارتجاج السن" },
  { id: "trauma_subluxation",     cat: "trauma",      labelEn: "Subluxation",                            labelAr: "خلخلة السن" },
  { id: "trauma_luxation",        cat: "trauma",      labelEn: "Luxation",                               labelAr: "إزاحة السن" },
  { id: "trauma_avulsion",        cat: "trauma",      labelEn: "Avulsion",                               labelAr: "انقلاع السن (خروج كامل)" },

  { id: "perio_pocket",           cat: "perio",       labelEn: "Periodontal Pocketing",                  labelAr: "جيب لثوي عميق" },
  { id: "perio_recession",        cat: "perio",       labelEn: "Gingival Recession",                     labelAr: "انحسار اللثة" },
  { id: "perio_furcation",        cat: "perio",       labelEn: "Furcation Involvement",                  labelAr: "إصابة مفترق الجذور" },
  { id: "perio_mobility_1",       cat: "perio",       labelEn: "Mobility (Grade I)",                     labelAr: "حركة السن (الدرجة 1)" },
  { id: "perio_mobility_2",       cat: "perio",       labelEn: "Mobility (Grade II)",                    labelAr: "حركة السن (الدرجة 2)" },
  { id: "perio_mobility_3",       cat: "perio",       labelEn: "Mobility (Grade III)",                   labelAr: "حركة السن (الدرجة 3)" },
  { id: "perio_open_contact",     cat: "perio",       labelEn: "Open Contact (Food impaction)",          labelAr: "فراغ بين الأسنان (حشر طعام)" },
  { id: "perio_cracked",          cat: "perio",       labelEn: "Cracked Tooth Syndrome",                 labelAr: "متلازمة السن المتصدع" },

  { id: "dev_impaction_soft",     cat: "development", labelEn: "Impaction: Soft Tissue",                 labelAr: "انطمار في الأنسجة الرخوة" },
  { id: "dev_impaction_partial",  cat: "development", labelEn: "Impaction: Partial Bony",                labelAr: "انطمار عظمي جزئي" },
  { id: "dev_impaction_full",     cat: "development", labelEn: "Impaction: Full Bony",                   labelAr: "انطمار عظمي كامل" },
  { id: "dev_supernumerary",      cat: "development", labelEn: "Supernumerary Tooth",                    labelAr: "سن زائد" },
  { id: "dev_hypodontia",         cat: "development", labelEn: "Congenitally Missing",                   labelAr: "غياب خلقي للسن" },
  { id: "dev_ankylosis",          cat: "development", labelEn: "Ankylosis",                              labelAr: "التصاق السن بالعظم" },

  { id: "rest_composite",         cat: "restoration", labelEn: "Composite Filling",                      labelAr: "حشوة تجميلية سليمة" },
  { id: "rest_amalgam",           cat: "restoration", labelEn: "Amalgam Filling",                        labelAr: "حشوة أملغم سليمة" },
  { 
    id: "rest_crown",             
    cat: "restoration", 
    labelEn: "Crown",                                  
    labelAr: "تاج / طربوش سليم",
    descEn: "A tooth-shaped 'cap' that is placed over a tooth to cover the tooth to restore its shape and size, strength, and improve its appearance.",
    descAr: "غطاء على شكل سن يوضع فوق السن لاستعادة شكله وحجمه وقوته وتحسين مظهره.",
    treatmentsEn: ["Crown Recementation", "Crown Replacement", "Periodic Evaluation"],
    treatmentsAr: ["إعادة تثبيت التاج", "استبدال التاج", "فحص دوري"]
  },
  { 
    id: "rest_implant",           
    cat: "restoration", 
    labelEn: "Implant",                                
    labelAr: "زرعة سنية",
    descEn: "A titanium post surgically positioned into the jawbone beneath the gum line that allows the dentist to mount replacement teeth or a bridge into that area.",
    descAr: "دعامة من التيتانيوم تُزرع جراحياً في عظم الفك أسفل خط اللثة للسماح بتركيب أسنان بديلة أو جسر في تلك المنطقة.",
    treatmentsEn: ["Implant Crown Placement", "Implant Maintenance", "Peri-implantitis Treatment"],
    treatmentsAr: ["تركيب تاج على الزرعة", "صيانة الزرعة", "علاج التهاب ما حول الزرعة"]
  },
  { id: "rest_fractured",         cat: "restoration", labelEn: "Fractured Restoration",                  labelAr: "كسر في الحشوة/التاج" },
  { id: "rest_debonded",          cat: "restoration", labelEn: "Debonded / Missing Restoration",         labelAr: "سقوط الحشوة/التاج" },
  { id: "rest_overhang",          cat: "restoration", labelEn: "Overhanging Margin",                     labelAr: "حواف حشوة زائدة" },
  { id: "rest_defective_margin",  cat: "restoration", labelEn: "Defective Margin (Leakage)",             labelAr: "تسرب حول الحشوة/التاج" },

  { id: "surg_missing",           cat: "surgery",     labelEn: "Missing / Extracted",                    labelAr: "مفقود / مخلوع" },
];

export interface PerioMetrics {
  pd: [number, number, number]; // Probing Depths (Distal, Mid, Mesial)
  gm: [number, number, number]; // Gingival Margin (Distal, Mid, Mesial)
}

export interface ToothData {
  /** Legacy field for backward compatibility. */
  status?: string;
  /** New: multiple diagnoses can be applied to the same tooth. */
  statuses?: string[];
  notes?: string;
  /** Who typed `notes`, and when. Stamped only when the note text actually changes, so re-saving
   *  a tooth's diagnoses does not reattribute someone else's sentence to the current user. */
  notesBy?: string;
  notesAt?: string;
  imageUrl?: string;
  /** Surfaces affected by a given diagnosis (e.g. { "caries_enamel": ["M", "O"] }) */
  surfaces?: Record<string, string[]>;
  perio?: {
    buccal: PerioMetrics;
    lingual: PerioMetrics;
  };
}

/**
 * Normalize a tooth entry into the new multi-status shape without losing legacy data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeToothData(raw: any): ToothData {
  if (!raw) return {};
  if (typeof raw === "string") return { statuses: [raw] };
  const out: ToothData = {};
  if (Array.isArray(raw.statuses)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.statuses = raw.statuses.filter((s: any) => typeof s === "string" && s.length > 0);
  } else if (typeof raw.status === "string" && raw.status) {
    out.statuses = [raw.status];
  }
  if (typeof raw.notes === "string") out.notes = raw.notes;
  // Carried through deliberately: the diagnosis page normalizes on read and writes the result
  // straight back, so anything missing here is erased on the next save of any tooth.
  if (typeof raw.notesBy === "string") out.notesBy = raw.notesBy;
  if (typeof raw.notesAt === "string") out.notesAt = raw.notesAt;
  if (typeof raw.imageUrl === "string") out.imageUrl = raw.imageUrl;
  if (typeof raw.surfaces === "object" && raw.surfaces !== null) out.surfaces = raw.surfaces;
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStatusesFromTooth(raw: any): string[] {
  const n = normalizeToothData(raw);
  return n.statuses || [];
}

export function findOption(id: string): DiagnosisOption | undefined {
  return DIAGNOSIS_OPTIONS.find(o => o.id === id);
}

export function findCategory(id: string | undefined): DiagnosisCategory | undefined {
  if (!id) return undefined;
  return DIAGNOSIS_CATEGORIES.find(c => c.id === id);
}

export function getCategoryForStatus(statusId: string): DiagnosisCategory | undefined {
  const opt = findOption(statusId);
  return findCategory(opt?.cat);
}

/** Primary category color for visualizing a tooth (first non-healthy status wins). */
export function getPrimaryCategoryForStatuses(statuses: string[]): DiagnosisCategory | undefined {
  const meaningful = statuses.find(s => s && s !== "healthy" && !s.endsWith("_normal") && s !== "pulp_normal" && s !== "peri_normal");
  if (meaningful) return getCategoryForStatus(meaningful);
  if (statuses[0]) return getCategoryForStatus(statuses[0]);
  return undefined;
}

export function isMissingStatus(statuses: string[]): boolean {
  return statuses.includes("surg_missing") || statuses.includes("dev_hypodontia");
}

/** Anatomical zone a diagnosis primarily affects. */
export type ToothZone = "crown" | "root" | "both";

/** Categories whose conditions live in the pulp / root / supporting tissues. */
const ROOT_CATEGORIES = new Set(["pulp", "periapical", "perio"]);

/** Individual statuses that involve the root even though their category is crown-ish. */
const ROOT_STATUS_IDS = new Set([
  "caries_root",
  "trauma_root",
  "rest_implant",
  "dev_ankylosis",
]);

/** Statuses that involve BOTH crown and root. */
const BOTH_STATUS_IDS = new Set(["trauma_crown_root"]);

/**
 * Decide whether a finding should be painted on the crown, the root, or both.
 * Pulp, periapical and periodontal problems colour the ROOT (so the chart shows
 * the issue is "inside"/below the gum), everything else colours the crown.
 */
export function getStatusZone(statusId: string): ToothZone {
  if (BOTH_STATUS_IDS.has(statusId)) return "both";
  if (ROOT_STATUS_IDS.has(statusId)) return "root";
  const opt = findOption(statusId);
  if (opt && ROOT_CATEGORIES.has(opt.cat)) return "root";
  return "crown";
}
