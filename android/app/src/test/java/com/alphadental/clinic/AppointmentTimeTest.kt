package com.alphadental.clinic

import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.ClinicSchedule
import com.alphadental.clinic.data.Geofence
import com.alphadental.clinic.data.InventoryItem
import com.alphadental.clinic.data.hasThreshold
import com.alphadental.clinic.data.isLowStock
import com.alphadental.clinic.data.lowStockCount
import com.alphadental.clinic.data.unconfiguredCount
import com.alphadental.clinic.data.LocationReading
import com.alphadental.clinic.data.isUsableGeofence
import com.alphadental.clinic.data.judgeGeofence
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.LedgerRow
import com.alphadental.clinic.data.LedgerEntry
import com.alphadental.clinic.data.balanceOf
import com.alphadental.clinic.data.splitPayment
import com.alphadental.clinic.data.unpaidProcedures
import com.alphadental.clinic.data.looksLikePhoneSearch
import com.alphadental.clinic.data.patientMatchesSearch
import com.alphadental.clinic.data.buildSlots
import com.alphadental.clinic.data.minutesToTimeKey
import com.alphadental.clinic.data.normalizeTimeKey
import com.alphadental.clinic.data.parseApptTimeToMinutes
import com.alphadental.clinic.data.parseClinicSchedule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The stored time format is a contract with the website, and it has already been broken once
 * there: writing "14:00" where the rest of the system writes "02:00 PM" meant the two never
 * compared equal, so a filled slot still looked free and two patients were booked into one chair.
 *
 * These cases are the same ones lib/appointmentTime.ts has to satisfy. If this file goes red, the
 * phone and the browser have stopped agreeing on what a time is.
 */
class AppointmentTimeTest {

    @Test
    fun `24-hour input becomes the stored 12-hour form`() {
        assertEquals("02:00 PM", normalizeTimeKey("14:00"))
        assertEquals("09:00 AM", normalizeTimeKey("9:00"))
        assertEquals("12:00 AM", normalizeTimeKey("00:00"))
        assertEquals("12:30 PM", normalizeTimeKey("12:30"))
        assertEquals("11:45 PM", normalizeTimeKey("23:45"))
    }

    @Test
    fun `already-canonical times are left alone`() {
        assertEquals("02:00 PM", normalizeTimeKey("02:00 PM"))
        assertEquals("09:30 AM", normalizeTimeKey("09:30 AM"))
    }

    @Test
    fun `single-digit hours gain their leading zero`() {
        // "9:00 AM" and "09:00 AM" must not be two different slots.
        assertEquals("09:00 AM", normalizeTimeKey("9:00 AM"))
        assertEquals("09:00 AM", normalizeTimeKey("9:00 am"))
    }

    @Test
    fun `arabic AM and PM markers are understood`() {
        assertEquals("09:00 AM", normalizeTimeKey("09:00 ص"))
        assertEquals("02:30 PM", normalizeTimeKey("02:30 م"))
    }

    @Test
    fun `minutes conversion round-trips`() {
        assertEquals(0, parseApptTimeToMinutes("12:00 AM"))
        assertEquals(9 * 60, parseApptTimeToMinutes("09:00 AM"))
        assertEquals(12 * 60, parseApptTimeToMinutes("12:00 PM"))
        assertEquals(14 * 60 + 30, parseApptTimeToMinutes("02:30 PM"))

        listOf(0, 9 * 60, 12 * 60, 13 * 60 + 15, 23 * 60 + 59).forEach { minutes ->
            assertEquals(minutes, parseApptTimeToMinutes(minutesToTimeKey(minutes)))
        }
    }

