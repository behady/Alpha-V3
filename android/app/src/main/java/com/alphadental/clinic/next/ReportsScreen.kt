package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.ReportsClient
import com.alphadental.clinic.next.data.ReportsClient.Section
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
 * The reports — all of them, as the website has them.
 *
 * Nothing on this screen is calculated on the phone. The website's own report arithmetic runs on
 * the server and answers with a document (figures, bars, months, a heat grid, tables, notes), and
 * this screen draws those six shapes and nothing else. That is what keeps "last month's income"
 * the same number in the owner's pocket and on his desk.
 *
 * Laid out the way the website lays it out: the group first, the report inside it, the period
 * everybody asks for in front of the two dates for the one they occasionally do. A figure opens
 * to the people it is made of; a table row that names a patient opens the file.
 */
@Composable
fun ReportsScreen(
    state: ReportsState,
    onBack: () -> Unit,
    onGroup: (String) -> Unit,
    onReport: (String) -> Unit,
    onPreset: (Preset) -> Unit,
    onRange: (from: String?, to: String?) -> Unit,
    onDrill: (String) -> Unit,
    onCloseDrill: () -> Unit,
    onOpenPatient: (String) -> Unit,
) {
    val isAr = state.isAr
    val context = LocalContext.current
    val doc = state.doc
    val entry = state.entry

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = entry?.label ?: if (isAr) "التقارير" else "Reports",
            eyebrow = state.group?.label ?: (if (isAr) "التقارير" else "Reports"),
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (doc != null && doc.sections.any { it is Section.Table }) {
                    SlabIcon(Icons.Filled.Share, if (isAr) "تصدير" else "Export", onClick = { shareCsv(context, doc) })
                }
            },
            figure = doc?.figures?.firstOrNull()?.let { f ->
                {
                    val (amount, unit) = splitUnit(f.value)
                    SlabFigure(amount = amount, currency = unit.ifBlank { f.label }, note = if (unit.isBlank()) null else f.label, noteValue = f.deltaText, compact = true)
                }
            },
            stats = doc?.figures?.drop(1)?.take(3)?.map { Stat(it.label, it.value) } ?: emptyList(),
        )

        Rails(state, onGroup, onReport)
        Period(state, onPreset, onRange)

        when {
            state.error != null && !state.loading -> Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    if (state.locked) Icon(Icons.Filled.Lock, null, tint = T.inkFaint, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.height(8.dp))
                    Txt(state.error, Type.body, T.inkFaint, maxLines = 4, align = TextAlign.Center)
                }
            }
            doc == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
            else -> Box(Modifier.fillMaxSize()) {
                Body(doc, isAr, onDrill, onOpenPatient)
                if (state.loading) Box(Modifier.fillMaxSize().background(T.ground.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                }
            }
        }
    }

    if (state.drill != null || state.drillLoading) {
        DrillSheet(state.drill, state.drillLoading, isAr, onOpenPatient, onCloseDrill)
    }
}

// ---------------------------------------------------------------------------------- navigation

@Composable
private fun Rails(state: ReportsState, onGroup: (String) -> Unit, onReport: (String) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = T.gutter, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                state.groups.forEach { g ->
                    val on = g.id == state.groupId
                    Surface(
                        shape = T.pill,
                        color = if (on) T.slab else T.surface,
                        border = if (on) null else BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onGroup(g.id) },
                    ) {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Txt(g.label, Type.label.copy(fontSize = 12.sp), if (on) T.onSlab else T.inkMuted)
                            Spacer(Modifier.width(6.dp))
                            Txt(g.reports.size.toString(), Type.caption.copy(fontSize = 11.sp), if (on) T.onSlabFaint else T.inkFaint)
                        }
                    }
                }
            }
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(start = T.gutter, end = T.gutter, bottom = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                state.group?.reports?.forEach { r ->
                    val on = r.id == state.reportId
                    Surface(
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                        color = if (on) T.surfaceSoft else Color.Transparent,
                        border = if (on) BorderStroke(1.dp, T.line) else null,
                        modifier = Modifier.clickable { onReport(r.id) },
                    ) {
                        Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (r.locked) {
                                Icon(Icons.Filled.Lock, null, tint = T.inkFaint, modifier = Modifier.size(12.dp))
                                Spacer(Modifier.width(5.dp))
                            }
                            Txt(r.label, Type.label.copy(fontSize = 12.5.sp), if (on) T.ink else T.inkMuted)
                        }
                    }
                }
            }
            Rule()
        }
    }
}

