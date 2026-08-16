package com.alphadental.clinic.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * The dental icon library, mirrored from the website's `src/lib/dentalIcons.tsx`.
 *
 * The path data here is copied verbatim from that file — the two lists must stay
 * identical, because a service saves only its icon *id* and both surfaces draw
 * the picture from their own copy of these paths. If a path changes there, copy
 * it here.
 *
 * Icons are built once each, on first use, from the raw path strings.
 */
object DentalIcons {

    private class Def(
        val id: String,
        val keywords: List<String>,
        val paths: List<String>,
        val filled: Set<Int> = emptySet(),
    )

    private const val TOOTH =
        "M12 3.2c-1.1 0-1.8.7-3 .7-1.2 0-3.5-.6-3.5 3.1 0 1.9.7 3.2 1.2 4.6.5 1.4.9 3.8 1.1 6 .1 1.3.7 2.2 1.6 2.2.9 0 1.3-.9 1.5-2 .3-1.6.5-2.8 1.1-2.8s.8 1.2 1.1 2.8c.2 1.1.6 2 1.5 2 .9 0 1.5-.9 1.6-2.2.2-2.2.6-4.6 1.1-6 .5-1.4 1.2-2.7 1.2-4.6 0-3.7-2.3-3.1-3.5-3.1-1.2 0-1.9-.7-3-.7z"

    private const val TOOTH_SMALL =
        "M9.5 4.2c-.8 0-1.3.5-2.1.5-.9 0-2.5-.4-2.5 2.2 0 1.4.5 2.3.9 3.3.4 1 .6 2.7.8 4.3.1.9.5 1.6 1.1 1.6.6 0 .9-.6 1.1-1.4.2-1.1.4-2 .8-2s.6.9.8 2c.2.8.5 1.4 1.1 1.4.6 0 1-.7 1.1-1.6.2-1.6.4-3.3.8-4.3.4-1 .9-1.9.9-3.3 0-2.6-1.6-2.2-2.5-2.2-.8 0-1.3-.5-2.1-.5z"

    private fun sparkle(cx: Double, cy: Double, r: Double): String {
        val a = r * 0.35
        return "M$cx ${cy - r}L${cx + a} ${cy - a}L${cx + r} ${cy}L${cx + a} ${cy + a}L$cx ${cy + r}L${cx - a} ${cy + a}L${cx - r} ${cy}L${cx - a} ${cy - a}Z"
    }

