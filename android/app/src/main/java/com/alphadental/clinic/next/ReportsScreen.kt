package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabFigure
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.NumberFormat
import java.util.Locale

/**
 * How the clinic has been doing.
 *
 * Money answers "this month"; this answers "lately, and at what". Collected and
 * charged are never added together anywhere on it — one is money in the drawer,
 * the other is work billed for, and a single "revenue" figure mixing them
 * flatters every period by counting treatment nobody has paid for.
 */
@Composable
fun ReportsScreen(
    state: Reports,
    onBack: () -> Unit,
    onWindow: (Window) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Reports",
            eyebrow = "Last ${state.window.label.lowercase()}",
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
            figure = if (state.loading || state.error != null) null else {
                { SlabFigure(amount = money(state.collected), currency = "EGP in") }
            },
            stats = if (state.loading || state.error != null) emptyList() else listOf(
                Stat("Charged", money(state.charged)),
                Stat("Expenses", money(state.expenses)),
                Stat("Paid up", state.payingPatients.toString()),
            ),
        )

        Windows(state.window, onWindow)

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

            state.lines.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter),
                contentAlignment = Alignment.Center,
            ) {
                Txt("Nothing was recorded in this period.", Type.body, T.inkFaint, maxLines = 2)
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                // Said once, at the top, rather than hedged into every figure
                // below. A clinic a week into the system should be told what it
                // is looking at, not quietly shown a confident-looking report.
                if (state.thin) {
                    item { ThinNote(state.daysWithActivity) }
                }

                item { SectionLabel("Billed against collected") }
                item {
                    RowGroup {
                        // A negative gap means more came in than was billed this
                        // period, which is good news — so it is said as good news
                        // rather than shown as a minus sign in green, which reads
                        // like a figure nobody thought about.
                        val gap = state.gap
                        Fact(
                            when {
                                gap > 0 -> "Billed but not collected"
                                gap < 0 -> "Collected more than billed"
                                else -> "Level"
                            },
                            money(kotlin.math.abs(gap)) + " EGP",
                            when {
                                gap > 0 -> T.warn
                                gap < 0 -> T.ok
                                else -> T.inkMuted
                            },
                        )
                        Rule()
                        Column(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                            Txt(
                                "This is the difference between two flows, not a debt. " +
                                    "A patient can pay this month for work charged last month — " +
                                    "what someone actually owes is on their file.",
                                Type.caption,
                                T.inkMuted,
                                maxLines = 4,
                            )
                        }
                    }
                }

                if (state.byTreatment.isNotEmpty()) {
                    item { SectionLabel("What brought money in") }
                    item { Ranked(state.byTreatment, state.byTreatment.first().total) }
                }

                if (state.byDentist.isNotEmpty()) {
                    item { SectionLabel("By dentist") }
                    item { Ranked(state.byDentist, state.byDentist.first().total) }
                }

                if (state.byExpense.isNotEmpty()) {
                    item { SectionLabel("What it went on") }
                    item { Ranked(state.byExpense, state.byExpense.first().total, cost = true) }
                }
            }
        }
    }
}

@Composable
private fun Windows(current: Window, onWindow: (Window) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.padding(horizontal = T.gutter, vertical = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Window.entries.forEach { w ->
                    val selected = w == current
                    Surface(
                        shape = T.pill,
                        color = if (selected) T.slab else T.surface,
                        border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onWindow(w) },
                    ) {
                        Txt(
                            w.label,
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
 * A ranked list with a bar for each share.
 *
 * The bar is against the biggest row rather than the total, because the question
 * this list answers is "what is the clinic's best earner, and by how far" — not
 * "what fraction of everything was this".
 */
@Composable
private fun Ranked(lines: List<Line>, top: Double, cost: Boolean = false) {
    RowGroup {
        lines.forEachIndexed { i, line ->
            if (i > 0) Rule()
            val share = if (top <= 0) 0f else (line.total / top).toFloat()
            Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Txt(line.label, Type.rowName, T.ink, maxLines = 2)
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            if (line.count == 1) "1 time" else "${line.count} times",
                            Type.caption,
                            T.inkMuted,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Txt(money(line.total), Type.label.copy(fontSize = 13.sp), if (cost) T.danger else T.ink)
                }
                Spacer(Modifier.height(7.dp))
                Box(Modifier.fillMaxWidth().height(3.dp).clip(T.pill).background(T.line)) {
                    Box(
                        Modifier
                            .fillMaxWidth(share)
                            .height(3.dp)
                            .clip(T.pill)
                            .background(if (cost) T.danger else T.slab)
                    )
                }
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String, colour: androidx.compose.ui.graphics.Color) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, Type.body, T.inkMuted, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Txt(value, Type.label.copy(fontSize = 13.sp), colour)
    }
}

/** Said plainly, once: there is not much here yet. */
@Composable
private fun ThinNote(days: Int) {
    Surface(color = T.accentTint, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = T.gutter, vertical = 14.dp)) {
            Txt("Not much to go on yet", Type.label, T.accentInk)
            Spacer(Modifier.height(4.dp))
            Txt(
                "Only ${if (days == 1) "one day" else "$days days"} in this period has anything " +
                    "recorded, so treat the rankings below as a first look rather than a trend.",
                Type.caption,
                T.inkBody,
                maxLines = 3,
            )
        }
    }
}

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())
