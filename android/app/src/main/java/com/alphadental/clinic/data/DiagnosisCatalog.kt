package com.alphadental.clinic.data

import androidx.compose.ui.graphics.Color

/**
 * The tooth-condition catalogue, mirrored from src/lib/diagnosisCatalog.ts.
 *
 * The ids here are the strings stored in patients/{id}.teethData, so they must
 * match the website's exactly — a renamed id is a diagnosis that disappears
 * from the other surface. If the catalogue changes there, copy the change here.
 *
 * Same arrangement as the dental icon library: two files, one vocabulary.
 * See the note in DentalIcons.kt.
 */
data class DiagnosisCategory(
    val id: String,
    val en: String,
    val ar: String,
    val color: Color,
)

data class DiagnosisOption(
    val id: String,
    val category: String,
    val en: String,
    val ar: String,
)

val DIAGNOSIS_CATEGORIES: List<DiagnosisCategory> = listOf(
    DiagnosisCategory("healthy", "Healthy", "سليم", Color(0xFF10B981)),
    DiagnosisCategory("caries", "Dental Caries", "تسوس الأسنان", Color(0xFFEF4444)),
    DiagnosisCategory("pulp", "Pulpal Status", "حالة العصب", Color(0xFFF97316)),
    DiagnosisCategory("periapical", "Periapical Status", "الأنسجة الذروية", Color(0xFFB45309)),
    DiagnosisCategory("sensitivity", "Hypersensitivity", "حساسية الأسنان", Color(0xFFEAB308)),
    DiagnosisCategory("wear", "Tooth Wear / NCCL", "تآكل الأسنان", Color(0xFF8B5CF6)),
    DiagnosisCategory("trauma", "Traumatic Injuries", "إصابات وكسور", Color(0xFF6366F1)),
    DiagnosisCategory("perio", "Periodontal", "أمراض اللثة", Color(0xFF14B8A6)),
    DiagnosisCategory("development", "Developmental", "النمو والبزوغ", Color(0xFF3B82F6)),
    DiagnosisCategory("restoration", "Restoration / Prosthesis", "التركيبات السابقة", Color(0xFF64748B)),
    DiagnosisCategory("surgery", "Surgical / Extracted", "جراحة / خلع", Color(0xFF1E293B)),
)