    private val DEFS: List<Def> = listOf(
        Def("tooth", listOf("general", "exam", "checkup", "كشف"), listOf(TOOTH)),
        Def("checkup", listOf("consult", "exam", "checkup", "كشف", "استشارة"), listOf(TOOTH, "M9.6 11.2l1.7 1.7 3.4-3.4")),
        Def(
            "cleaning", listOf("clean", "scaling", "polish", "prophylaxis", "تنظيف", "تلميع"),
            listOf(TOOTH, sparkle(19.4, 5.0, 1.7), sparkle(4.6, 9.5, 1.3)), setOf(1, 2),
        ),
        Def(
            "whitening", listOf("whitening", "bleach", "zoom", "تبييض"),
            listOf(TOOTH, sparkle(12.0, 9.5, 2.2), sparkle(18.9, 4.6, 1.4)), setOf(1, 2),
        ),
        Def(
            "filling", listOf("filling", "composite", "restoration", "حشو", "حشوة"),
            listOf(TOOTH, "M9.8 8.2a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0"), setOf(1),
        ),
        Def(
            "root-canal", listOf("root", "canal", "endo", "nerve", "عصب", "جذور"),
            listOf(TOOTH, "M12 7v8", "M9.6 17.5c.2-3 .6-5.3 2.4-5.3s2.2 2.3 2.4 5.3"),
        ),
        Def("post-core", listOf("post", "core", "وتد", "دعامة"), listOf(TOOTH, "M12 5.5v9", "M10 7h4")),
        Def(
            "extraction", listOf("extraction", "remove", "خلع"),
            listOf(TOOTH_SMALL, "M15.5 5l4 4", "M19.5 5l-4 4", "M16 14.5c1.8 1 3 2.6 3.4 4.7"),
        ),
        Def(
            "surgery", listOf("surgical", "surgery", "wisdom", "جراحة", "ضرس العقل"),
            listOf(TOOTH_SMALL, "M20.3 3.7l-6.2 6.2c-.9.9-2.1 1.3-3.3 1.3 0-1.2.4-2.4 1.3-3.3l1.6-1.6", "M14.5 16.5h5"),
        ),
        Def(
            "implant", listOf("implant", "زرع", "زراعة"),
            listOf("M9 4h6l-1 3h-4z", "M9.7 9.5h4.6", "M10 12h4", "M10.3 14.5h3.4", "M10.7 17h2.6l-1.3 2.8z", "M8 7h8"),
        ),
        Def(
            "implant-crown", listOf("implant crown", "زراعة تاج"),
            listOf(
                "M8.5 8.5c0-2.6 1.6-4.3 3.5-4.3s3.5 1.7 3.5 4.3c0 .8-.4 1.3-1.1 1.3h-4.8c-.7 0-1.1-.5-1.1-1.3z",
                "M9.8 12h4.4", "M10.2 14.5h3.6", "M10.7 17h2.6l-1.3 2.9z",
            ),
        ),
        Def(
            "crown", listOf("crown", "cap", "تاج", "تلبيسة", "طربوش"),
            listOf("M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z"),
        ),
        Def(
            "crown-zircon", listOf("zircon", "zirconia", "زيركون"),
            listOf("M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z", sparkle(19.6, 4.4, 1.7)),
            setOf(2),
        ),
        Def(
            "crown-emax", listOf("emax", "e-max", "e max", "إيماكس", "ايماكس"),
            listOf("M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z", "M8 13.5h8", "M8.8 16.5h6.4"),
        ),
        Def(
            "crown-metal", listOf("pfm", "metal", "porcelain fused", "معدن", "معدني"),
            listOf(
                "M6 9.5l2-4 2.7 2.5L12 4l1.3 4 2.7-2.5 2 4z", "M7 9.5h10v2.2c0 4-1.6 8-5 8s-5-4-5-8z",
                "M7.3 12.8h9.4v1.6c-.2 1-.5 2-.9 2.9H8.2c-.4-.9-.7-1.9-.9-2.9z",
            ),
            setOf(2),
        ),
        Def(
            "bridge", listOf("bridge", "جسر", "كوبري"),
            listOf(
                "M3.5 8h17",
                "M5 8v2.5c0 2.4.9 4.5 2.4 4.5s2.4-2.1 2.4-4.5V8",
                "M14.2 8v2.5c0 2.4.9 4.5 2.4 4.5s2.4-2.1 2.4-4.5V8",
                "M9.8 8v1.8c0 1.7.9 3.2 2.2 3.2s2.2-1.5 2.2-3.2V8",
            ),
        ),
        Def(
            "veneer", listOf("veneer", "laminate", "فينير", "قشرة", "عدسات"),
            listOf(TOOTH, "M8.3 6.2c-1 1.5-1.2 3.6-.7 5.6.4 1.7 1.4 3.4 2.9 4.4"),
        ),
        Def(
            "veneer-emax", listOf("emax veneer", "فينير ايماكس"),
            listOf(TOOTH, "M8.3 6.2c-1 1.5-1.2 3.6-.7 5.6.4 1.7 1.4 3.4 2.9 4.4", sparkle(19.4, 4.8, 1.6)), setOf(2),
        ),
        Def(
            "smile-design", listOf("smile", "hollywood", "design", "ابتسامة", "هوليود"),
            listOf(
                "M4 8.5c2.2 4.2 4.9 6.3 8 6.3s5.8-2.1 8-6.3",
                "M8.2 11.9v2.6", "M12 12.8v3", "M15.8 11.9v2.6", sparkle(19.5, 4.8, 1.7),
            ),
            setOf(4),
        ),
        Def(
            "denture", listOf("denture", "full denture", "طقم"),
            listOf(
                "M4 14.5C4 9 7.5 5.5 12 5.5S20 9 20 14.5v1.2c0 1.5-1.2 2.8-2.8 2.8H6.8C5.2 18.5 4 17.2 4 15.7z",
                "M8 12.2v3.4", "M12 11.5v4.1", "M16 12.2v3.4", "M4.6 12.2h14.8",
            ),
        ),
        Def(
            "partial-denture", listOf("partial", "جزئي"),
            listOf(
                "M5 16.5c0-6 3-9.5 7-9.5", "M12 7c4 0 7 3.5 7 9.5",
                "M5 16.5c2 1.4 4.4 2 7 2s5-.6 7-2", "M9 13.5v3.9", "M15 13.5v3.9",
            ),
        ),
        Def("braces", listOf("braces", "ortho", "orthodontic", "تقويم"), listOf(TOOTH, "M4.5 11.5h15", "M10.4 9.9h3.2v3.2h-3.2z")),
        Def(
            "aligner", listOf("aligner", "invisalign", "clear", "شفاف"),
            listOf(
                "M5.5 10c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5",
                "M5.5 10c0 2 1 3.7 2.6 3.7 1.3 0 1.6-1 3.9-1s2.6 1 3.9 1c1.6 0 2.6-1.7 2.6-3.7",
                "M4.5 17.5c2.3 1.6 4.8 2.4 7.5 2.4s5.2-.8 7.5-2.4",
            ),
        ),
        Def(
            "retainer", listOf("retainer", "مثبت"),
            listOf(
                "M4.5 15.5C4.5 10 7.8 6 12 6s7.5 4 7.5 9.5",
                "M6.5 13c1.7-.9 3.6-1.4 5.5-1.4s3.8.5 5.5 1.4", "M6.5 13v3.4", "M17.5 13v3.4",
            ),
        ),
        Def(
            "night-guard", listOf("guard", "splint", "bruxism", "واقي", "جز"),
            listOf("M12 3.5l7 2.6v5.4c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V6.1z", "M8.8 11.2l2.2 2.2 4.2-4.2"),
        ),
        Def(
            "xray", listOf("xray", "x-ray", "radiograph", "panorama", "أشعة", "اشعة"),
            listOf("M4.5 4.5h15v15h-15z", TOOTH_SMALL.replace("M9.5 4.2", "M12 6.8"), "M16.5 15.5v2", "M16.5 11.5v1.5"),
        ),
        Def(
            "scan", listOf("scan", "3d", "cbct", "diagnostic", "مسح", "تشخيص"),
            listOf(TOOTH_SMALL, "M13.5 13.5a4.2 4.2 0 1 0 8.4 0 4.2 4.2 0 1 0-8.4 0", "M20.6 16.6l2 2"),
        ),
        Def(
            "perio", listOf("gum", "perio", "gingiv", "لثة"),
            listOf(TOOTH_SMALL, "M3.5 18.5c1.2-1.2 2.4-1.8 3.7-1.8 1.6 0 2.4 1 4 1s2.4-1 4-1c1.3 0 2.5.6 3.7 1.8"),
        ),
        Def(
            "pediatric", listOf("pediatric", "kids", "child", "أطفال", "اطفال"),
            listOf(TOOTH, "M9.3 9.3h.01", "M14.7 9.3h.01", "M9.8 11.6c.6.7 1.3 1.1 2.2 1.1s1.6-.4 2.2-1.1"),
        ),
        Def(
            "anesthesia", listOf("anesthesia", "injection", "بنج", "تخدير", "حقن"),
            listOf(
                "M13.5 5.5l5 5", "M15 4l5 5",
                "M12 7l5 5-6.5 6.5c-.9.9-2.3.9-3.2 0l-1.8-1.8c-.9-.9-.9-2.3 0-3.2z",
                "M5 19l-1.5 1.5", "M9.8 11.8l1.7 1.7",
            ),
        ),
        Def(
            "medication", listOf("medication", "drug", "antibiotic", "دواء", "مضاد"),
            listOf(
                "M8.2 4.5h7.6v3.2H8.2z",
                "M7 7.7h10v9.3c0 1.4-1.1 2.5-2.5 2.5h-5C8.1 19.5 7 18.4 7 17z",
                "M10 12.5h4", "M12 10.5v4",
            ),
        ),
    )

