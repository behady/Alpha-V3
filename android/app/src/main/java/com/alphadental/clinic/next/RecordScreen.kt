package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Money
import com.alphadental.clinic.next.data.Record
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
 * One patient's file.
 *
 * It opens on what they owe. That number used to live three taps inside a
 * Finance tab, which is the wrong place for the one figure that decides whether
 * reception says anything as the patient walks out.
 *
 * A settled account states nothing at all: a 38sp zero on every second record
 * teaches people to stop reading the figure, and most records are settled.
 */
@Composable
fun RecordScreen(
    state: RecordState,
    onBack: () -> Unit,
    onTab: (RecordTab) -> Unit,
    onSelectTooth: (Int?) -> Unit = {},
    onCall: (String) -> Unit = {},
    onMessage: (String) -> Unit = {},
    onTakePayment: (() -> Unit)? = null,
) {
    val record = state.record

    Column(Modifier.fillMaxSize().background(T.ground)) {

        RecordSlab(state, record, onBack, onCall, onMessage, onTakePayment)

        if (record != null) Tabs(state.tab, onTab)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            record == null -> Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
                Txt(state.error ?: "That patient could not be opened.", Type.body, T.inkFaint, maxLines = 3)
            }

            else -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                when (state.tab) {
                    RecordTab.Overview -> overview(state, record)
                    RecordTab.Chart -> chart(state, record, onSelectTooth)
                    RecordTab.Visits -> visits(record)
                    RecordTab.Ledger -> ledger(state)
                }
            }
        }
    }
}

@Composable
private fun RecordSlab(
    state: RecordState,
    record: Record?,
    onBack: () -> Unit,
    onCall: (String) -> Unit,
    onMessage: (String) -> Unit,
    onTakePayment: (() -> Unit)?,
) {
    val owed = record?.balance?.owed ?: 0.0
    val credit = record?.balance?.credit ?: 0.0

    Slab(
        title = record?.person?.name?.ifBlank { "No name" } ?: "Patient",
        eyebrow = record?.fileId?.takeIf { it.isNotBlank() },
        bar = {
            SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
            Spacer(Modifier.weight(1f))
            val phone = record?.person?.phone.orEmpty()
            if (phone.isNotBlank()) {
                SlabIcon(Icons.Filled.Phone, "Call") { onCall(phone) }
                Spacer(Modifier.width(8.dp))
                SlabIcon(Icons.AutoMirrored.Filled.Chat, "WhatsApp") { onMessage(phone) }
            }
        },
        // Nothing at all when the account is settled, which most are.
        figure = if (record == null || (owed <= 0 && credit <= 0)) null else {
            {
                // The word goes in the currency slot rather than the note
                // column: with a button on this row there is no note column, and
                // "EGP" beside "outstanding" ran together into one word.
                SlabFigure(
                    amount = money(if (owed > 0) owed else credit),
                    currency = if (owed > 0) "EGP owed" else "EGP credit",
                    compact = onTakePayment != null && owed > 0,
                )
                if (owed > 0 && onTakePayment != null) {
                    Spacer(Modifier.weight(1f))
                    Surface(
                        shape = T.pill,
                        color = T.accent,
                        modifier = Modifier.padding(bottom = 6.dp).clickable(onClick = onTakePayment),
                    ) {
                        Txt(
                            "Take payment",
                            Type.label.copy(fontSize = 12.5.sp),
                            T.onAccent,
                            Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                        )
                    }
                }
            }
        },
        stats = if (record == null) emptyList() else buildList {
            add(Stat("Visits", record.past.size.toString()))
            add(Stat("Upcoming", record.upcoming.size.toString()))
            record.lastSeen?.let { add(Stat("Last seen", shortDate(it))) }
            add(Stat("Lifetime", money(record.lifetime)))
        },
    )

    // The identity line sits under the slab rather than in it: age and gender are
    // context for the notes below, not a headline.
    if (record != null) {
        val bits = listOfNotNull(
            record.age?.let { "$it years" },
            record.gender.takeIf { it.isNotBlank() },
            record.person.phone.takeIf { it.isNotBlank() },
        )
        if (bits.isNotEmpty()) {
            Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
                Txt(
                    bits.joinToString(" · "),
                    Type.caption,
                    T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 11.dp),
                )
            }
        }
    }
}

/** The file's sections. A scrolling rail, so a sixth tab costs no height. */
@Composable
private fun Tabs(current: RecordTab, onTab: (RecordTab) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Rule()
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter),
            ) {
                RecordTab.entries.forEach { tab ->
                    val selected = tab == current
                    Column(
                        Modifier
                            .clickable { onTab(tab) }
                            .padding(end = 22.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Txt(
                            tab.label,
                            Type.label.copy(fontSize = 13.sp),
                            if (selected) T.ink else T.inkFaint,
                            Modifier.padding(top = 14.dp, bottom = 11.dp),
                        )
                        // The underline is the app's ink, not the accent: this is
                        // "where you are", not "the thing to do".
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(2.dp)
                                .background(if (selected) T.slab else androidx.compose.ui.graphics.Color.Transparent)
                        )
                    }
                }
            }
            Rule()
        }
    }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