    @Test
    fun `sorting on the raw strings puts the evening before the morning`() {
        // Zero-padding means string order happens to be right within one half of the day,
        // which is exactly what makes this trap easy to miss:
        assertTrue("09:00 AM" < "10:00 AM")

        // But the AM/PM marker sits at the END of the string, so it contributes nothing to the
        // comparison. Sorted as text, a 9pm appointment lands before a 10am one — the whole
        // afternoon shuffled into the middle of the morning.
        assertTrue("09:00 PM" < "10:00 AM")

        // Which is why every ordering in the app goes through minutes instead.
        assertTrue(parseApptTimeToMinutes("09:00 PM") > parseApptTimeToMinutes("10:00 AM"))
        assertTrue(parseApptTimeToMinutes("09:00 AM") < parseApptTimeToMinutes("10:00 AM"))
    }

    @Test
    fun `the day list orders an afternoon clinic correctly`() {
        val day = listOf(
            Appointment(id = "c", time = "01:30 PM"),
            Appointment(id = "a", time = "09:00 AM"),
            Appointment(id = "d", time = "09:00 PM"),
            Appointment(id = "b", time = "10:00 AM"),
        ).sortedBy { it.minutes() }

        assertEquals(listOf("a", "b", "c", "d"), day.map { it.id })
    }

    @Test
    fun `unset clinic hours are reported as not configured`() {
        val fallback = parseClinicSchedule(null)
        assertFalse(fallback.isConfigured)
        assertEquals(9, fallback.startHour)
        assertEquals(21, fallback.endHour)
        assertEquals(30, fallback.slotDuration)
    }

    @Test
    fun `configured clinic hours are read back`() {
        val schedule = parseClinicSchedule(
            mapOf(
                "start" to "10:30",
                "end" to "18:00",
                "slotDuration" to "45",
                "offDays" to listOf("friday"),
                "configuredAt" to "2026-08-12T00:00:00Z",
            )
        )
        assertTrue(schedule.isConfigured)
        assertEquals(10, schedule.startHour)
        assertEquals(30, schedule.startMinute)
        assertEquals(45, schedule.slotDuration)
        assertEquals(listOf("friday"), schedule.offDays)
    }

    @Test
    fun `a booked appointment blocks its slot and only its slot`() {
        val schedule = ClinicSchedule(startHour = 9, endHour = 11, slotDuration = 30, isConfigured = true)
        val slots = buildSlots(
            schedule,
            listOf(Appointment(id = "a", time = "09:30 AM", duration = 30, patientName = "Ali")),
        )

        assertEquals(listOf("09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM"), slots.map { it.time })
        assertTrue(slots[0].isFree)
        assertFalse(slots[1].isFree)
        assertEquals("Ali", slots[1].takenBy)
        assertTrue(slots[2].isFree)
    }

    @Test
    fun `a long appointment blocks every slot it covers`() {
        val schedule = ClinicSchedule(startHour = 9, endHour = 11, slotDuration = 30, isConfigured = true)
        val slots = buildSlots(
            schedule,
            listOf(Appointment(id = "a", time = "09:00 AM", duration = 60, patientName = "Sara")),
        )
        assertFalse(slots[0].isFree)
        assertFalse(slots[1].isFree) // 09:30 is still inside the 60-minute visit
        assertTrue(slots[2].isFree)
    }

    @Test
    fun `cancelled appointments give their slot back`() {
        val schedule = ClinicSchedule(startHour = 9, endHour = 10, slotDuration = 30, isConfigured = true)
        val slots = buildSlots(
            schedule,
            listOf(Appointment(id = "a", time = "09:00 AM", duration = 30, status = "Cancelled", patientName = "Omar")),
        )
        assertTrue("a cancelled visit must not hold the chair", slots[0].isFree)
    }

    @Test
    fun `the appointment being moved does not block itself`() {
        val schedule = ClinicSchedule(startHour = 9, endHour = 10, slotDuration = 30, isConfigured = true)
        val existing = Appointment(id = "a", time = "09:00 AM", duration = 30, patientName = "Hana")

        assertFalse(buildSlots(schedule, listOf(existing))[0].isFree)
        assertTrue(
            "rescheduling must offer the slot it currently occupies",
            buildSlots(schedule, listOf(existing), ignoreAppointmentId = "a")[0].isFree,
        )
    }
}