val DIAGNOSIS_OPTIONS: List<DiagnosisOption> = listOf(
    DiagnosisOption("healthy", "healthy", "Healthy / No Pathology", "سليم"),
    DiagnosisOption("caries_incipient", "caries", "Incipient (Enamel only)", "تسوس مبدئي (طبقة المينا)"),
    DiagnosisOption("caries_moderate", "caries", "Moderate (Dentin involved)", "تسوس متوسط (طبقة العاج)"),
    DiagnosisOption("caries_severe", "caries", "Severe (Approaching pulp)", "تسوس عميق (قريب من العصب)"),
    DiagnosisOption("caries_secondary", "caries", "Secondary / Recurrent", "تسوس ثانوي (تحت حشوة)"),
    DiagnosisOption("caries_arrested", "caries", "Arrested", "تسوس متوقف"),
    DiagnosisOption("caries_root", "caries", "Root Caries", "تسوس الجذور"),
    DiagnosisOption("pulp_normal", "pulp", "Normal Pulp", "عصب سليم"),
    DiagnosisOption("pulp_reversible", "pulp", "Reversible Pulpitis", "التهاب عصب قابل للشفاء"),
    DiagnosisOption("pulp_irreversible_symp", "pulp", "Symptomatic Irreversible Pulpitis", "التهاب عصب غير قابل للشفاء (بأعراض)"),
    DiagnosisOption("pulp_irreversible_asymp", "pulp", "Asymptomatic Irreversible Pulpitis", "التهاب عصب غير قابل للشفاء (بدون أعراض)"),
    DiagnosisOption("pulp_necrosis", "pulp", "Pulp Necrosis", "تموت العصب"),
    DiagnosisOption("pulp_prev_treated", "pulp", "Previously Treated", "معالج عصبياً مسبقاً"),
    DiagnosisOption("pulp_prev_initiated", "pulp", "Previously Initiated Therapy", "علاج عصب غير مكتمل"),
    DiagnosisOption("peri_normal", "periapical", "Normal Apical Tissues", "أنسجة ذروية سليمة"),
    DiagnosisOption("peri_symp", "periapical", "Symptomatic Apical Periodontitis", "التهاب ذروي بأعراض"),
    DiagnosisOption("peri_asymp", "periapical", "Asymptomatic Apical Periodontitis", "التهاب ذروي بدون أعراض"),
    DiagnosisOption("peri_acute_abscess", "periapical", "Acute Apical Abscess", "خراج ذروي حاد"),
    DiagnosisOption("peri_chronic_abscess", "periapical", "Chronic Apical Abscess", "خراج ذروي مزمن"),
    DiagnosisOption("peri_osteitis", "periapical", "Condensing Osteitis", "التهاب عظمي مكثف"),
    DiagnosisOption("sens_cold", "sensitivity", "Thermal — Cold", "حساسية للمؤثرات الباردة"),
    DiagnosisOption("sens_hot", "sensitivity", "Thermal — Hot", "حساسية للمؤثرات الساخنة"),
    DiagnosisOption("sens_sweet", "sensitivity", "Chemical — Sweet", "حساسية للسكريات"),
    DiagnosisOption("sens_acidic", "sensitivity", "Chemical — Acidic", "حساسية للأحماض"),
    DiagnosisOption("sens_tactile", "sensitivity", "Tactile — Brushing / Probing", "حساسية عند اللمس/التفريش"),
    DiagnosisOption("wear_attrition", "wear", "Attrition", "احتكاك الأسنان (صرير)"),
    DiagnosisOption("wear_abrasion", "wear", "Abrasion", "سحج ميكانيكي (تفريش عنيف)"),
    DiagnosisOption("wear_erosion", "wear", "Erosion", "تآكل كيميائي/حمضي"),
    DiagnosisOption("wear_abfraction", "wear", "Abfraction", "تكسر عنقي (إجهاد ميكانيكي)"),
    DiagnosisOption("trauma_infraction", "trauma", "Enamel Infraction", "تشقق المينا"),
    DiagnosisOption("trauma_uncomplicated", "trauma", "Uncomplicated Crown Fracture", "كسر التاج (غير معقد)"),
    DiagnosisOption("trauma_complicated", "trauma", "Complicated Crown Fracture", "كسر التاج (معقد/انكشاف العصب)"),
    DiagnosisOption("trauma_crown_root", "trauma", "Crown-Root Fracture", "كسر التاج والجذر"),
    DiagnosisOption("trauma_root", "trauma", "Root Fracture", "كسر الجذر"),
    DiagnosisOption("trauma_concussion", "trauma", "Concussion", "ارتجاج السن"),
    DiagnosisOption("trauma_subluxation", "trauma", "Subluxation", "خلخلة السن"),
    DiagnosisOption("trauma_luxation", "trauma", "Luxation", "إزاحة السن"),
    DiagnosisOption("trauma_avulsion", "trauma", "Avulsion", "انقلاع السن (خروج كامل)"),
    DiagnosisOption("perio_pocket", "perio", "Periodontal Pocketing", "جيب لثوي عميق"),
    DiagnosisOption("perio_recession", "perio", "Gingival Recession", "انحسار اللثة"),
    DiagnosisOption("perio_furcation", "perio", "Furcation Involvement", "إصابة مفترق الجذور"),
    DiagnosisOption("perio_mobility_1", "perio", "Mobility (Grade I)", "حركة السن (الدرجة 1)"),
    DiagnosisOption("perio_mobility_2", "perio", "Mobility (Grade II)", "حركة السن (الدرجة 2)"),
    DiagnosisOption("perio_mobility_3", "perio", "Mobility (Grade III)", "حركة السن (الدرجة 3)"),
    DiagnosisOption("perio_open_contact", "perio", "Open Contact (Food impaction)", "فراغ بين الأسنان (حشر طعام)"),
    DiagnosisOption("perio_cracked", "perio", "Cracked Tooth Syndrome", "متلازمة السن المتصدع"),
    DiagnosisOption("dev_impaction_soft", "development", "Impaction: Soft Tissue", "انطمار في الأنسجة الرخوة"),
    DiagnosisOption("dev_impaction_partial", "development", "Impaction: Partial Bony", "انطمار عظمي جزئي"),
    DiagnosisOption("dev_impaction_full", "development", "Impaction: Full Bony", "انطمار عظمي كامل"),
    DiagnosisOption("dev_supernumerary", "development", "Supernumerary Tooth", "سن زائد"),
    DiagnosisOption("dev_hypodontia", "development", "Congenitally Missing", "غياب خلقي للسن"),
    DiagnosisOption("dev_ankylosis", "development", "Ankylosis", "التصاق السن بالعظم"),
    DiagnosisOption("rest_composite", "restoration", "Composite Filling", "حشوة تجميلية سليمة"),
    DiagnosisOption("rest_amalgam", "restoration", "Amalgam Filling", "حشوة أملغم سليمة"),
    DiagnosisOption("rest_crown", "restoration", "Crown", "تاج / طربوش سليم"),
    DiagnosisOption("rest_implant", "restoration", "Implant", "زرعة سنية"),
    DiagnosisOption("rest_fractured", "restoration", "Fractured Restoration", "كسر في الحشوة/التاج"),
    DiagnosisOption("rest_debonded", "restoration", "Debonded / Missing Restoration", "سقوط الحشوة/التاج"),
    DiagnosisOption("rest_overhang", "restoration", "Overhanging Margin", "حواف حشوة زائدة"),
    DiagnosisOption("rest_defective_margin", "restoration", "Defective Margin (Leakage)", "تسرب حول الحشوة/التاج"),
    DiagnosisOption("surg_missing", "surgery", "Missing / Extracted", "مفقود / مخلوع"),
)

fun diagnosisCategory(id: String?): DiagnosisCategory =
    DIAGNOSIS_CATEGORIES.firstOrNull { it.id == id } ?: DIAGNOSIS_CATEGORIES.last()

fun diagnosisOption(id: String?): DiagnosisOption? =
    DIAGNOSIS_OPTIONS.firstOrNull { it.id == id }

/** The label to show for a stored id — falls back to the raw id so nothing vanishes. */
fun diagnosisLabel(id: String, arabic: Boolean): String =
    diagnosisOption(id)?.let { if (arabic) it.ar else it.en } ?: id

/** The colour a tooth takes from its worst condition, for the chart. */
fun diagnosisColor(statuses: List<String>): Color? {
    val option = statuses.firstNotNullOfOrNull { diagnosisOption(it) } ?: return null
    return diagnosisCategory(option.category).color
}