@Composable
private fun Period(state: ReportsState, onPreset: (Preset) -> Unit, onRange: (String?, String?) -> Unit) {
    val isAr = state.isAr
    var picking by remember { mutableStateOf<String?>(null) }
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = T.gutter, vertical = 9.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Preset.entries.forEach { p ->
                    val on = p == state.preset && !(state.entry?.allTime ?: false)
                    Surface(
                        shape = T.pill,
                        color = if (on) T.accent else T.surface,
                        border = if (on) null else BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onPreset(p) },
                    ) {
                        Txt(if (isAr) p.ar else p.en, Type.chip.copy(fontSize = 10.5.sp), if (on) T.onAccent else T.inkMuted, Modifier.padding(horizontal = 12.dp, vertical = 7.dp), uppercase = true)
                    }
                }
            }
            Row(Modifier.padding(start = T.gutter, end = T.gutter, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (state.entry?.allTime == true) {
                    Txt(if (isAr) "على كل الفترة — التاريخ مش بيفرق هنا." else "Over the whole history — the dates do not apply here.", Type.caption, T.inkFaint, maxLines = 2)
                } else {
                    DateBox(state.from) { picking = "from" }
                    Txt(if (isAr) "إلى" else "to", Type.caption, T.inkFaint, Modifier.padding(horizontal = 10.dp))
                    DateBox(state.to) { picking = "to" }
                    Spacer(Modifier.weight(1f))
                    Txt(state.doc?.rangeLabel ?: "", Type.caption, T.inkMuted, maxLines = 1)
                }
            }
            Rule()
        }
    }
    picking?.let { which ->
        ReportDatePicker(
            current = if (which == "from") state.from else state.to,
            isAr = isAr,
            onPick = { if (which == "from") onRange(it, null) else onRange(null, it); picking = null },
            onDismiss = { picking = null },
        )
    }
}

@Composable
private fun DateBox(value: String, onClick: () -> Unit) {
    Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp), color = T.surfaceSoft, border = BorderStroke(1.dp, T.line), modifier = Modifier.clickable(onClick = onClick)) {
        Txt(value, Type.label.copy(fontSize = 12.5.sp), T.ink, Modifier.padding(horizontal = 10.dp, vertical = 7.dp))
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun ReportDatePicker(current: String, isAr: Boolean, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
    val initial = runCatching { fmt.parse(current)!!.time }.getOrNull()
    val pickerState = androidx.compose.material3.rememberDatePickerState(initialSelectedDateMillis = initial)
    androidx.compose.material3.DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = {
                pickerState.selectedDateMillis?.let { onPick(fmt.format(java.util.Date(it))) } ?: onDismiss()
            }) { Txt(if (isAr) "استخدم التاريخ ده" else "Use this date", Type.label, T.ink) }
        },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Txt(if (isAr) "إلغاء" else "Cancel", Type.label, T.inkMuted) } },
    ) { androidx.compose.material3.DatePicker(state = pickerState) }
}

// ---------------------------------------------------------------------------------- the body

@Composable
private fun Body(doc: ReportsClient.Doc, isAr: Boolean, onDrill: (String) -> Unit, onOpenPatient: (String) -> Unit) {
    val rest = doc.figures.drop(4)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
        if (doc.hint.isNotBlank()) {
            item { Txt(doc.hint, Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 3) }
        }
        if (rest.isNotEmpty()) {
            item { FigureGrid(rest) }
        }
        doc.sections.forEach { section ->
            when (section) {
                is Section.Bars -> {
                    item { SectionLabel(section.title) }
                    item { Bars(section, onDrill) }
                    section.note?.let { n -> item { Note(n) } }
                }
                is Section.Months -> {
                    item { SectionLabel(section.title) }
                    item { Months(section, isAr) }
                    section.note?.let { n -> item { Note(n) } }
                }
                is Section.Heat -> {
                    item { SectionLabel(section.title) }
                    item { Heat(section, isAr) }
                    section.note?.let { n -> item { Note(n) } }
                }
                is Section.Table -> {
                    item { SectionLabel(section.title) }
                    item { Table(section, isAr, onDrill, onOpenPatient) }
                    section.note?.let { n -> item { Note(n) } }
                }
                is Section.Statement -> {
                    item { SectionLabel(section.title) }
                    item { Statement(section) }
                }
                is Section.Note -> item { Note(section.text) }
            }
        }
        if (doc.figures.isEmpty() && doc.sections.isEmpty()) {
            item { Box(Modifier.fillMaxWidth().padding(T.gutter), contentAlignment = Alignment.Center) { Txt(if (isAr) "مفيش بيانات في الفترة دي." else "Nothing recorded in this period.", Type.body, T.inkFaint) } }
        }
    }
}

