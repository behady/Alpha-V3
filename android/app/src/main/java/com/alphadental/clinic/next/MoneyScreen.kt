package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material3.Icon
import com.alphadental.clinic.next.design.IconTile
import com.alphadental.clinic.next.design.Segmented
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
    onPeriod: (MoneyPeriod) -> Unit = {},
    /** A line tapped: its sheet, with the detail and — for the right account — the edit. */
    onOpenRow: ((Money) -> Unit)? = null,
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Finance",
            eyebrow = when (state.period) {
                MoneyPeriod.Day -> "Today"
                MoneyPeriod.Month -> monthLabel(state)
                MoneyPeriod.Range -> "The last 30 days"
            },
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


            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                item { Spacer(Modifier.height(14.dp)) }
                item { TrueNetCard(state) }
                item { Spacer(Modifier.height(12.dp)) }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatCard(
                            "Cash in", "Payments received", money(state.collected),
                            Color(0xFF059669), Icons.AutoMirrored.Filled.TrendingUp, Color(0xFFECFDF5), Color(0xFF059669),
                        )
                        StatCard(
                            "Discounts granted", "On treatments charged", money(state.discounts),
                            Color(0xFF7C3AED), Icons.Filled.PieChart, Color(0xFFF5F3FF), Color(0xFF7C3AED),
                        )
                        StatCard(
                            "Deductions", "From cash-in", "−" + money(state.commissions + state.labFees),
                            Color(0xFFEA580C), Icons.Filled.Groups, Color(0xFFFFF7ED), Color(0xFFEA580C),
                        )
                        StatCard(
                            "Expenses", "Manual ledger", "−" + money(state.expenses),
                            Color(0xFFDC2626), Icons.AutoMirrored.Filled.TrendingDown, Color(0xFFFEF2F2), Color(0xFFDC2626),
                        )
                    }
                }
                item { Spacer(Modifier.height(14.dp)) }
                item {
                    Segmented(
                        MoneyPeriod.entries.map { it.label },
                        MoneyPeriod.entries.indexOf(state.period),
                    ) { onPeriod(MoneyPeriod.entries[it]) }
                }
                if (state.period == MoneyPeriod.Month) item { DailyChart(state) }

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
                                MovementRow(m, onOpenRow)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The site's hero: near-black, the net large, and the four lines that make it.
 *
 * The figure is what the clinic actually kept after dentists, labs and bills —
 * the number an owner wants and the one no other tile gives.
 */
@Composable
private fun TrueNetCard(state: MoneyState) {
    androidx.compose.material3.Surface(
        shape = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
        color = Color(0xFF0F172A),
        shadowElevation = 8.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
    ) {
        Box {
            // The soft glows the site puts in the corners.
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(220.dp)
                    .offset(x = 70.dp, y = (-70).dp)
                    .background(
                        androidx.compose.ui.graphics.Brush.radialGradient(
                            listOf(Color(0xFFFDE68A).copy(alpha = .16f), Color.Transparent),
                        ),
                        CircleShape,
                    ),
            )
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .size(180.dp)
                    .offset(x = (-50).dp, y = 50.dp)
                    .background(
                        androidx.compose.ui.graphics.Brush.radialGradient(
                            listOf(Color(0xFF10B981).copy(alpha = .12f), Color.Transparent),
                        ),
                        CircleShape,
                    ),
            )
            Column(Modifier.padding(24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.AccountBalanceWallet, null,
                        tint = Color(0xFFFDE68A), modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Txt("True net", Type.chip.copy(fontSize = 11.sp), Color(0xFF94A3B8), uppercase = true)
                }
                Spacer(Modifier.height(10.dp))
                Txt(
                    money(state.trueNet),
                    Type.figure.copy(fontSize = 44.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
                    if (state.trueNet >= 0) Color.White else Color(0xFFF87171),
                )
                Spacer(Modifier.height(8.dp))
                Txt(
                    "After doctor & lab deductions and recorded expenses",
                    Type.body, Color(0xFF64748B), maxLines = 2,
                )
                Spacer(Modifier.height(22.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = .1f)))
                Spacer(Modifier.height(16.dp))
                NetLine("Cash in", "+" + money(state.collected), Color(0xFF34D399))
                NetLine("Discounts", money(state.discounts), Color(0xFFC4B5FD))
                NetLine("Commissions + lab", "−" + money(state.commissions + state.labFees), Color(0xFFFCD34D))
                NetLine("Expenses", "−" + money(state.expenses), Color(0xFFFCA5A5))
            }
        }
    }
}

@Composable
private fun NetLine(label: String, value: String, tint: Color) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, Type.body.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), Color(0xFF94A3B8), Modifier.weight(1f))
        Txt(value, Type.label.copy(fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold), tint)
    }
}

/** One of the site's four metric tiles: label, hint, a tinted icon, the figure. */
@Composable
private fun StatCard(
    label: String,
    hint: String,
    value: String,
    valueInk: Color,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tileFill: Color,
    tileInk: Color,
) {
    androidx.compose.material3.Surface(
        shape = T.card,
        color = T.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, T.line),
        shadowElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Txt(label, Type.chip.copy(fontSize = 11.sp), T.inkFaint, uppercase = true)
                    Spacer(Modifier.height(3.dp))
                    Txt(hint, Type.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), T.inkMuted)
                }
                IconTile(icon, tileFill, tileInk)
            }
            Spacer(Modifier.height(14.dp))
            Txt(
                value,
                Type.stat.copy(fontSize = 30.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold),
                valueInk,
            )
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
private fun MovementRow(m: Money, onOpen: ((Money) -> Unit)?) {
    val out = m.isExpense
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onOpen != null) Modifier.clickable { onOpen(m) } else Modifier)
            .padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(m.description.ifBlank { if (out) "Expense" else "Payment" }, Type.rowName, T.ink)
            // The website's row: the patient, the dentist, how it was paid, who took it.
            val detail = listOfNotNull(
                shortDay(m.date).takeIf { it.isNotBlank() },
                m.patientName.takeIf { it.isNotBlank() },
                m.doctor.takeIf { it.isNotBlank() }?.let { if (it.startsWith("Dr", true)) it else "Dr. $it" },
                m.method.takeIf { it.isNotBlank() },
            )
            if (detail.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Txt(detail.joinToString(" · "), Type.caption, T.inkMuted, maxLines = 2)
            }
            val split = listOfNotNull(
                m.commission.takeIf { it > 0 }?.let { "Doc ${money(it)}" },
                m.labFee.takeIf { it > 0 }?.let { "Lab ${money(it)}" },
                m.by.takeIf { it.isNotBlank() }?.let { "by $it" },
            )
            if (split.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Txt(split.joinToString(" · "), Type.chip, T.accentInk, maxLines = 1)
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
