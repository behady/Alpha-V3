package com.alphadental.clinic

import com.alphadental.clinic.data.ReportRow
import com.alphadental.clinic.data.serviceLabelOf
import com.alphadental.clinic.data.summariseReport
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The figures an owner decides things on.
 *
 * Worth testing because every one of these is a number somebody will act on without being able to
 * check it — the whole point of having it on a phone is not opening the books to verify it.
 */
class ReportsTest {

    private fun payment(amount: Double, patient: String = "p1", doctor: String = "") =
        ReportRow(type = "payment", amount = amount, patientId = patient, doctorName = doctor)

    private fun charge(amount: Double, description: String = "Filling", patient: String = "p1") =
        ReportRow(type = "procedure", amount = amount, description = description, patientId = patient)

    @Test
    fun `collected and charged are never mixed`() {
        val summary = summariseReport(listOf(payment(500.0), charge(1200.0)))

        assertEquals("money in the drawer", 500.0, summary.collected, 0.001)
        assertEquals("work billed for", 1200.0, summary.charged, 0.001)
        // A combined "revenue" figure would read 1700 here and flatter the period by counting
        // treatment nobody has paid for.
        assertEquals(700.0, summary.gap, 0.001)
    }

    @Test
    fun `expenses are their own line and never count as income`() {
        val summary = summariseReport(
            listOf(payment(500.0), ReportRow(type = "expense", amount = 300.0))
        )
        assertEquals(500.0, summary.collected, 0.001)
        assertEquals(300.0, summary.expenses, 0.001)
        assertEquals("an expense is not work billed for", 0.0, summary.charged, 0.001)
    }

    @Test
    fun `patients are counted once however often they pay`() {
        val summary = summariseReport(
            listOf(payment(100.0, "p1"), payment(200.0, "p1"), payment(50.0, "p2"))
        )
        assertEquals(2, summary.payingPatients)
        assertEquals(350.0, summary.collected, 0.001)
    }

    @Test
    fun `a patient with no id does not become an anonymous extra patient`() {
        val summary = summariseReport(listOf(payment(100.0, ""), payment(100.0, "")))
        assertEquals(0, summary.payingPatients)
    }

    @Test
    fun `the same treatment groups together whatever teeth it was done on`() {
        // Charges are written as "Root canal (T: 36,37)". Grouping on the raw description would
        // file one treatment under a separate heading for every combination of teeth.
        val summary = summariseReport(
            listOf(
                charge(800.0, "Root canal (T: 36)"),
                charge(800.0, "Root canal (T: 37,38)"),
                charge(300.0, "Filling (T: 11)"),
            )
        )

        assertEquals(2, summary.byService.size)
        assertEquals("biggest first", "Root canal", summary.byService[0].label)
        assertEquals(2, summary.byService[0].count)
        assertEquals(1600.0, summary.byService[0].total, 0.001)
        assertEquals("Filling", summary.byService[1].label)
    }

    @Test
    fun `a description with no service name still lands somewhere`() {
        assertEquals("General", serviceLabelOf(""))
        assertEquals("General", serviceLabelOf("(T: 36)"))
        assertEquals("Crown", serviceLabelOf("Crown"))
        assertEquals("Crown", serviceLabelOf("Crown (T: 36)"))
    }

    @Test
    fun `dentist figures are payments, not work done`() {
        val summary = summariseReport(
            listOf(
                payment(500.0, doctor = "Ahmed"),
                payment(300.0, doctor = "Ahmed"),
                payment(200.0, doctor = "Sara"),
                // A charge credited to a dentist is work done, not money arrived. Counting it here
                // would answer a different question from the one "how did Ahmed do" asks.
                ReportRow(type = "procedure", amount = 9000.0, doctorName = "Ahmed"),
            )
        )

        assertEquals(2, summary.byDoctor.size)
        assertEquals("Ahmed", summary.byDoctor[0].label)
        assertEquals(800.0, summary.byDoctor[0].total, 0.001)
        assertEquals("Sara", summary.byDoctor[1].label)
    }

    @Test
    fun `payments with no dentist are left out rather than lumped under a blank name`() {
        val summary = summariseReport(listOf(payment(500.0, doctor = ""), payment(100.0, doctor = "Sara")))
        assertEquals(1, summary.byDoctor.size)
        assertEquals("Sara", summary.byDoctor[0].label)
        assertEquals("but they still count as money taken", 600.0, summary.collected, 0.001)
    }

    @Test
    fun `an empty period reports zeroes rather than failing`() {
        val summary = summariseReport(emptyList())
        assertEquals(0.0, summary.collected, 0.001)
        assertEquals(0.0, summary.charged, 0.001)
        assertEquals(0, summary.payingPatients)
        assertEquals(0, summary.byService.size)
    }
}
