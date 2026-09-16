package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Stage
import com.alphadental.clinic.next.data.Visit
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * How an appointment is drawn, everywhere it is drawn.
 *
 * Shared between the dashboard and the diary deliberately: a patient row that
 * looks slightly different on two screens is how an app stops feeling like one
 * product, and it is exactly what happened to the last one.
 */

/** A run of appointments as ruled rows on one white surface. */
@Composable
fun VisitRows(visits: List<Visit>, showPatient: Boolean = true, onOpen: (Visit) -> Unit) {
    RowGroup {
        visits.forEachIndexed { i, visit ->
            if (i > 0) Rule()
            VisitRow(visit, showPatient) { onOpen(visit) }
        }
    }
}

/**
 * One appointment: the time, who, what for, and the stage.
 *
 * The stage rides the 3dp stripe on the leading edge and the chip at the far
 * end, and tints nothing else. The meridiem sits under the time at half its
 * size so every row's digits start at the same x and the column scans as one.
 */
@Composable
fun VisitRow(visit: Visit, showPatient: Boolean = true, onClick: () -> Unit) {
    val stripe = stageColours(visit.status).stripe
    // A cancelled visit is still part of the day's record, but it is not work to
    // be done — it greys out rather than disappearing, so nobody wonders where
    // the two o'clock went.
    val struck = visit.status == Stage.Cancelled || visit.status == Stage.NoShow

    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(stripe))
        Row(
            Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.width(52.dp)) {
                val parts = visit.time.trim().split(" ", limit = 2)
                Txt(
                    parts.getOrElse(0) { "—" },
                    Type.label.copy(fontSize = 13.sp),
                    if (struck) T.inkFaint else T.ink,
                )
                parts.getOrNull(1)?.let { Txt(it, Type.chip, T.inkFaint, uppercase = true) }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                // Inside a patient's own file the name is on the slab above, so
                // the treatment becomes the line worth reading.
                val title = if (showPatient) {
                    visit.patientName.ifBlank { "No name" }
                } else {
                    visit.treatment.ifBlank { "Appointment" }
                }
                Txt(title, Type.rowName, if (struck) T.inkMuted else T.ink)
                val detail = if (showPatient) {
                    listOf(visit.treatment, visit.doctor)
                } else {
                    listOf(visit.doctor)
                }.filter { it.isNotBlank() }
                if (detail.isNotEmpty()) {
                    Spacer(Modifier.height(2.dp))
                    Txt(detail.joinToString(" · "), Type.caption, T.inkMuted)
                }
            }
            Spacer(Modifier.width(10.dp))
            StageChip(visit.status)
        }
    }
}

/**
 * One appointment as the site's phone draws it: a white card, the time in a
 * column at the start, a coloured stripe, the name over the treatment, and the
 * stage as a small outlined pill at the end.
 */
@Composable
fun VisitCard(visit: Visit, onClick: () -> Unit) {
    val stripe = stageColours(visit.status).stripe
    val struck = visit.status == Stage.Cancelled || visit.status == Stage.NoShow
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
        color = T.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, T.line),
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).clickable(onClick = onClick),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.width(58.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                val parts = visit.time.trim().split(" ", limit = 2)
                Txt(
                    parts.getOrElse(0) { "—" },
                    Type.label.copy(fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
                    if (struck) T.inkFaint else T.ink,
                )
                parts.getOrNull(1)?.let {
                    Spacer(Modifier.height(2.dp))
                    Txt(it, Type.chip, T.inkFaint, uppercase = true)
                }
            }
            Spacer(Modifier.width(10.dp))
            Box(
                Modifier
                    .width(4.dp)
                    .height(46.dp)
                    .background(stripe, androidx.compose.foundation.shape.RoundedCornerShape(2.dp)),
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Txt(
                    visit.patientName.ifBlank { "No name" },
                    Type.heading.copy(fontSize = 16.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
                    if (struck) T.inkMuted else T.ink,
                )
                Spacer(Modifier.height(3.dp))
                Txt(
                    listOf(visit.treatment, visit.doctor).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "—" },
                    Type.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold),
                    T.inkMuted,
                )
            }
            Spacer(Modifier.width(8.dp))
            androidx.compose.material3.Surface(
                shape = T.pill,
                color = T.surfaceSoft,
                border = androidx.compose.foundation.BorderStroke(1.dp, T.line),
            ) {
                Txt(
                    stageLabel(visit.status),
                    Type.chip.copy(fontSize = 9.sp),
                    T.inkBody,
                    Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
                    uppercase = true,
                )
            }
        }
    }
}

@Composable
fun StageChip(stage: Stage) {
    val c = stageColours(stage)
    Chip(stageLabel(stage), c.chipFill, c.chipInk)
}

// ---------------------------------------------------------------------------
// Stage colours.
//
// The same hues the website uses, so a stage learned on one surface is the same
// stage on the other — staff read these by colour before they read the words.
// They never change with theme: "they are here" must not become a different
// colour because someone picked a different accent.
// ---------------------------------------------------------------------------

data class StageColour(val stripe: Color, val chipFill: Color, val chipInk: Color)

fun stageColours(stage: Stage): StageColour = when (stage) {
    // Unconfirmed is a to-do — somebody still has to ring them — so it wears a
    // warm yellow rather than a grey that would read as "all settled".
    Stage.Unconfirmed -> StageColour(Color(0xFFFACC15), Color(0xFFFEF9C3), Color(0xFF854D0E))
    Stage.Confirmed -> StageColour(Color(0xFF2DD4BF), Color(0xFFCCFBF1), Color(0xFF0F766E))
    Stage.CheckedIn -> StageColour(Color(0xFF10B981), Color(0xFFA7F3D0), Color(0xFF065F46))
    Stage.InChair -> StageColour(Color(0xFF0EA5E9), Color(0xFFBAE6FD), Color(0xFF075985))
    Stage.CheckingOut -> StageColour(Color(0xFF06B6D4), Color(0xFFA5F3FC), Color(0xFF155E75))
    Stage.Completed -> StageColour(Color(0xFF94A3B8), Color(0xFFCBD5E1), Color(0xFF475569))
    Stage.Late -> StageColour(Color(0xFFF97316), Color(0xFFFED7AA), Color(0xFF9A3412))
    Stage.Delayed -> StageColour(Color(0xFFF59E0B), Color(0xFFFDE68A), Color(0xFF92400E))
    Stage.Cancelled -> StageColour(Color(0xFFFDA4AF), Color(0xFFFFE4E6), Color(0xFFE11D48))
    Stage.NoShow -> StageColour(Color(0xFFF43F5E), Color(0xFFFECDD3), Color(0xFF9F1239))
    Stage.Rescheduled -> StageColour(Color(0xFF8B5CF6), Color(0xFFDDD6FE), Color(0xFF5B21B6))
}

/** The words the website shows, so the two never disagree about a stage. */
fun stageLabel(stage: Stage): String = when (stage) {
    Stage.Unconfirmed -> "Unconfirmed"
    Stage.Confirmed -> "Confirmed"
    Stage.CheckedIn -> "Checked in"
    Stage.InChair -> "In chair"
    Stage.CheckingOut -> "Check out"
    Stage.Completed -> "Completed"
    Stage.Late -> "Late"
    Stage.Delayed -> "Delayed"
    Stage.Cancelled -> "Canceled"
    Stage.NoShow -> "No show"
    Stage.Rescheduled -> "Rescheduled"
}