/** The figures past the slab's four, two to a row. */
@Composable
private fun FigureGrid(figures: List<ReportsClient.Figure>) {
    Column(Modifier.padding(horizontal = T.gutter, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        figures.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { f ->
                    Surface(shape = T.cardShape, color = T.surface, border = BorderStroke(1.dp, T.line), modifier = Modifier.weight(1f)) {
                        Column(Modifier.padding(12.dp)) {
                            Txt(f.label, Type.caption.copy(fontSize = 11.sp), T.inkMuted, maxLines = 2)
                            Spacer(Modifier.height(4.dp))
                            Txt(f.value, Type.stat.copy(fontSize = 18.sp), if (f.tone == "bad") T.danger else if (f.tone == "muted") T.inkMuted else T.ink)
                            if (f.deltaText != null) {
                                Spacer(Modifier.height(2.dp))
                                Txt(f.deltaText, Type.caption.copy(fontSize = 11.sp), if (f.deltaBad) T.danger else T.inkMuted)
                            }
                        }
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Txt(text, Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 6)
}

/** A ranked list with a bar for each share, against the biggest. The marked row is the accent. */
@Composable
private fun Bars(section: Section.Bars, onDrill: (String) -> Unit) {
    val top = section.rows.maxOfOrNull { it.value }?.takeIf { it > 0 } ?: 1.0
    RowGroup {
        if (section.rows.isEmpty()) Txt("—", Type.body, T.inkFaint, Modifier.padding(T.gutter))
        section.rows.forEachIndexed { i, bar ->
            if (i > 0) Rule()
            val share = (bar.value / top).toFloat().coerceIn(0f, 1f)
            Column(
                Modifier.fillMaxWidth()
                    .then(if (bar.drill != null) Modifier.clickable { onDrill(bar.drill) } else Modifier)
                    .padding(horizontal = T.gutter, vertical = 12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Txt(bar.label, Type.rowName, if (bar.warn) T.danger else T.ink, Modifier.weight(1f), maxLines = 2)
                    Spacer(Modifier.width(10.dp))
                    Txt(bar.text, Type.label.copy(fontSize = 13.sp), T.inkBody)
                }
                Spacer(Modifier.height(7.dp))
                Box(Modifier.fillMaxWidth().height(3.dp).clip(T.pill).background(T.line)) {
                    Box(Modifier.fillMaxWidth(share).height(3.dp).clip(T.pill).background(if (bar.warn) T.danger else if (bar.mark) T.accent else T.slab))
                }
            }
        }
    }
}

/** Twelve months (or thirty days) as bars, the best one in the accent. */
@Composable
private fun Months(section: Section.Months, isAr: Boolean) {
    val max = section.points.maxOfOrNull { it.value } ?: 0.0
    val min = section.points.minOfOrNull { it.value } ?: 0.0
    val ink = T.slab
    val accent = T.accent
    val line = T.line
    val danger = T.danger
    RowGroup {
        if (max <= 0.0 && min >= 0.0) {
            Txt("—", Type.body, T.inkFaint, Modifier.padding(T.gutter))
        } else {
            val n = section.points.size
            Canvas(Modifier.fillMaxWidth().height(150.dp).padding(horizontal = T.gutter, vertical = 14.dp)) {
                val gap = if (n > 14) 2.dp.toPx() else 6.dp.toPx()
                val w = (size.width - gap * (n - 1)) / n
                val span = (maxOf(max, 0.0) - minOf(min, 0.0)).takeIf { it > 0 } ?: 1.0
                val zeroY = (maxOf(max, 0.0) / span * size.height).toFloat()
                drawLine(line, Offset(0f, zeroY), Offset(size.width, zeroY), 1.dp.toPx())
                section.points.forEachIndexed { i, p ->
                    val x = i * (w + gap)
                    val h = (kotlin.math.abs(p.value) / span * size.height).toFloat()
                    val top = if (p.value >= 0) zeroY - h else zeroY
                    val colour = if (p.value < 0) danger else if (p.value == max && max > 0) accent else ink
                    drawRoundRect(colour, Offset(x, top), Size(w, h.coerceAtLeast(if (p.value == 0.0) 0f else 2.dp.toPx())), CornerRadius(3.dp.toPx()))
                }
            }
            Row(Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, bottom = 10.dp)) {
                val step = if (n > 14) (n / 6).coerceAtLeast(1) else 1
                section.points.forEachIndexed { i, p ->
                    Txt(if (i % step == 0 || i == n - 1) p.label else "", Type.caption.copy(fontSize = 9.5.sp), T.inkFaint, Modifier.weight(1f), align = TextAlign.Center)
                }
            }
            val best = section.points.filter { it.value == max }.firstOrNull()
            if (best != null && max > 0) {
                Txt(
                    (if (isAr) "الأعلى: " else "Peak: ") + best.label + " · " + unitText(max, section.unit, isAr),
                    Type.caption, T.inkMuted, Modifier.padding(start = T.gutter, end = T.gutter, bottom = 12.dp),
                )
            }
        }
    }
}

/** A weekday × hour grid, Saturday first, shaded in one ink; the busiest cell in the accent. */
@Composable
private fun Heat(section: Section.Heat, isAr: Boolean) {
    val days = if (isAr) listOf("السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة") else listOf("Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri")
    val hours = (8..22).toList()
    val grid = remember(section) {
        val m = HashMap<Pair<Int, Int>, Double>()
        section.cells.forEach { c -> if (c.hour in hours) m[c.weekday to c.hour] = (m[c.weekday to c.hour] ?: 0.0) + c.value }
        m
    }
    val max = grid.values.maxOrNull() ?: 0.0
    val ink = T.slab
    val accent = T.accent
    val empty = T.line
    RowGroup {
        if (max <= 0.0) {
            Txt("—", Type.body, T.inkFaint, Modifier.padding(T.gutter))
        } else {
            Column(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                days.forEachIndexed { d, day ->
                    val rowTotal = hours.sumOf { grid[d to it] ?: 0.0 }
                    Row(Modifier.fillMaxWidth().height(22.dp), verticalAlignment = Alignment.CenterVertically) {
                        Txt(day, Type.caption.copy(fontSize = 11.sp), T.ink, Modifier.width(44.dp))
                        Canvas(Modifier.weight(1f).height(18.dp)) {
                            val gap = 2.dp.toPx()
                            val w = (size.width - gap * (hours.size - 1)) / hours.size
                            hours.forEachIndexed { i, h ->
                                val v = grid[d to h] ?: 0.0
                                val t = (v / max).toFloat()
                                val colour = when { v <= 0.0 -> empty; v == max -> accent; else -> ink.copy(alpha = 0.16f + 0.84f * t) }
                                drawRoundRect(colour, Offset(i * (w + gap), 0f), Size(w, size.height), CornerRadius(3.dp.toPx()))
                            }
                        }
                        Txt(unitText(rowTotal, section.unit, isAr, short = true), Type.caption.copy(fontSize = 11.sp), T.inkMuted, Modifier.width(52.dp), align = TextAlign.End)
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                    Spacer(Modifier.width(44.dp))
                    Row(Modifier.weight(1f)) {
                        hours.forEach { h ->
                            Txt(if (h % 2 == 0) (if (h > 12) "${h - 12}p" else if (h == 12) "12p" else "${h}a") else "", Type.caption.copy(fontSize = 9.sp), T.inkFaint, Modifier.weight(1f), align = TextAlign.Center)
                        }
                    }
                    Spacer(Modifier.width(52.dp))
                }
            }
        }
    }
}

/**
 * A table, on a phone.
 *
 * A row is its first column as the name, the last figure column on the right, and everything in
 * between as one caption line — because eight columns across a phone is a scroll nobody reads.
 * A row that opens to people, or to a patient's file, says so with a chevron.
 */
@Composable
private fun Table(section: Section.Table, isAr: Boolean, onDrill: (String) -> Unit, onOpenPatient: (String) -> Unit) {
    val nameCol = section.columns.firstOrNull() ?: return
    val figureCol = section.columns.lastOrNull { it.end && it.key != nameCol.key }
    val middle = section.columns.filter { it.key != nameCol.key && it.key != figureCol?.key }
    RowGroup {
        if (section.rows.isEmpty()) Txt(if (isAr) "مفيش بيانات في الفترة دي." else "Nothing in this period.", Type.body, T.inkFaint, Modifier.padding(T.gutter))
        section.rows.forEachIndexed { i, row ->
            if (i > 0) Rule()
            val tappable = row.drill != null || row.patientId != null
            Row(
                Modifier.fillMaxWidth()
                    .then(if (tappable) Modifier.clickable { row.drill?.let(onDrill) ?: row.patientId?.let(onOpenPatient) } else Modifier)
                    .padding(horizontal = T.gutter, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Txt(cellText(row.cells[nameCol.key], nameCol.kind, isAr), Type.rowName, if (row.bad && figureCol == null) T.danger else T.ink, maxLines = 2)
                    if (middle.isNotEmpty()) {
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            middle.mapNotNull { c -> val v = row.cells[c.key]; if (v == null || v.toString().isBlank()) null else "${c.label} ${cellText(v, c.kind, isAr)}" }.joinToString("  ·  "),
                            Type.caption, T.inkMuted, maxLines = 3,
                        )
                    }
                }
                if (figureCol != null) {
                    Spacer(Modifier.width(10.dp))
                    Column(horizontalAlignment = Alignment.End) {
                        Txt(cellText(row.cells[figureCol.key], figureCol.kind, isAr), Type.label.copy(fontSize = 13.5.sp), if (row.bad) T.danger else T.ink)
                        Txt(figureCol.label, Type.caption.copy(fontSize = 10.sp), T.inkFaint)
                    }
                }
                if (tappable) {
                    Spacer(Modifier.width(6.dp))
                    Txt(if (isAr) "‹" else "›", Type.label.copy(fontSize = 16.sp), T.inkFaint)
                }
            }
        }
        section.total?.let { total ->
            Rule()
            Row(Modifier.fillMaxWidth().background(T.surfaceSoft).padding(horizontal = T.gutter, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt(cellText(total.cells[nameCol.key], "text", isAr).ifBlank { if (isAr) "الإجمالي" else "Total" }, Type.eyebrow, T.inkMuted, Modifier.weight(1f), uppercase = true)
                if (figureCol != null) Txt(cellText(total.cells[figureCol.key], figureCol.kind, isAr), Type.label.copy(fontSize = 13.5.sp), T.ink)
            }
        }
    }
}

@Composable
private fun Statement(section: Section.Statement) {
    RowGroup {
        section.lines.forEachIndexed { i, l ->
            if (i > 0) Rule()
            val result = l.kind == "result"
            Row(
                Modifier.fillMaxWidth().background(if (result) T.surfaceSoft else Color.Transparent).padding(start = if (l.kind == "sub") T.gutter + 16.dp else T.gutter, end = T.gutter, top = 11.dp, bottom = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Txt(l.label, if (result) Type.label else Type.body, if (result) T.ink else if (l.kind == "sub") T.inkMuted else T.inkBody, Modifier.weight(1f), maxLines = 2)
                val negative = l.value < 0
                Txt(
                    if (negative && !result) "(${money(-l.value)})" else money(l.value),
                    Type.label.copy(fontSize = 13.5.sp),
                    if (result && negative) T.danger else if (negative) T.inkMuted else T.ink,
                )
            }
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun DrillSheet(section: Section?, loading: Boolean, isAr: Boolean, onOpenPatient: (String) -> Unit, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = T.ground, dragHandle = null) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Txt(section?.title ?: (if (isAr) "المرضى" else "Patients"), Type.heading, T.ink, Modifier.padding(start = T.gutter, end = T.gutter, top = 20.dp, bottom = 6.dp), maxLines = 2)
            when {
                loading -> Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp)) }
                section is Section.Table -> {
                    Txt(if (isAr) "اضغط اسم لفتح الملف." else "Tap a name to open the file.", Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 4.dp))
                    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
                        item { Table(section, isAr, onDrill = {}, onOpenPatient = onOpenPatient) }
                    }
                }
                section is Section.Note -> Txt(section.text, Type.body, T.inkMuted, Modifier.padding(T.gutter), maxLines = 3)
                else -> Unit
            }
        }
    }
}

