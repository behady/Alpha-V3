package com.alphadental.clinic.ai

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Understands "make me a finance PDF for last month" without spending an AI credit.
 *
 * Report generation is the one assistant job the phone can do entirely by
 * itself: the data is in Firestore, the PDF is drawn locally, and the request is
 * recognisable from a handful of words in either language. Everything this
 * parser does not recognise falls through to the server assistant unchanged, so
 * a miss costs nothing but the credit the question would have cost anyway.
 */
object ReportIntent {

    /** One resolved request: the period to report on, inclusive. */
    data class Period(
        val from: String,
        val to: String,
        val labelEn: String,
        val labelAr: String,
    )

    private val FMT = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    private val REPORT_WORDS = listOf("pdf", "report", "تقرير", "تقارير")
    private val FINANCE_WORDS = listOf(
        "finance", "financial", "money", "income", "revenue", "expense", "profit", "takings", "cash",
        "مالي", "مالية", "المالي", "الحسابات", "حسابات", "دخل", "الدخل", "مصروف", "مصاريف",
        "ايراد", "إيراد", "ارباح", "أرباح", "ربح", "تحصيل", "فلوس",
    )

    /**
     * Null when the prompt is not a report request. "pdf" alone is enough;
     * "report" needs finance words or a period with it, so "report on this
     * patient" still goes to the assistant that can actually answer it.
     */
    fun parse(prompt: String, now: Calendar = Calendar.getInstance()): Period? {
        val lower = prompt.lowercase()
        val wantsReport = REPORT_WORDS.any { it in lower }
        if (!wantsReport) return null

        val period = findPeriod(lower, now)
        val financey = FINANCE_WORDS.any { it in lower }
        val explicitPdf = "pdf" in lower

        if (!explicitPdf && !financey && period == null) return null

        return period ?: thisMonth(now)
    }

    private fun findPeriod(lower: String, now: Calendar): Period? {
        fun key(cal: Calendar): String = FMT.format(cal.time)

        if (listOf("yesterday", "امس", "أمس", "امبارح", "إمبارح").any { it in lower }) {
            val cal = now.clone() as Calendar
            cal.add(Calendar.DAY_OF_YEAR, -1)
            return Period(key(cal), key(cal), "yesterday", "أمس")
        }
        if (listOf("today", "اليوم", "النهارده", "النهاردة").any { it in lower }) {
            return Period(key(now), key(now), "today", "اليوم")
        }
        if (listOf("week", "اسبوع", "أسبوع", "الاسبوع", "الأسبوع").any { it in lower }) {
            val cal = now.clone() as Calendar
            cal.add(Calendar.DAY_OF_YEAR, -6)
            return Period(key(cal), key(now), "the last 7 days", "آخر ٧ أيام")
        }
        if (listOf("last month", "الشهر الماضي", "الشهر اللي فات", "الشهر الفائت").any { it in lower }) {
            val cal = now.clone() as Calendar
            cal.add(Calendar.MONTH, -1)
            cal.set(Calendar.DAY_OF_MONTH, 1)
            val start = key(cal)
            cal.set(Calendar.DAY_OF_MONTH, cal.getActualMaximum(Calendar.DAY_OF_MONTH))
            return Period(start, key(cal), "last month", "الشهر الماضي")
        }
        if (listOf("month", "شهر", "الشهر").any { it in lower }) {
            return thisMonth(now)
        }
        return null
    }

    /** The default when someone just says "finance report": this month so far. */
    private fun thisMonth(now: Calendar): Period {
        val cal = now.clone() as Calendar
        cal.set(Calendar.DAY_OF_MONTH, 1)
        return Period(FMT.format(cal.time), FMT.format(now.time), "this month", "هذا الشهر")
    }
}