/**
 * The balance shown on a patient's file, and read down the phone to them.
 *
 * The legacy-payment case below is the one that matters: an older payment screen in this system
 * writes the real value into `paid` and leaves `amount` at 0. Those rows are still in live data.
 */
class BalanceTest {

    @org.junit.Test
    fun `charges minus payments`() {
        val balance = balanceOf(
            listOf(
                LedgerRow(type = "procedure", amount = 1000.0),
                LedgerRow(type = "payment", paid = 400.0),
            )
        )
        assertEquals(1000.0, balance.charged, 0.001)
        assertEquals(400.0, balance.paid, 0.001)
        assertEquals(600.0, balance.owed, 0.001)
    }

    @org.junit.Test
    fun `a payment with amount left at zero still counts`() {
        // Reading `amount` first here would report the full 800 as outstanding.
        val balance = balanceOf(
            listOf(
                LedgerRow(type = "procedure", amount = 800.0),
                LedgerRow(type = "payment", amount = 0.0, paid = 500.0),
            )
        )
        assertEquals(300.0, balance.owed, 0.001)
    }

    @org.junit.Test
    fun `a procedure falls back to cost when amount is absent`() {
        val balance = balanceOf(listOf(LedgerRow(type = "procedure", cost = 250.0)))
        assertEquals(250.0, balance.charged, 0.001)
    }

    @org.junit.Test
    fun `clinic expenses are never a patient debt`() {
        val balance = balanceOf(
            listOf(
                LedgerRow(type = "procedure", amount = 300.0),
                LedgerRow(type = "expense", amount = 5000.0),
            )
        )
        assertEquals(300.0, balance.owed, 0.001)
    }

    @org.junit.Test
    fun `overpayment reads as credit, not negative debt`() {
        val balance = balanceOf(
            listOf(
                LedgerRow(type = "procedure", amount = 300.0),
                LedgerRow(type = "payment", paid = 500.0),
            )
        )
        assertEquals(0.0, balance.owed, 0.001)
        assertTrue(balance.inCredit)
        assertEquals(200.0, balance.creditAmount, 0.001)
    }

    @org.junit.Test
    fun `a settled patient owes nothing`() {
        val balance = balanceOf(
            listOf(
                LedgerRow(type = "procedure", amount = 500.0),
                LedgerRow(type = "payment", paid = 500.0),
            )
        )
        assertEquals(0.0, balance.owed, 0.001)
        assertFalse(balance.inCredit)
    }
}

/**
 * Patient search matching, which must agree with lib/flexibleSearch.ts on the website.
 *
 * If these diverge, the same person typing the same thing finds a patient in the browser and not
 * on the phone — which reads as "the patient is missing" rather than "the search differs".
 */
class PatientSearchTest {

    @org.junit.Test
    fun `a single letter is enough`() {
        assertTrue(patientMatchesSearch("m", "Mona Ali", null))
        assertTrue(patientMatchesSearch("A", "Ahmed Hassan", null))
        assertFalse(patientMatchesSearch("z", "Ahmed Hassan", null))
    }

    @org.junit.Test
    fun `matching is in the middle of a name, not just the start`() {
        // The reason a name search cannot be a Firestore prefix query.
        assertTrue(patientMatchesSearch("hassan", "Ahmed Hassan", null))
        assertTrue(patientMatchesSearch("med", "Ahmed Hassan", null))
    }

    @org.junit.Test
    fun `name tokens match in any order`() {
        // Egyptian patients are usually recorded with three or four names, and staff rarely type
        // them in the stored order.
        assertTrue(patientMatchesSearch("hassan ahmed", "Ahmed Mohamed Hassan", null))
        assertTrue(patientMatchesSearch("ahmed hassan", "Ahmed Mohamed Hassan", null))
        assertFalse(patientMatchesSearch("ahmed khaled", "Ahmed Mohamed Hassan", null))
    }

