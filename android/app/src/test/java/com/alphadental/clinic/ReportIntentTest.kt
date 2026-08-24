package com.alphadental.clinic

import com.alphadental.clinic.ai.ReportIntent
import com.alphadental.clinic.ai.ReportIntent.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

/**
 * Which prompts the phone answers by drawing a PDF itself, and which it hands to
 * the assistant.
 *
 * This parser sits in front of every assistant request, so a false positive does
 * not merely waste a credit — it returns the wrong document, and keeps returning
 * it however the question is reworded. That is what "the assistant gets stuck"
 * turned out to mean, so the negative cases below matter more than the positive
 * ones, and every real miss reported from the app should land here as a test.
 */
class ReportIntentTest {

    /** Fixed so "this month" and "this week" cannot drift under the test. */
    private fun march(day: Int): Calendar = Calendar.getInstance().apply {
        set(2026, Calendar.MARCH, day, 12, 0, 0)
    }

    // ---------------------------------------------------------------- schedule

    @Test
    fun `asking for appointments gets the schedule, not the money`() {
        // Reported from the app: this came back as a week of takings, because a
        // period word alone used to be treated as proof that money was wanted.
        val request = ReportIntent.parse("can you make a pdf with this week appointments ?", march(10))
        assertNotNull(request)
        assertEquals(Kind.SCHEDULE, request!!.kind)
        assertEquals("2026-03-04", request.period.from)
        assertEquals("2026-03-10", request.period.to)
    }

    @Test
    fun `the schedule answers to its many names`() {
        listOf(
            "pdf of today's appointments",
            "print the schedule for tomorrow",
            "report of this week's bookings",
            "pdf مواعيد النهاردة",
            "اعمل تقرير بجدول الأسبوع",
        ).forEach {
            val request = ReportIntent.parse(it, march(10))
            assertNotNull("expected '$it' to be a schedule", request)
            assertEquals("expected '$it' to be a schedule", Kind.SCHEDULE, request!!.kind)
        }
    }

    @Test
    fun `a schedule with no period named means today`() {
        val request = ReportIntent.parse("pdf of the appointments", march(10))
        assertNotNull(request)
        assertEquals(Kind.SCHEDULE, request!!.kind)
        assertEquals("2026-03-10", request.period.from)
        assertEquals("2026-03-10", request.period.to)
    }

    @Test
    fun `tomorrow and next week look forward, not back`() {
        val tomorrow = ReportIntent.parse("appointments pdf for tomorrow", march(10))!!
        assertEquals("2026-03-11", tomorrow.period.from)
        assertEquals("2026-03-11", tomorrow.period.to)

        val nextWeek = ReportIntent.parse("pdf of next week appointments", march(10))!!
        assertEquals("2026-03-11", nextWeek.period.from)
        assertEquals("2026-03-17", nextWeek.period.to)
    }

    // ---------------------------------------------------------------- finance

    @Test
    fun `genuine finance requests still work`() {
        listOf(
            "finance pdf for this month",
            "make me a financial report",
            "income report",
            "تقرير مالي",
            "اعمل تقرير الحسابات",
        ).forEach {
            val request = ReportIntent.parse(it, march(10))
            assertNotNull("expected '$it' to build a report", request)
            assertEquals("expected '$it' to be finance", Kind.FINANCE, request!!.kind)
        }
    }

    @Test
    fun `finance periods resolve to the right dates`() {
        val yesterday = ReportIntent.parse("finance report yesterday", march(10))!!
        assertEquals("2026-03-09", yesterday.period.from)
        assertEquals("2026-03-09", yesterday.period.to)

        val lastMonth = ReportIntent.parse("finance report last month", march(10))!!
        assertEquals("2026-02-01", lastMonth.period.from)
        assertEquals("2026-02-28", lastMonth.period.to)

        // No period named: this month so far.
        val thisMonth = ReportIntent.parse("finance report", march(10))!!
        assertEquals("2026-03-01", thisMonth.period.from)
        assertEquals("2026-03-10", thisMonth.period.to)
    }

    // ---------------------------------------------------------------- refusals

    @Test
    fun `a PDF of some other document is not ours to draw`() {
        listOf(
            "make a pdf of Sara's prescription",
            "create a pdf for this treatment plan",
            "send me the x-ray as a pdf",
            "اعمل PDF للروشتة",
            "اطبع خطة العلاج pdf",
        ).forEach {
            assertNull("expected '$it' to fall through to the assistant", ReportIntent.parse(it, march(10)))
        }
    }

    @Test
    fun `the bare word pdf is not enough`() {
        assertNull(ReportIntent.parse("make me a pdf", march(10)))
        assertNull(ReportIntent.parse("pdf please", march(10)))
        assertNull(ReportIntent.parse("اعمل pdf", march(10)))
    }

    @Test
    fun `a period says when, never what`() {
        // The bug this class exists for: "for last month" tells us the range and
        // nothing about the subject, so it is a question for the assistant.
        assertNull(ReportIntent.parse("make a pdf for last month", march(10)))
        assertNull(ReportIntent.parse("report for yesterday", march(10)))
        assertNull(ReportIntent.parse("pdf of everything this week", march(10)))
    }

    @Test
    fun `a report about a patient goes to the assistant`() {
        assertNull(ReportIntent.parse("give me a report on this patient", march(10)))
        assertNull(ReportIntent.parse("تقرير عن المريض ده", march(10)))
    }

    @Test
    fun `an ordinary question is left alone`() {
        assertNull(ReportIntent.parse("who is booked today", march(10)))
        assertNull(ReportIntent.parse("what is Sara's balance", march(10)))
    }
}