    /** One category of the price list. Keys match the website's DENTAL_CATEGORIES. */
    data class Category(val key: String, val en: String, val ar: String, val icon: String, val keywords: List<String>)

    val CATEGORIES: List<Category> = listOf(
        Category("diagnostics", "Check-ups & X-ray", "كشف وأشعة", "checkup", listOf("consult", "checkup", "exam", "xray", "x-ray", "scan", "كشف", "استشارة", "أشعة")),
        Category("prevention", "Cleaning & Prevention", "تنظيف ووقاية", "cleaning", listOf("clean", "scaling", "polish", "fluoride", "تنظيف")),
        Category("whitening", "Whitening", "تبييض", "whitening", listOf("whiten", "bleach", "zoom", "تبييض")),
        Category("restorative", "Fillings", "حشوات", "filling", listOf("filling", "composite", "restoration", "حشو")),
        Category("endo", "Root Canal", "علاج العصب", "root-canal", listOf("root", "canal", "endo", "nerve", "pulp", "عصب")),
        Category("crowns", "Crowns & Bridges", "تركيبات وجسور", "crown", listOf("crown", "bridge", "zircon", "emax", "pfm", "cap", "تاج", "تلبيسة", "جسر", "زيركون", "ايماكس")),
        Category("veneers", "Veneers", "فينير", "veneer", listOf("veneer", "laminate", "hollywood", "smile", "فينير", "عدسات", "ابتسامة")),
        Category("implants", "Implants", "زراعة", "implant", listOf("implant", "زراعة", "زرع")),
        Category("surgery", "Extraction & Surgery", "خلع وجراحة", "extraction", listOf("extraction", "surgical", "wisdom", "خلع", "جراحة")),
        Category("ortho", "Orthodontics", "تقويم", "braces", listOf("braces", "ortho", "aligner", "retainer", "تقويم", "مثبت")),
        Category("prostho", "Dentures", "أطقم", "denture", listOf("denture", "partial", "طقم")),
        Category("perio", "Gum Treatment", "علاج اللثة", "perio", listOf("gum", "perio", "لثة")),
        Category("pediatric", "Pediatric", "أسنان أطفال", "pediatric", listOf("pediatric", "child", "kids", "أطفال")),
        Category("other", "Other", "أخرى", "tooth", emptyList()),
    )

