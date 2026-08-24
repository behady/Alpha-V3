package com.alphadental.clinic

import com.alphadental.clinic.ai.ReportIntent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

/**
 * Which prompts the phone answers by drawing a finance report, and which it must
 * hand to the assistant instead.
 *
 * This parser sits in front of every assistant request, so a false positive does
 * not merely waste a credit — it replaces the answer someone asked for with a
 * month of clinic takings, and no rephrasing gets past it as long as the same
 * word is in the sentence. That is what "the assistant gets stuck" turned out to
 * mean, so the negative cases below matter more than the positive ones.
 */
class ReportIntentTest {

    /** Fixed so "this month" cannot drift under the test. */
    private fun march(day: Int): Calendar = Calendar.getInstance().apply {
        set(2026, Calendar.MARCH, day, 12, 0, 0)
    }

    @Test
    fun `a PDF of some other document is not a finance report`() {
        listOf(
            "make a pdf of Sara's prescription",
            "create a pdf for this treatment plan",
            "send me the x-ray as a pdf",
            "pdf of the patient file",
            "can I get a pdf of this patient's chart",
            "اعمل PDF للروشتة",
            "عايز ملف المريض pdf",
            "اطبع خطة العلاج pdf",
        ).forEach {
            assertNull("expected '$it' to fall through to the assistant", ReportIntent.parse(it, march(10)))
        }
    }

    @Test
    fun `the bare word pdf is not enough`() {
        // It used to be: "pdf" alone returned this month, so every PDF request in
        // the app became a money report.
        assertNull(ReportIntent.parse("make me a pdf", march(10)))
        assertNull(ReportIntent.parse("pdf please", march(10)))
        assertNull(ReportIntent.parse("اعمل pdf", march(10)))
    }

    @Test
    fun `a report about something other than money goes to the assistant`() {
        assertNull(ReportIntent.parse("give me a report on this patient", march(10)))
        assertNull(ReportIntent.parse("تقرير عن المريض ده", march(10)))
    }

    @Test
    fun `genuine finance requests still work`() {
        listOf(
            "finance pdf for this month",
            "make me a financial report",
            "income report",
            "تقرير مالي",
            "اعمل تقرير الحسابات",
        ).forEach {
            assertNotNull("expected '$it' to build a report", ReportIntent.parse(it, march(10)))
        }
    }

    @Test
    fun `a period on its own is a finance request`() {
        // "report for last month" names no document, so the only report the phone
        // draws is the right guess.
        assertNotNull(ReportIntent.parse("report for last month", march(10)))
        assertNotNull(ReportIntent.parse("pdf for yesterday", march(10)))
    }

    @Test
    fun `periods resolve to the right dates`() {
        val yesterday = ReportIntent.parse("finance report yesterday", march(10))
        assertNotNull(yesterday)
        assertEquals("2026-03-09", yesterday!!.from)
        assertEquals("2026-03-09", yesterday.to)

        val lastMonth = ReportIntent.parse("finance report last month", march(10))
        assertNotNull(lastMonth)
        assertEquals("2026-02-01", lastMonth!!.from)
        assertEquals("2026-02-28", lastMonth.to)

        // No period named: this month so far.
        val thisMonth = ReportIntent.parse("finance report", march(10))
        assertNotNull(thisMonth)
        assertEquals("2026-03-01", thisMonth!!.from)
        assertEquals("2026-03-10", thisMonth.to)
    }

    @Test
    fun `an ordinary question is left alone`() {
        assertNull(ReportIntent.parse("who is booked today", march(10)))
        assertNull(ReportIntent.parse("what is Sara's balance", march(10)))
    }
}