    @org.junit.Test
    fun `search ignores case and extra spaces`() {
        assertTrue(patientMatchesSearch("  AHMED   hassan ", "ahmed hassan", null))
    }

    @org.junit.Test
    fun `phone matching compares digits only`() {
        // Stored numbers carry +20, spaces and dashes that nobody types into a search box.
        assertTrue(patientMatchesSearch("1234567", "Mona", "+20 100 1234567"))
        assertTrue(patientMatchesSearch("0100-123", "Mona", "01001234567"))
    }

    @org.junit.Test
    fun `one digit does not match every phone in the register`() {
        // Two digits minimum, matching the website. A single digit appears in almost every number.
        assertFalse(patientMatchesSearch("1", "Mona", "01001234567"))
        assertTrue(patientMatchesSearch("10", "Mona", "01001234567"))
    }

    @org.junit.Test
    fun `an empty search matches everyone, which is what makes browsing work`() {
        assertTrue(patientMatchesSearch("", "Anyone", null))
        assertTrue(patientMatchesSearch("   ", "Anyone", null))
    }

    @org.junit.Test
    fun `phone-shaped terms take the indexed path, names do not`() {
        assertTrue(looksLikePhoneSearch("01001234567"))
        assertTrue(looksLikePhoneSearch("+20 100 123-4567"))
        assertFalse(looksLikePhoneSearch("Ahmed"))
        assertFalse(looksLikePhoneSearch("A1"))
        assertFalse(looksLikePhoneSearch(""))
    }
}

/**
 * How a payment is split between doctor, lab and clinic.
 *
 * These three numbers are written onto the ledger and are what the clinic's profit and the
 * dentist's payout are computed from later. A mistake here does not surface as an error — it
 * surfaces as the practice quietly making less money than it did.
 */
class PaymentSplitTest {

    @org.junit.Test
    fun `commission is a percentage of the payment when there is no lab fee`() {
        val split = splitPayment(amount = 1000.0, paidBefore = 0.0, procedureLabFee = 0.0, commissionPercentage = 40.0)
        assertEquals(0.0, split.labFee, 0.001)
        assertEquals(400.0, split.doctorCommissionAmount, 0.001)
        assertEquals(600.0, split.clinicProfit, 0.001)
    }

    @org.junit.Test
    fun `the lab fee comes off before commission is worked out`() {
        // 1000 paid, 200 to the lab, 40% of the remaining 800 to the dentist.
        val split = splitPayment(amount = 1000.0, paidBefore = 0.0, procedureLabFee = 200.0, commissionPercentage = 40.0)
        assertEquals(200.0, split.labFee, 0.001)
        assertEquals(320.0, split.doctorCommissionAmount, 0.001)
        assertEquals(480.0, split.clinicProfit, 0.001)
    }

    @org.junit.Test
    fun `the lab is paid once, not on every instalment`() {
        // Second payment toward the same crown: the lab has already been covered.
        val split = splitPayment(amount = 1000.0, paidBefore = 500.0, procedureLabFee = 200.0, commissionPercentage = 40.0)
        assertEquals("a crown paid in three parts must not pay the lab three times", 0.0, split.labFee, 0.001)
        assertEquals(400.0, split.doctorCommissionAmount, 0.001)
        assertEquals(600.0, split.clinicProfit, 0.001)
    }

    @org.junit.Test
    fun `a payment smaller than the lab fee gives the dentist nothing, never a negative`() {
        val split = splitPayment(amount = 100.0, paidBefore = 0.0, procedureLabFee = 200.0, commissionPercentage = 40.0)
        assertEquals(0.0, split.doctorCommissionAmount, 0.001)
        // The clinic absorbs the shortfall; that is a real loss, and it is reported as one.
        assertEquals(-100.0, split.clinicProfit, 0.001)
    }

