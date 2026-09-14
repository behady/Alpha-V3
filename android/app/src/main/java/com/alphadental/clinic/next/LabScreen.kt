package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * The lab board.
 *
 * A queue of work in flight, sorted by how late it is — not by when it was
 * created. A board ordered by creation tells you about the past; this one is
 * meant to be worked down.
 *
 * The count the board leads on that nobody else keeps is **back and waiting**: a
 * crown that arrived a fortnight ago and was never fitted is paid for, finished,
 * and earning nothing.
 */
@Composable
fun LabScreen(
    state: Lab,
    onBack: () -> Unit,
    onFilter: (LabFilter) -> Unit,
    onOpenCase: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Lab",
            eyebrow = if (state.summary.overdue > 0) {
                "${state.summary.overdue} overdue"
            } else {
                "Nothing is late"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
            stats = if (state.loading || state.error != null) emptyList() else listOf(
                Stat("At lab", state.summary.atLab.toString()),
                Stat("Overdue", state.summary.overdue.toString()),
                Stat("Due soon", state.summary.dueThisWeek.toString()),
                Stat("Waiting", state.summary.waitingForPatient.toString()),
            ),
        )

        Filters(state, onFilter)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            state.error != null -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) {
                Txt(state.error, Type.body, T.inkFaint, maxLines = 3)
            }

            state.shown.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) {
                Txt(emptyFor(state.filter), Type.body, T.inkFaint, maxLines = 2)
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                item {
                    RowGroup {
                        state.shown.forEachIndexed { i, case ->
                            if (i > 0) Rule()
                            CaseRow(case, state.today) { onOpenCase(case.id) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Filters(state: Lab, onFilter: (LabFilter) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LabFilter.entries.forEach { f ->
                    val count = when (f) {
                        LabFilter.Open -> state.open.size
                        LabFilter.Overdue -> state.overdue.size
                        LabFilter.Waiting -> state.waiting.size
                        LabFilter.All -> state.cases.size
                    }
                    val selected = f == state.filter
                    Surface(
                        shape = T.pill,
                        color = if (selected) T.slab else T.surface,
                        border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onFilter(f) },
                    ) {
                        Txt(
                            if (count > 0) "${f.label} · $count" else f.label,
                            Type.label.copy(fontSize = 12.sp),
                            if (selected) T.onSlab else T.inkMuted,
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }
            Rule()
        }
    }
}

/**
 * One case.
 *
 * The code leads, because it is what is written on the bag and what somebody
 * reads out on the phone to the lab. The stripe is how late it is, and only a
 * case actually AT the lab can be late — one sitting on the reception desk is a
 * different problem and gets a different colour.
 */
@Composable
private fun CaseRow(case: LabCases.LabCase, today: String, onOpen: () -> Unit) {
    val due = LabCases.dueStateFor(case, today)
    val stripe = when {
        due == LabCases.Due.OVERDUE -> T.danger
        due == LabCases.Due.DUE_TODAY || due == LabCases.Due.DUE_SOON -> T.warn
        case.status == "back" -> T.accent
        case.meta.closed -> Color.Transparent
        else -> T.lineStrong
    }

    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(stripe))
        Column(
            Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt(case.code, Type.label.copy(fontSize = 13.sp), T.ink)
                Spacer(Modifier.width(10.dp))
                StageChip(case)
                if (case.remakeOfCode.isNotBlank()) {
                    Spacer(Modifier.width(6.dp))
                    // A remake is the clinic's own cost, so it is never quiet.
                    Chip("Remake", T.dangerTint, T.danger)
                }
                Spacer(Modifier.weight(1f))
                Txt(dueLabel(case, today, due), Type.chip, dueColour(due, case), uppercase = true)
            }
            Spacer(Modifier.height(6.dp))
            Txt(case.patientName.ifBlank { "No patient" }, Type.rowName, T.ink)
            Spacer(Modifier.height(2.dp))
            Txt(
                listOfNotNull(
                    case.workDescription.takeIf { it.isNotBlank() },
                    case.units.takeIf { it > 1 }?.let { "$it units" },
                    case.labName.takeIf { it.isNotBlank() },
                    case.doctorName.takeIf { it.isNotBlank() },
                ).joinToString(" · "),
                Type.caption,
                T.inkMuted,
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun StageChip(case: LabCases.LabCase) {
    val s = case.meta
    val (fill, ink) = when (s.id) {
        "at_lab", "returned_to_lab" -> Color(0xFFBAE6FD) to Color(0xFF075985)
        "back" -> Color(0xFFFEF9C3) to Color(0xFF854D0E)
        "tryin_back" -> Color(0xFFDDD6FE) to Color(0xFF5B21B6)
        "fitted" -> Color(0xFFA7F3D0) to Color(0xFF065F46)
        "cancelled" -> Color(0xFFFFE4E6) to Color(0xFFE11D48)
        else -> Color(0xFFE2E8F0) to Color(0xFF475569)
    }
    Chip(s.en, fill, ink)
}

/** "3 days late", "due today", "due in 4" — or how long it has sat on the desk. */
private fun dueLabel(case: LabCases.LabCase, today: String, due: LabCases.Due): String {
    if (case.status == "back") {
        // How long it has been waiting, not just that it is. "On the desk" is a
        // state; "on the desk 14 days" is the reason to pick up the phone.
        val sat = case.receivedAt.takeIf { it.isNotBlank() }
            ?.let { LabCases.daysUntil(today, it) }
        return when {
            sat == null -> "on the desk"
            sat <= 0L -> "back today"
            sat == 1L -> "on the desk 1 day"
            else -> "on the desk $sat days"
        }
    }
    if (case.meta.closed) {
        return case.fittedAt.takeIf { it.isNotBlank() }?.let { "fitted ${shortDate(it)}" } ?: case.meta.en
    }
    val days = LabCases.daysUntil(case.dueDate, today) ?: return "no date"
    return when {
        due == LabCases.Due.OVERDUE -> if (days == -1L) "1 day late" else "${-days} days late"
        due == LabCases.Due.DUE_TODAY -> "due today"
        else -> "due in $days"
    }
}

@Composable
private fun dueColour(due: LabCases.Due, case: LabCases.LabCase): Color = when {
    due == LabCases.Due.OVERDUE -> T.danger
    due == LabCases.Due.DUE_TODAY || due == LabCases.Due.DUE_SOON -> T.warn
    case.status == "back" -> T.accentInk
    else -> T.inkFaint
}

private fun emptyFor(filter: LabFilter): String = when (filter) {
    LabFilter.Open -> "Nothing is out at a lab."
    LabFilter.Overdue -> "Nothing is late."
    LabFilter.Waiting -> "Nothing is sitting on the desk."
    LabFilter.All -> "No lab cases yet."
}

private fun shortDate(key: String): String {
    val d = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull()
        ?: return key
    return SimpleDateFormat("d MMM", Locale.US).format(d)
}