// ---------------------------------------------------------------------------------- formatting

private val numbers: NumberFormat = NumberFormat.getIntegerInstance(Locale.US)

private fun money(value: Double): String = numbers.format(Math.round(value))

private fun unitText(value: Double, unit: String, isAr: Boolean, short: Boolean = false): String = when (unit) {
    "money" -> money(value) + if (short) "" else (if (isAr) " ج.م" else " EGP")
    "pct" -> String.format(Locale.US, "%.1f%%", value)
    else -> money(value)
}

/** "48,250 EGP" → "48,250" and "EGP", so the slab can set the currency a size down. */
private fun splitUnit(value: String): Pair<String, String> {
    val parts = value.trim().split(" ")
    return if (parts.size >= 2 && parts.last().length <= 4 && parts.first().any { it.isDigit() }) parts.dropLast(1).joinToString(" ") to parts.last() else value to ""
}

private fun cellText(v: Any?, kind: String, isAr: Boolean): String {
    if (v == null) return "—"
    return when (kind) {
        "money" -> (v as? Number)?.let { money(it.toDouble()) } ?: v.toString()
        "int" -> (v as? Number)?.let { numbers.format(it.toLong()) } ?: v.toString()
        "pct" -> (v as? Number)?.let { n -> if (n.toDouble() == n.toDouble().toLong().toDouble()) "${n.toLong()}%" else String.format(Locale.US, "%.1f%%", n.toDouble()) } ?: v.toString()
        "delta" -> (v as? Number)?.let { n -> (if (n.toDouble() > 0) "▲ " else if (n.toDouble() < 0) "▼ " else "• ") + String.format(Locale.US, "%.0f%%", kotlin.math.abs(n.toDouble())) } ?: (if (isAr) "جديد" else "new")
        "date" -> dayText(v.toString(), isAr)
        else -> v.toString()
    }
}