    @org.junit.Test
    fun `no commission set means the clinic keeps everything after the lab`() {
        val split = splitPayment(amount = 500.0, paidBefore = 0.0, procedureLabFee = 100.0, commissionPercentage = 0.0)
        assertEquals(0.0, split.doctorCommissionAmount, 0.001)
        assertEquals(400.0, split.clinicProfit, 0.001)
    }

    @org.junit.Test
    fun `the three parts always add back up to what the patient paid`() {
        listOf(
            Triple(1000.0, 200.0, 40.0),
            Triple(750.0, 0.0, 25.0),
            Triple(333.33, 50.0, 33.0),
        ).forEach { (amount, lab, pct) ->
            val s = splitPayment(amount, 0.0, lab, pct)
            assertEquals(
                "doctor + lab + clinic must equal the payment",
                amount,
                s.doctorCommissionAmount + s.labFee + s.clinicProfit,
                0.001,
            )
        }
    }

    @org.junit.Test
    fun `outstanding procedures are worked out from the ledger`() {
        val rows = listOf(
            LedgerEntry(id = "p1", type = "procedure", description = "Crown", amount = 3000.0),
            LedgerEntry(id = "pay1", type = "payment", paid = 1000.0, procedureId = "p1"),
            LedgerEntry(id = "p2", type = "procedure", description = "Filling", amount = 500.0),
            LedgerEntry(id = "pay2", type = "payment", paid = 500.0, procedureId = "p2"),
            // An advance payment belongs to no procedure and must not reduce one.
            LedgerEntry(id = "pay3", type = "payment", paid = 800.0, procedureId = ""),
        )

        val outstanding = unpaidProcedures(rows)
        assertEquals("the settled filling drops off the list", 1, outstanding.size)
        assertEquals("p1", outstanding[0].id)
        assertEquals(1000.0, outstanding[0].paidSoFar, 0.001)
        assertEquals(2000.0, outstanding[0].remaining, 0.001)
    }

    @org.junit.Test
    fun `a procedure stored with cost instead of amount still counts`() {
        val rows = listOf(LedgerEntry(id = "p1", type = "procedure", description = "Scaling", cost = 400.0))
        assertEquals(400.0, unpaidProcedures(rows)[0].remaining, 0.001)
    }
}

/**
 * The clinic geofence, which must agree with lib/attendanceLocation.ts.
 *
 * The website had a real failure here: the same person, same phone, same chair, could clock in one
 * hour and not the next — because a single GPS reading was trusted and its own stated margin of
 * error ignored. These cases pin the fix.
 */
class GeofenceTest {

    private val clinic = Geofence(lat = 30.0444, lng = 31.2357, radius = 50.0)

    /** A reading `metres` north of the clinic, claiming `accuracy` metres of error. */
    private fun readingAtMetres(metres: Double, accuracy: Double): LocationReading {
        // ~111,320 m per degree of latitude.
        return LocationReading(clinic.lat + metres / 111_320.0, clinic.lng, accuracy)
    }

    @org.junit.Test
    fun `a poor fix just outside the fence is forgiven`() {
        // "80m away, give or take 90m" — the exact case that used to be refused.
        val v = judgeGeofence(readingAtMetres(80.0, 90.0), clinic)
        assertTrue(v.inside)
        assertEquals(0, v.effectiveDistance)
        assertTrue("it really is outside the circle on paper", v.distance > clinic.radius)
    }

    @org.junit.Test
    fun `a confident fix well outside is refused`() {
        val v = judgeGeofence(readingAtMetres(120.0, 10.0), clinic)
        assertFalse(v.inside)
        assertEquals(110, v.effectiveDistance)
    }

    @org.junit.Test
    fun `forgiveness is capped, so a hopeless fix cannot buy its way in`() {
        val v = judgeGeofence(readingAtMetres(300.0, 5000.0), clinic)
        assertFalse(v.inside)
        assertEquals("300 - 100, not 300 - 5000", 200, v.effectiveDistance)
    }

    @org.junit.Test
    fun `someone standing in the clinic is inside`() {
        assertTrue(judgeGeofence(readingAtMetres(20.0, 8.0), clinic).inside)
    }

