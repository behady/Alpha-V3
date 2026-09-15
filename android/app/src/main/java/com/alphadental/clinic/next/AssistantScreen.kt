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
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.ai.IntelligenceClient
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * What the assistant can see that a screen cannot.
 *
 * Three answers, each one a question somebody actually asks: what does today
 * look like, who has stopped coming, and what money is sitting on the floor.
 *
 * Every scan is a tap. None of them run on their own, because each one costs the
 * clinic credits and a screen that spends money by being opened is a screen
 * people learn not to open.
 */
@Composable
fun AssistantScreen(
    state: Assistant,
    onBack: () -> Unit,
    onTab: (ScanTab) -> Unit,
    onRun: (ScanTab) -> Unit,
    onOpenPatient: (String) -> Unit,
    onCall: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Assistant",
            eyebrow = when (state.tab) {
                ScanTab.Brief -> "The morning, in one screen"
                ScanTab.Dormant -> "Who has not been back"
                ScanTab.Money -> "What has not been collected"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
            stats = when (val brief = state.brief) {
                null -> emptyList()
                else -> if (state.tab != ScanTab.Brief) emptyList() else listOf(
                    Stat("Booked", brief.total.toString()),
                    Stat("Came", brief.attended.toString()),
                    Stat("Cancelled", brief.cancelled.toString()),
                    Stat("To come", brief.stillScheduled.toString()),
                )
            },
        )

        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ScanTab.entries.filter { state.allowed(it) }.forEach { t ->
                SettingsPill(t.label, solid = state.tab == t) { onTab(t) }
            }
        }

        state.error?.let { message ->
            Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                Txt(message, Type.caption, T.danger, Modifier.padding(T.gutter), maxLines = 4)
            }
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {

            if (state.running) {
                item {
                    Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }

            when (state.tab) {
                ScanTab.Brief -> brief(state, onOpenPatient)
                ScanTab.Dormant -> dormant(state, onOpenPatient, onCall)
                ScanTab.Money -> money(state, onOpenPatient)
            }

            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt(
                        "Each run costs AI credits.",
                        Type.caption, T.inkFaint, Modifier.weight(1f), maxLines = 2,
                    )
                    Spacer(Modifier.width(10.dp))
                    SettingsPill(
                        if (hasResult(state)) "Run it again" else "Run it",
                        solid = !hasResult(state),
                    ) { onRun(state.tab) }
                }
            }
        }
    }
}

private fun hasResult(state: Assistant): Boolean = when (state.tab) {
    ScanTab.Brief -> state.brief != null
    ScanTab.Dormant -> state.dormant != null
    ScanTab.Money -> state.revenue != null
}

private fun androidx.compose.foundation.lazy.LazyListScope.brief(
    state: Assistant,
    onOpenPatient: (String) -> Unit,
) {
    val brief = state.brief
    if (brief == null) {
        if (!state.running) item { SettingsEmpty("Nothing read yet.") }
        return
    }

    if (brief.staleBalances.isNotEmpty()) {
        item { SectionLabel("Money nothing has touched · ${brief.staleBalanceTotal.toLong()} EGP") }
        item {
            RowGroup {
                brief.staleBalances.forEachIndexed { i, row ->
                    if (i > 0) Rule()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onOpenPatient(row.patientId) }
                            .padding(horizontal = T.gutter, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(row.patientName, Type.rowName, T.ink, maxLines = 1)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                "Nothing for ${row.daysSinceLastActivity} days",
                                Type.caption, T.inkMuted, maxLines = 1,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Txt("${row.balance.toLong()}", Type.label, T.ink)
                    }
                }
            }
        }
    } else if (brief.isEmpty) {
        item { SettingsEmpty("A quiet day: nothing booked and nothing outstanding.") }
    }

    notes(brief.notes)
}