/** "2026-09-05" → "5 Sep", as the website prints it. */
private fun dayText(ymd: String, isAr: Boolean): String {
    val parts = ymd.split("-")
    if (parts.size < 3) return ymd
    val months = if (isAr) listOf("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر")
    else listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    val m = parts[1].toIntOrNull() ?: return ymd
    val d = parts[2].take(2).toIntOrNull() ?: return ymd
    val thisYear = java.util.Calendar.getInstance().get(java.util.Calendar.YEAR).toString()
    return "$d ${months.getOrNull(m - 1) ?: parts[1]}" + if (parts[0] == thisYear) "" else " ${parts[0]}"
}

/**
 * Every table in the report as one CSV, handed to the share sheet — it opens in Excel, WhatsApp,
 * mail, whatever the owner uses. The figures go on top so the file reads like the screen did.
 */
private fun shareCsv(context: android.content.Context, doc: ReportsClient.Doc) {
    val q = { s: String -> "\"" + s.replace("\"", "\"\"") + "\"" }
    val sb = StringBuilder()
    sb.append(q(doc.title)).append(',').append(q(doc.rangeLabel)).append('\n')
    doc.figures.forEach { f -> sb.append(q(f.label)).append(',').append(q(f.value)).append('\n') }
    doc.sections.filterIsInstance<Section.Table>().forEach { t ->
        sb.append('\n').append(q(t.title)).append('\n')
        sb.append(t.columns.joinToString(",") { q(it.label) }).append('\n')
        (t.rows + listOfNotNull(t.total)).forEach { r ->
            sb.append(t.columns.joinToString(",") { c -> val v = r.cells[c.key]; if (v is Number) v.toString() else q(v?.toString() ?: "") }).append('\n')
        }
    }
    val dir = java.io.File(context.cacheDir, "reports").apply { mkdirs() }
    val file = java.io.File(dir, doc.id + "_" + doc.rangeLabel.replace(Regex("[^A-Za-z0-9\\u0600-\\u06FF]+"), "_") + ".csv")
    // A byte-order mark, so Excel opens Arabic as Arabic rather than as boxes.
    file.writeBytes(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + sb.toString().toByteArray(Charsets.UTF_8))
    com.alphadental.clinic.ui.DocumentActions.share(context, file, doc.title)
}