private fun androidx.compose.foundation.lazy.LazyListScope.overview(
    state: RecordState,
    record: Record,
) {
    if (state.alerts.isNotEmpty()) {
        item { SectionLabel("Before you treat") }
        item {
            RowGroup {
                state.alerts.forEachIndexed { i, alert ->
                    if (i > 0) Rule()
                    AlertRow(alert)
                }
            }
        }
    }

    if (record.upcoming.isNotEmpty()) {
        item { SectionLabel("Coming up") }
        item { VisitRows(record.upcoming, showPatient = false) {} }
    }

    item { SectionLabel("Account") }
    item {
        RowGroup {
            Fact("Treatment billed", money(record.balance.charged) + " EGP")
            Rule()
            Fact("Paid to date", money(record.balance.paid) + " EGP")
            Rule()
            if (record.balance.owed > 0) {
                Fact("Outstanding", money(record.balance.owed) + " EGP", T.danger)
            } else if (record.balance.credit > 0) {
                Fact("In credit", money(record.balance.credit) + " EGP", T.ok)
            } else {
                Fact("Settled", "Nothing owed", T.ok)
            }
        }
    }
}

@Composable
private fun AlertRow(alert: Alert) {
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(if (alert.severe) T.danger else T.warn)
        )
        Column(Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp)) {
            Txt(alert.title, Type.rowName, if (alert.severe) T.danger else T.ink)
            Spacer(Modifier.height(2.dp))
            Txt(alert.detail, Type.caption, T.inkMuted, maxLines = 3)
        }
    }
}

@Composable
private fun Fact(label: String, value: String, valueColour: androidx.compose.ui.graphics.Color = T.ink) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, Type.body, T.inkMuted, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Txt(value, Type.label.copy(fontSize = 13.sp), valueColour)
    }
}

// ---------------------------------------------------------------------------
// Visits and ledger
// ---------------------------------------------------------------------------

/**
 * The mouth, and whatever is recorded on the tooth being looked at.
 *
 * The detail sits under the chart rather than over it: a dentist reading a chart
 * is comparing teeth, and a dialog covering the mouth to describe one of them
 * makes that impossible.
 */
private fun androidx.compose.foundation.lazy.LazyListScope.chart(
    state: RecordState,
    record: Record,
    onSelectTooth: (Int?) -> Unit,
) {
    item {
        ToothChart(
            teeth = record.teeth,
            selected = state.tooth,
            onSelect = onSelectTooth,
        )
    }
    item { ToothDetail(record.teeth[state.tooth], state.tooth) }
}

private fun androidx.compose.foundation.lazy.LazyListScope.visits(record: Record) {
    if (record.upcoming.isNotEmpty()) {
        item { SectionLabel("Coming up") }
        item { VisitRows(record.upcoming, showPatient = false) {} }
    }
    if (record.past.isNotEmpty()) {
        item { SectionLabel("Been in · ${record.past.size}") }
        item { VisitRows(record.past, showPatient = false) {} }
    }
    if (record.upcoming.isEmpty() && record.past.isEmpty()) {
        item { EmptyNote("No visits on this file yet.") }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.ledger(state: RecordState) {
    val charges = state.charges
    val payments = state.payments

    if (charges.isNotEmpty()) {
        item { SectionLabel("Charged") }
        item { RowGroup { charges.forEachIndexed { i, m -> if (i > 0) Rule(); MoneyRow(m, T.ink) } } }
    }
    if (payments.isNotEmpty()) {
        item { SectionLabel("Paid") }
        item { RowGroup { payments.forEachIndexed { i, m -> if (i > 0) Rule(); MoneyRow(m, T.ok) } } }
    }
    if (charges.isEmpty() && payments.isEmpty()) {
        item { EmptyNote("Nothing has been charged to this patient.") }
    }
}

@Composable
private fun MoneyRow(m: Money, amountColour: androidx.compose.ui.graphics.Color) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(m.description.ifBlank { if (m.isCharge) "Treatment" else "Payment" }, Type.rowName, T.ink)
            val detail = listOfNotNull(
                shortDate(m.date).takeIf { it.isNotBlank() },
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
                (if (m.isCharge) "" else "+") + money(m.amount),
                Type.label.copy(fontSize = 13.sp),
                amountColour,
            )
            Txt("EGP", Type.chip, T.inkFaint, uppercase = true)
        }
    }
}

@Composable
private fun EmptyNote(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 44.dp), contentAlignment = Alignment.Center) {
        Txt(text, Type.body, T.inkFaint, maxLines = 2)
    }
}

// ---------------------------------------------------------------------------

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())

/** "21 Aug" — enough to place a visit without spending a line on the year. */
private fun shortDate(key: String): String {
    val d = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull()
        ?: return key
    return SimpleDateFormat("d MMM", Locale.US).format(d)
}