    fun categoryOf(key: String?): Category = CATEGORIES.firstOrNull { it.key == key } ?: CATEGORIES.last()

    fun categoryLabel(key: String?, arabic: Boolean): String =
        categoryOf(key).let { if (arabic) it.ar else it.en }

    /** Keyword-matched category for services saved before categories existed. */
    fun suggestCategory(name: String): String {
        val lower = name.lowercase()
        var best: Pair<String, Int>? = null
        for (cat in CATEGORIES) {
            for (keyword in cat.keywords) {
                if (keyword in lower && (best == null || keyword.length > best!!.second)) {
                    best = cat.key to keyword.length
                }
            }
        }
        return best?.first ?: "other"
    }

    private fun suggestIcon(name: String): String? {
        val lower = name.lowercase()
        var best: Pair<String, Int>? = null
        for (def in DEFS) {
            for (keyword in def.keywords) {
                if (keyword in lower && (best == null || keyword.length > best!!.second)) {
                    best = def.id to keyword.length
                }
            }
        }
        return best?.first
    }

    /** Best icon id for a service: its saved icon, else its name, else its category. */
    fun idForService(icon: String?, name: String, category: String?): String {
        if (icon != null && DEFS.any { it.id == icon }) return icon
        return suggestIcon(name) ?: categoryOf(category ?: suggestCategory(name)).icon
    }

    private val cache = mutableMapOf<String, ImageVector>()

    /** The icon as an ImageVector, tinted by whatever Icon() draws it with. */
    fun get(id: String?): ImageVector {
        val def = DEFS.firstOrNull { it.id == id } ?: DEFS.first()
        return cache.getOrPut(def.id) { build(def) }
    }

    private fun build(def: Def): ImageVector {
        val builder = ImageVector.Builder(
            name = "dental-${def.id}",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        )
        def.paths.forEachIndexed { index, data ->
            val nodes = PathParser().parsePathString(data).toNodes()
            if (index in def.filled) {
                builder.addPath(pathData = nodes, fill = SolidColor(Color.Black))
            } else {
                builder.addPath(
                    pathData = nodes,
                    fill = null,
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 1.7f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }
        return builder.build()
    }
}
