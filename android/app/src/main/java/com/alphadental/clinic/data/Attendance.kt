package com.alphadental.clinic.data

import android.util.Log
import com.alphadental.clinic.Firebase
import com.google.firebase.Timestamp
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.Calendar
import java.util.Date

/**
 * Who is in the building, for the person who is not.
 *
 * The phone could already clock a member of staff in and out. What it could not do is answer
 * the owner's question from the car: who has arrived, who is late, who went home. The website's
 * Attendance page answers it with a roster over today's punches; this is that roster, read from
 * the same `attendance` and `staff` documents, with the same rules.
 *
 * The period figures (days worked, hours, lateness, absences) are NOT computed here. They come
 * from the server's payroll route, which the website and the weekly brief also call, so the
 * phone can never quote a different number of hours than the desk. See `ai/PayrollClient.kt`.
 */
object Attendance {

    private const val TAG = "AlphaAttendance"

    /** One weekday's expected hours. `start`/`end` are "HH:mm". */
    data class DaySchedule(val active: Boolean, val start: String, val end: String)

    data class StaffMember(
        val id: String,
        val uid: String,
        val name: String,
        val role: String,
        /** Keyed 0 = Sunday … 6 = Saturday, as JavaScript's getDay() numbers them. */
        val schedule: Map<Int, DaySchedule>,
        /** False when nobody has set this person's hours; the website's default was used instead. */
        val hasSchedule: Boolean,
    )

    /** One clock-in, open or closed. */
    data class Punch(
        val id: String,
        val userId: String,
        val staffId: String,
        val userName: String,
        val checkInMillis: Long,
        val checkOutMillis: Long?,
        val durationMinutes: Int,
        /** "active" or "completed". */
        val status: String,
    )

    enum class State { ON_SHIFT, DONE, NOT_ARRIVED, EXPECTED, DAY_OFF }

    /** One line of today's roster. */
    data class RosterRow(
        val member: StaffMember,
        val punch: Punch?,
        val state: State,
        /** Minutes after the scheduled start the person clocked in, or has failed to. 0 when on time. */
        val lateMinutes: Int,
        /** Minutes worked so far today (live for an open shift). */
        val minutesToday: Int,
        /** Today's expected window, or null on a day off. */
        val expected: DaySchedule?,
    )

    /**
     * The website's fallback for a member with no hours set: Sunday to Thursday, 13:00–21:00.
     * Mirrors getDefaultSchedule() on the Attendance page — the roster must agree with the desk
     * about whether someone was due in.
     */
    private fun defaultSchedule(): Map<Int, DaySchedule> =
        (0..6).associateWith { DaySchedule(active = it in 0..4, start = "13:00", end = "21:00") }

    private fun parseSchedule(raw: Any?): Map<Int, DaySchedule>? {
        val map = raw as? Map<*, *> ?: return null
        val out = mutableMapOf<Int, DaySchedule>()
        for (day in 0..6) {
            val d = (map[day.toString()] ?: map[day]) as? Map<*, *> ?: continue
            out[day] = DaySchedule(
                active = d["active"] == true,
                start = d["start"]?.toString().orEmpty().ifBlank { "09:00" },
                end = d["end"]?.toString().orEmpty().ifBlank { "17:00" },
            )
        }
        return if (out.isEmpty()) null else out
    }

    private fun clinic(clinicId: String) = Firebase.db().collection("clinics").document(clinicId)

    /** Everyone on the clinic's staff list, with their hours. */
    suspend fun loadStaff(clinicId: String): List<StaffMember> {
        val snap = clinic(clinicId).collection("staff").get().await()
        return snap.documents.map { d ->
            val schedule = parseSchedule(d.get("attendanceSchedule"))
            StaffMember(
                id = d.id,
                uid = d.getString("uid").orEmpty(),
                name = d.getString("name").orEmpty().ifBlank { d.getString("email").orEmpty() },
                role = d.getString("role").orEmpty(),
                schedule = schedule ?: defaultSchedule(),
                hasSchedule = schedule != null,
            )
        }.sortedBy { it.name.lowercase() }
    }