    @org.junit.Test
    fun `an unconfigured or broken geofence is treated as absent, never as satisfied`() {
        // NaN comparisons are all false, so a broken fence once let everyone through silently.
        assertFalse(isUsableGeofence(Geofence(Double.NaN, 31.2, 50.0)))
        assertFalse(isUsableGeofence(Geofence(30.0, Double.NaN, 50.0)))
        assertFalse(isUsableGeofence(Geofence(0.0, 0.0, 50.0)))
        assertFalse(isUsableGeofence(Geofence(30.0, 31.2, 0.0)))
        assertFalse(isUsableGeofence(null))
        assertTrue(isUsableGeofence(clinic))
    }
}

/**
 * The low-stock rule.
 *
 * The trap it guards is documented on the website: a reorder threshold of 0 is the field's old
 * default, not a deliberate "alert me at empty". Treating 0 as a real threshold made every
 * unconfigured item permanently "in stock", so a low-stock check reported all-clear over a shelf
 * nobody had configured.
 */
class InventoryTest {

    @org.junit.Test
    fun `an item at or below its threshold is low`() {
        assertTrue(isLowStock(InventoryItem(stock = 2.0, minStock = 5.0)))
        assertTrue("at the threshold counts as low", isLowStock(InventoryItem(stock = 5.0, minStock = 5.0)))
        assertFalse(isLowStock(InventoryItem(stock = 6.0, minStock = 5.0)))
    }

    @org.junit.Test
    fun `an item with no threshold can never be low, even at zero stock`() {
        val unset = InventoryItem(stock = 0.0, minStock = 0.0)
        assertFalse("0 is 'never configured', not 'alert me at empty'", isLowStock(unset))
        assertFalse(hasThreshold(unset))
    }

    @org.junit.Test
    fun `unconfigured items are counted rather than assumed fine`() {
        val items = listOf(
            InventoryItem(name = "Gloves", stock = 1.0, minStock = 10.0),   // low
            InventoryItem(name = "Masks", stock = 50.0, minStock = 10.0),   // ok
            InventoryItem(name = "Bonding", stock = 0.0, minStock = 0.0),   // never configured
        )
        assertEquals(1, lowStockCount(items))
        assertEquals("the empty unconfigured item must be surfaced, not hidden", 1, unconfiguredCount(items))
    }

    // --- holding a reminder until the clinic's chosen hour ---------------------------------------
    //
    // This phone is what actually enforces "send reminders at 2pm". The server only writes the
    // instant; if the gate here is wrong, either every patient is texted at dawn or nobody is
    // texted at all, and both are silent failures.

    private val noon = java.time.Instant.parse("2026-08-14T12:00:00Z").toEpochMilli()

    @org.junit.Test
    fun `a message with no hold goes out immediately`() {
        assertTrue("an event message carries no stamp and must not be delayed", Repository.isSmsDue(null, noon))
        assertTrue(Repository.isSmsDue("", noon))
        assertTrue(Repository.isSmsDue("   ", noon))
    }

    @org.junit.Test
    fun `a held reminder waits until its hour and then goes`() {
        assertFalse("one second early is still early", Repository.isSmsDue("2026-08-14T12:00:01Z", noon))
        assertFalse(Repository.isSmsDue("2026-08-14T14:00:00Z", noon))
        assertTrue("due exactly now is due", Repository.isSmsDue("2026-08-14T12:00:00Z", noon))
        assertTrue(Repository.isSmsDue("2026-08-14T11:59:59Z", noon))
    }

    @org.junit.Test
    fun `a malformed stamp sends rather than stranding the message`() {
        // Failing closed would leave the message queued forever with nothing on screen to say why,
        // and the cost of that is a patient who is never told about their appointment.
        assertTrue(Repository.isSmsDue("not a date", noon))
        assertTrue(Repository.isSmsDue("2026-13-45", noon))
    }
}
