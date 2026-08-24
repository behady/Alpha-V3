package com.alphadental.clinic.ai

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Understands "make me a finance PDF for last month" and "pdf of this week's
 * appointments" without spending an AI credit.
 *
 * These are the two documents the phone can draw entirely by itself: the data is
 * in Firestore and the PDF is rendered locally. Everything else falls through to
 * the server assistant unchanged, so a miss costs nothing but the credit the
 * question would have cost anyway.
 *
 * The parser must say what the report is ABOUT, not merely that a report was
 * mentioned. An earlier version treated the bare word "pdf" — and later, any
 * mention of a period — as proof that clinic money was wanted, so "can you make
 * a pdf with this week appointments?" came back as a week of takings. There is
 * no end to the list of things a PDF might be of, so the rule is inverted: a
 * prompt is claimed only when it names one of the two subjects this file knows
 * how to draw.
 */
object ReportIntent {

    /** Which of the two documents the phone was asked for. */
    enum class Kind { FINANCE, SCHEDULE }

    /** One resolved request: what to draw, and the period to draw it for. */
    data class Request(val kind: Kind, val period: Period)

    /** A period to report on, inclusive at both ends. */
    data class Period(
        val from: String,
        val to: String,
        val labelEn: String,
        val labelAr: String,
    )

    private val FMT = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    /**
     * Words that ask for a document rather than an answer. "Print tomorrow's
     * schedule" wants the same thing "pdf of tomorrow's appointments" wants, and
     * a printed sheet is the whole point of the feature for most of the clinic.
     */
    private val REPORT_WORDS = listOf(
        "pdf", "report", "print", "printout",
        "تقرير", "تقارير", "اطبع", "أطبع", "طباعة",
    )

    private val FINANCE_WORDS = listOf(
        "finance", "financial", "money", "income", "revenue", "expense", "profit", "takings", "cash",
        "مالي", "مالية", "المالي", "الحسابات", "حسابات", "دخل", "الدخل", "مصروف", "مصاريف",
        "ايراد", "إيراد", "ارباح", "أرباح", "ربح", "تحصيل", "فلوس",
    )

    private val SCHEDULE_WORDS = listOf(
        "appointment", "appointments", "schedule", "booking", "bookings",
        "agenda", "diary", "clinic day", "day sheet",
        "مواعيد", "المواعيد", "موعد", "جدول", "الجدول", "حجز", "حجوزات", "اجندة", "أجندة",
    )

    /**
     * Documents this file cannot draw, however the sentence is phrased.
     *
     * A prescription for last month's patient would otherwise satisfy the period
     * test and come back as a schedule. Naming one of these ends the matter: the
     * assistant, which can explain where that document lives, gets the prompt.
     */
    private val NOT_OURS = listOf(
        "prescription", "rx", "treatment plan", "x-ray", "xray", "radiograph", "referral",
        "روشتة", "روشته", "وصفة", "خطة العلاج", "أشعة", "اشعة", "تحويل",
    )

    /**
     * Null when the prompt is not one of the two reports the phone draws.
     *
     * Being strict here is deliberate: a false positive does not merely waste a
     * credit, it hands back the wrong document and keeps doing so however the
     * question is reworded.
     */
    fun parse(prompt: String, now: Calendar = Calendar.getInstance()): Request? {
        val lower = prompt.lowercase()

        if (REPORT_WORDS.none { it in lower }) return null
        if (NOT_OURS.any { it in lower }) return null

        val period = findPeriod(lower, now)

        // The schedule is checked first: "pdf of this week's appointments and what
        // we took" is a day sheet with a money aside, not a ledger.
        if (SCHEDULE_WORDS.any { it in lower }) {
            return Request(Kind.SCHEDULE, period ?: today(now))
        }
        if (FINANCE_WORDS.any { it in lower }) {
            return Request(Kind.FINANCE, period ?: thisMonth(now))
        }

        // A period on its own says when, never what. "Make a pdf for last month"
        // is a question for the assistant, not a guess for this parser to make.
        return null
    }

    private fun findPeriod(lower: String, now: Calendar): Period? {
        fun key(cal: Calendar): String = FMT.format(cal.time)

        if (listOf("yesterday", "امس", "أمس", "امبارح", "إمبارح").any { it in lower }) {
            val cal = now.clone() as Calendar
            cal.add(Calendar.DAY_OF_YEAR, -1)
            return Period(key(cal), key(cal), "yesterday", "أمس")
        }
        if (listOf("tomorrow", "بكرة", "بكره", "غدا", "غداً").any { it in lower }) {
            val cal = now.clone() as Calendar
            cal.add(Calendar.DAY_OF_YEAR, 1)
            return Period(key(cal), key(cal), "tomorrow", "بكرة")
        }
        if (listOf("today", "اليوم", "النهارده", "النهاردة").any { it in lower }) {
            return Period(key(now), key(now), "today", "اليوم")
        }
        if (listOf("next week", "الاسبوع الجاي", "الأسبوع القادم", "الاسبوع القادم").any { it in lower }) {
            val start = now.clone() as Calendar
            start.add(Calendar.DAY_OF_YEAR, 1)
            val end = now.clone() as Calendar
            end.add(Calendar.DAY_OF_YEAR, 7)
            return Period(key(start), key(end), "the next 7 days", "الأيام السبعة القادمة")
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

    /** The default for a schedule: the day in front of them. */
    private fun today(now: Calendar): Period =
        Period(FMT.format(now.time), FMT.format(now.time), "today", "اليوم")

    /** The default when someone just says "finance report": this month so far. */
    private fun thisMonth(now: Calendar): Period {
        val cal = now.clone() as Calendar
        cal.set(Calendar.DAY_OF_MONTH, 1)
        return Period(FMT.format(cal.time), FMT.format(now.time), "this month", "هذا الشهر")
    }
}