private fun androidx.compose.foundation.lazy.LazyListScope.dormant(
    state: Assistant,
    onOpenPatient: (String) -> Unit,
    onCall: (String) -> Unit,
) {
    if (!state.canSeePatients) {
        item { SettingsEmpty("This account cannot see the patient list.") }
        return
    }
    val report = state.dormant
    if (report == null) {
        if (!state.running) {
            item {
                SettingsEmpty(
                    "Finds everyone who has not been back for a while and is not already booked in.",
                )
            }
        }
        return
    }

    item {
        SectionLabel(
            "${report.patients.size} worth a call · not seen in ${report.thresholdDays} days",
        )
    }
    item {
        RowGroup {
            report.patients.take(60).forEachIndexed { i, row ->
                if (i > 0) Rule()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenPatient(row.patientId) }
                        .padding(horizontal = T.gutter, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Txt(row.patientName, Type.rowName, T.ink, maxLines = 1)
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            if (row.lastVisitDate.isBlank()) {
                                "Never been in"
                            } else {
                                "Last in ${row.lastVisitDate} · ${row.daysSinceLastVisit} days"
                            },
                            Type.caption, T.inkMuted, maxLines = 1,
                        )
                    }
                    row.phone.takeIf { it.isNotBlank() }?.let { phone ->
                        Spacer(Modifier.width(10.dp))
                        SettingsPill("Call") { onCall(phone) }
                    }
                }
            }
        }
    }
    if (report.patients.isEmpty()) {
        item { SettingsEmpty("Nobody has drifted off. Everyone is either recent or already booked.") }
    }
    notes(report.notes)
}

private fun androidx.compose.foundation.lazy.LazyListScope.money(
    state: Assistant,
    onOpenPatient: (String) -> Unit,
) {
    if (!state.canSeeMoney) {
        item { SettingsEmpty("This account cannot see the clinic's money.") }
        return
    }
    val report = state.revenue
    if (report == null) {
        if (!state.running) {
            item {
                SettingsEmpty(
                    "Looks for treatment that was done and never invoiced, balances nobody has " +
                        "chased, and rows entered twice.",
                )
            }
        }
        return
    }

    item { SectionLabel("About ${report.recoverable.toLong()} EGP recoverable") }
    item {
        RowGroup {
            Fact("Treated, never invoiced", report.unbilledWork)
            Rule()
            Fact("Unpaid balances", report.outstandingBalance)
            Rule()
            Fact("Entered twice", report.duplicates)
        }
    }

    item { SectionLabel("Where it is") }
    item {
        RowGroup {
            report.findings.take(60).forEachIndexed { i, finding ->
                if (i > 0) Rule()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onOpenPatient(finding.patientId) }
                        .padding(horizontal = T.gutter, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Txt(finding.patientName, Type.rowName, T.ink, maxLines = 1)
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            listOf(
                                IntelligenceClient.findingLabel(finding.kind, arabic = false),
                                finding.detail,
                            ).filter { it.isNotBlank() }.joinToString(" · "),
                            Type.caption, T.inkMuted, maxLines = 2,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Txt("${finding.amount.toLong()}", Type.label, T.ink)
                }
            }
        }
    }

    if (report.truncated) {
        item {
            Txt(
                // The difference between "this is what there is" and "this is
                // what we got to", which changes what the number means.
                "The scan stopped at its limit, so these totals are a floor rather than the whole " +
                    "picture.",
                Type.caption, T.warn,
                Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                maxLines = 3,
            )
        }
    }
    notes(report.notes)
}

/** The server's caveats, verbatim. */
private fun androidx.compose.foundation.lazy.LazyListScope.notes(notes: List<String>) {
    if (notes.isEmpty()) return
    item { SectionLabel("What these figures do and do not mean") }
    item {
        Column(Modifier.padding(horizontal = T.gutter, vertical = 6.dp)) {
            notes.forEach { note ->
                Txt("· $note", Type.caption, T.inkMuted, Modifier.padding(vertical = 5.dp), maxLines = 5)
            }
        }
    }
}

@Composable
private fun Fact(label: String, amount: Double) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, Type.body, T.inkMuted, Modifier.weight(1f), maxLines = 2)
        Spacer(Modifier.width(10.dp))
        Txt("${amount.toLong()}", Type.label, T.ink)
    }
}
