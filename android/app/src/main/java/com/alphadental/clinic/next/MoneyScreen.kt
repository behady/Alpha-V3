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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Money
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
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * The clinic's money, a month at a time.
 *
 * The headline is what was **collected**, not what was billed. Billed is a hope;
 * collected is the number that pays the rent, and putting turnover in the loudest
 * place on the screen is how a clinic feels rich while its bank balance falls.
 *
 * Expenses sit beside it rather than on another screen for the same reason: a
 * takings figure with no costs next to it is the number that makes a bad month
 * look like a good one.
 */
@Composable
fun MoneyScreen(
    state: MoneyState,
    onBack: () -> Unit,
    onShiftMonth: (Int) -> Unit,
    onThisMonth: () -> Unit,
    onAdd: (() -> Unit)? = null,
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Money",
            eyebrow = monthLabel(state),
            bar = {
                SlabIcon(Icons.Filled.ChevronLeft, "Previous month") { onShiftMonth(-1) }
                Spacer(Modifier.width(8.dp))
                SlabIcon(Icons.Filled.ChevronRight, "Next month") { onShiftMonth(1) }
                Spacer(Modifier.weight(1f))
                onAdd?.let {
                    SlabIcon(Icons.Filled.Add, "Record money", onClick = it)
                    Spacer(Modifier.width(8.dp))
                }
                if (!state.isThisMonth) {
                    Surface(
                        shape = T.pill,
                        color = T.slabFill,
                        modifier = Modifier.clickable(onClick = onThisMonth),
                    ) {
                        Txt(
                            "This month",
                            Type.caption.copy(fontSize = 12.sp),
                            T.onSlab,
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            },
            figure = if (state.loading || state.error != null) null else {
                {
                    val delta = state.deltaPercent
                    SlabFigure(
                        amount = money(state.collected),
                        currency = "EGP in",
                        note = delta?.let { "vs. last month" },
                        noteValue = delta?.let { d -> if (d >= 0) "+$d%" else "$d%" },
                    )
                }
            },
            stats = if (state.loading || state.error != null) emptyList() else listOf(
                Stat("Charged", money(state.charged)),
                Stat("Expenses", money(state.expenses)),
                Stat("Kept", money(state.net)),
            ),
        )

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
                Txt("No money moved in this month.", Type.body, T.inkFaint, maxLines = 2)
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                item { DailyChart(state) }

                if (state.earners.isNotEmpty()) {
                    item { SectionLabel("What was charged for") }
                    item {
                        RowGroup {
                            state.earners.forEachIndexed { i, e ->
                                if (i > 0) Rule()
                                EarnerRow(e, state.charged)
                            }
                        }
                    }
                }

                if (state.recent.isNotEmpty()) {
                    item { SectionLabel("Movements") }
                    item {
                        RowGroup {
                            state.recent.forEachIndexed { i, m ->
                                if (i > 0) Rule()
                                MovementRow(m)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Takings by day.
 *
 * One bar per day of the month, including the empty ones — a chart drawn only
 * from the days that took money hides the days that did not, which is the whole
 * shape of a month. Today is the accent; the best day is the app's ink.
 */
@Composable
private fun DailyChart(state: MoneyState) {
    val bars = state.bars
    val peak = state.peak
    val today = com.alphadental.clinic.next.data.ClinicSource.dateKey()
    val max = peak?.collected ?: 0.0

    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Rule()
            Column(Modifier.padding(horizontal = T.gutter, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Txt("Daily takings", Type.label, T.ink, Modifier.weight(1f))
                    peak?.let {
                        Txt(
                            "Peak ${money(it.collected)} · ${ordinal(it.day)}",
                            Type.caption,
                            T.inkFaint,
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(
                    Modifier.fillMaxWidth().height(96.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    bars.forEach { bar ->
                        val fraction = if (max <= 0) 0f else (bar.collected / max).toFloat()
                        val colour = when {
                            bar.dateKey == today -> T.accent
                            bar.collected >= max && max > 0 -> T.slab
                            bar.collected > 0 -> T.lineStrong
                            else -> T.line
                        }
                        Box(
                            Modifier
                                .weight(1f)
                                // A day that took nothing still gets a sliver, so
                                // the month reads as a row of days rather than as
                                // a gap where the chart failed to draw.
                                .height((6f + fraction * 88f).dp)
                                .clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                                .background(colour)
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth()) {
                    Txt("1", Type.chip, T.inkFaint, Modifier.weight(1f))
                    Txt(bars.size.toString(), Type.chip, T.inkFaint)
                }
            }
            Rule()
        }
    }
}

/** One thing the clinic charged for, with a bar showing its share. */
@Composable
private fun EarnerRow(earner: Earner, total: Double) {
    val share = if (total <= 0) 0f else (earner.total / total).toFloat()
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Txt(earner.label, Type.rowName, T.ink, Modifier.weight(1f))
            Spacer(Modifier.width(10.dp))
            Txt(money(earner.total), Type.label.copy(fontSize = 13.sp), T.ink)
        }
        Spacer(Modifier.height(7.dp))
        Box(Modifier.fillMaxWidth().height(3.dp).clip(T.pill).background(T.line)) {
            Box(Modifier.fillMaxWidth(share).height(3.dp).clip(T.pill).background(T.slab))
        }
    }
}

/** One movement: money in, or money out. */
@Composable
private fun MovementRow(m: Money) {
    val out = m.isExpense
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(m.description.ifBlank { if (out) "Expense" else "Payment" }, Type.rowName, T.ink)
            val detail = listOfNotNull(
                shortDay(m.date).takeIf { it.isNotBlank() },
                m.method.takeIf { it.isNotBlank() },
                m.doctor.takeIf { it.isNotBlank() },
            )
            if (detail.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Txt(detail.joinToString(" · "), Type.caption, T.inkMuted)
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            Txt(
                (if (out) "−" else "+") + money(m.amount),
                Type.label.copy(fontSize = 13.sp),
                if (out) T.danger else T.ok,
            )
            Txt("EGP", Type.chip, T.inkFaint, uppercase = true)
        }
    }
}

// ---------------------------------------------------------------------------

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())

/** "September 2026". */
private fun monthLabel(state: MoneyState): String =
    SimpleDateFormat("MMMM yyyy", Locale.US).format(state.anchor)

private fun shortDay(key: String): String {
    val d = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull()
        ?: return key
    return SimpleDateFormat("d MMM", Locale.US).format(d)
}

private fun ordinal(day: Int): String {
    val suffix = when {
        day in 11..13 -> "th"
        day % 10 == 1 -> "st"
        day % 10 == 2 -> "nd"
        day % 10 == 3 -> "rd"
        else -> "th"
    }
    return "$day$suffix"
}