    /**
     * Today's punches, live.
     *
     * A range on the server timestamp rather than the `date` string, because the earliest rows
     * were written before `date` existed and the website's own query does the same. Live because
     * this is watched from outside the building: a clock-in should appear the moment it happens.
     */
    fun observeToday(clinicId: String, startOfDayMillis: Long): Flow<Result<List<Punch>>> = callbackFlow {
        val registration = clinic(clinicId).collection("attendance")
            .whereGreaterThanOrEqualTo("checkIn", Timestamp(Date(startOfDayMillis)))
            .orderBy("checkIn", Query.Direction.DESCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "attendance failed: ${error.message}")
                    trySend(Result.failure(error))
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                trySend(
                    Result.success(
                        snapshot.documents.mapNotNull { d ->
                            val checkIn = d.getTimestamp("checkIn")?.toDate()?.time ?: return@mapNotNull null
                            Punch(
                                id = d.id,
                                userId = d.getString("userId").orEmpty(),
                                staffId = d.getString("staffId").orEmpty(),
                                userName = d.getString("userName").orEmpty(),
                                checkInMillis = checkIn,
                                checkOutMillis = d.getTimestamp("checkOut")?.toDate()?.time,
                                durationMinutes = (d.get("durationMinutes") as? Number)?.toInt() ?: 0,
                                status = d.getString("status").orEmpty(),
                            )
                        }
                    )
                )
            }
        awaitClose { registration.remove() }
    }

    /** Local midnight today, in millis. */
    fun startOfToday(now: Long = System.currentTimeMillis()): Long = Calendar.getInstance().run {
        timeInMillis = now
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        timeInMillis
    }

    private fun minutesOf(hhmm: String): Int {
        val parts = hhmm.split(":")
        val h = parts.getOrNull(0)?.trim()?.toIntOrNull() ?: return 0
        val m = parts.getOrNull(1)?.trim()?.toIntOrNull() ?: 0
        return h * 60 + m
    }

    private fun minuteOfDay(millis: Long): Int = Calendar.getInstance().run {
        timeInMillis = millis
        get(Calendar.HOUR_OF_DAY) * 60 + get(Calendar.MINUTE)
    }

    /**
     * Today's roster: every member, what they did about today, and how late.
     *
     * A person's punches are matched by uid first and staff id second, because older staff records
     * were created before the uid was stored. The most recent punch is the one that describes the
     * day: an open shift means on shift; a closed one means done. Nobody is called late until the
     * scheduled start has actually passed, and a day the schedule marks inactive is a day off,
     * whatever the clock says.
     */
    fun roster(staff: List<StaffMember>, punches: List<Punch>, now: Long = System.currentTimeMillis()): List<RosterRow> {
        val dayOfWeek = Calendar.getInstance().apply { timeInMillis = now }.get(Calendar.DAY_OF_WEEK) - 1 // 0 = Sunday
        val nowMin = minuteOfDay(now)
        return staff.map { member ->
            val mine = punches.filter { p ->
                (member.uid.isNotBlank() && p.userId == member.uid) || (p.staffId.isNotBlank() && p.staffId == member.id)
            }
            val latest = mine.maxByOrNull { it.checkInMillis }
            val first = mine.minByOrNull { it.checkInMillis }
            val expected = member.schedule[dayOfWeek]?.takeIf { it.active }
            val worked = mine.sumOf { p ->
                if (p.status == "active") ((now - p.checkInMillis) / 60_000L).toInt().coerceAtLeast(0) else p.durationMinutes
            }
            val late = if (expected != null && first != null) {
                (minuteOfDay(first.checkInMillis) - minutesOf(expected.start)).coerceAtLeast(0)
            } else if (expected != null && first == null) {
                (nowMin - minutesOf(expected.start)).coerceAtLeast(0)
            } else 0
            val state = when {
                latest?.status == "active" -> State.ON_SHIFT
                latest != null -> State.DONE
                expected == null -> State.DAY_OFF
                nowMin > minutesOf(expected.start) -> State.NOT_ARRIVED
                else -> State.EXPECTED
            }
            RosterRow(member, latest, state, late, worked, expected)
        }.sortedWith(
            // Who needs a glance first: absent-and-late, then on shift, then expected, done, off.
            compareBy<RosterRow> {
                when (it.state) {
                    State.NOT_ARRIVED -> 0
                    State.ON_SHIFT -> 1
                    State.EXPECTED -> 2
                    State.DONE -> 3
                    State.DAY_OFF -> 4
                }
            }.thenBy { it.member.name.lowercase() }
        )
    }
}
