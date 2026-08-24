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
     * Words that name a DIFFERENT document from the clinic's finance report.
     *
     * The only PDF this path can draw is money over a period, so a prompt about a
     * prescription, a treatment plan or a patient's file has to fall through to
     * the assistant untouched. Answering "make a PDF of Sara's prescription" with
     * a month of clinic takings is worse than not answering it at all — and it
     * used to, because "pdf" on its own was treated as proof that a finance
     * report was wanted.
     */
    private val NOT_FINANCE_WORDS = listOf(
        "prescription", "rx", "treatment plan", "x-ray", "xray", "radiograph",
        "patient", "chart", "referral",
        "روشتة", "روشته", "وصفة", "خطة", "خطه", "علاج", "اشعة", "أشعة",
        "ملف", "سجل", "مريض", "مريضة", "تحويل",
    )

    /**
     * Null when the prompt is not a finance-report request.
     *
     * A report word alone proves nothing — it has to be joined by money words or
     * by a period ("last month"), and it must not name some other document. Every
     * miss falls through to the server assistant unchanged, so being strict here
     * costs at most the credit the question would have cost anyway; being loose
     * cost the person the answer they actually asked for.
     */
    fun parse(prompt: String, now: Calendar = Calendar.getInstance()): Period? {
        val lower = prompt.lowercase()
        val wantsReport = REPORT_WORDS.any { it in lower }
        if (!wantsReport) return null

        // Whatever else this is, it is not the clinic's money.
        if (NOT_FINANCE_WORDS.any { it in lower }) return null

        val period = findPeriod(lower, now)
        val financey = FINANCE_WORDS.any { it in lower }

        if (!financey && period == null) return null

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
