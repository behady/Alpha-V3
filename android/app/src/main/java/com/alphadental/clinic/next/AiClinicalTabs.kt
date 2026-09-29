package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.alphadental.clinic.data.AiClinical
import com.alphadental.clinic.data.PatientMedia
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Segmented
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** What the AI tab can do. One object rather than fourteen lambdas through three layers. */
data class AiClinicalActions(
    val show: (AiSection) -> Unit,
    // diagnosis
    val type: (String) -> Unit,
    val ask: () -> Unit,
    val summarize: () -> Unit,
    val setSuper: (Boolean) -> Unit,
    val pickPhotos: (Boolean) -> Unit,
    val toggleAttached: (PatientMedia) -> Unit,
    /** Add a picture to the file from here: (camera?, category). Null when the account may not. */
    val upload: ((Boolean, String) -> Unit)? = null,
    val openChat: (AiClinical.DiagChat?) -> Unit,
    // plan
    val instruct: (String) -> Unit,
    val answer: (String) -> Unit,
    val propose: (Boolean) -> Unit,
    val saveOption: (Int) -> Unit,
    // x-rays
    val togglePicked: (String) -> Unit,
    val noteXray: (String) -> Unit,
    val setDeep: (Boolean) -> Unit,
    val setCompare: (Boolean) -> Unit,
    val read: () -> Unit,
    val view: (AiClinical.XrayRow?) -> Unit,
    val review: (Map<String, String>, Map<String, String>, Boolean) -> Unit,
    val clearErrors: () -> Unit,
)

/**
 * The AI tab of a patient's file.
 *
 * Three sections behind one switch, because three more tabs on a strip that already has seven
 * would push the ledger off the screen. Every section says what a tap costs before the tap,
 * because a screen that spends credits by being looked at is a screen people learn not to open.
 */
fun LazyListScope.aiClinical(state: AiClinicalState, a: AiClinicalActions) {
    item {
        Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
            Segmented(
                AiSection.entries.map { it.label },
                AiSection.entries.indexOf(state.section),
            ) { a.show(AiSection.entries[it]) }
        }
    }

    if (!state.canUse) {
        item {
            SettingsEmpty(
                "This account can read the file but not ask the assistant about it. The clinical " +
                    "tick-box under Settings → The team is what opens this.",
            )
        }
        return
    }

    when (state.section) {
        AiSection.Diagnosis -> diagnosis(state, a)
        AiSection.Plan -> plan(state, a)
        AiSection.Xray -> xrays(state, a)
    }
}

// ====================================================================== diagnosis

private fun LazyListScope.diagnosis(state: AiClinicalState, a: AiClinicalActions) {
    state.diagError?.let { item { ErrorBand(it, a.clearErrors) } }

    if (state.chats.isNotEmpty()) {
        item { SectionLabel("Discussions") }
        item {
            RowGroup {
                state.chats.take(6).forEachIndexed { i, chat ->
                    if (i > 0) Rule()
                    val current = chat.id == state.chatId
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { a.openChat(chat) }
                            .padding(horizontal = T.gutter, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Txt(chat.title.ifBlank { "Discussion" }, Type.rowName, T.ink, maxLines = 1)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                "${chat.messages.size} messages" + (if (chat.mode == "super") " · Pro model" else ""),
                                Type.caption, T.inkMuted,
                            )
                        }
                        if (current) Txt("Open", Type.chip, T.accentInk, uppercase = true)
                    }
                }
                if (state.chatId != null) {
                    Rule()
                    Txt(
                        "Start a new discussion",
                        Type.label.copy(fontSize = 13.sp), T.accentInk,
                        Modifier.fillMaxWidth().clickable { a.openChat(null) }
                            .padding(horizontal = T.gutter, vertical = 14.dp),
                    )
                }
            }
        }
    }

    if (state.messages.isEmpty()) {
        item {
            Column(Modifier.padding(horizontal = T.gutter, vertical = 18.dp)) {
                Txt("Work up a diagnosis together", Type.heading, T.ink, maxLines = 2)
                Spacer(Modifier.height(6.dp))
                Txt(
                    "The assistant has read this patient's chart, notes and history. Describe what " +
                        "you see, attach photographs, and it will ask for the tests only you can do " +
                        "at the chair. It never writes to the chart — you decide what goes on it.",
                    Type.body, T.inkMuted, maxLines = 6,
                )
            }
        }
    }

    items(state.messages.size, key = { "dm-$it" }) { i -> DiagBubble(state.messages[i]) }

    if (state.thinking) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(10.dp))
                Txt("Thinking…", Type.caption, T.inkMuted)
            }
        }
    }

    // ---- the composer, inline. A pinned one cannot live inside the file's own list.
    item {
        Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
            if (state.attached.isNotEmpty()) {
                Row(
                    Modifier.padding(horizontal = T.gutter, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.attached.forEach { m ->
                        Box(
                            Modifier.size(54.dp).clip(RoundedCornerShape(10.dp)).background(T.surfaceSoft)
                                .clickable { a.toggleAttached(m) },
                        ) {
                            AsyncImage(m.url, m.category, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        }
                    }
                }
            }
            SheetField(
                label = "Ask the diagnostician",
                value = state.draft,
                onChange = a.type,
                hint = "Tooth 36 tender to percussion, cold test negative…",
                lines = 2,
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SettingsPill(
                    if (state.thinking) "Asking…" else "Ask · ${state.diagnosisCredits} credit${if (state.diagnosisCredits == 1) "" else "s"}",
                    solid = true,
                ) { if (!state.thinking && state.draft.isNotBlank()) a.ask() }
                SettingsPill(if (state.attached.isEmpty()) "Attach photos" else "Photos · ${state.attached.size}") {
                    a.pickPhotos(!state.pickingPhotos)
                }
                if (state.messages.size >= 2) {
                    SettingsPill("Summarise") { if (!state.thinking) a.summarize() }
                }
            }
            ModeRow(
                on = state.superMode,
                label = "Pro model",
                hint = "Deeper reasoning, three times the credits",
                onToggle = a.setSuper,
            )
        }
    }

    // Adding a picture is always on offer here, not only after "Attach photos" has been tapped:
    // the dentist at the chair wants to take the photo first and ask second.
    item { SectionLabel("Add a picture") }
    item { UploadRow(state, a, category = "Clinical Photo") }
    if (state.pickingPhotos) {
        item { SectionLabel("Attach from the gallery · up to ${AiClinical.DIAGNOSIS_MAX_IMAGES}") }
        if (state.media.isEmpty()) {
            item { SettingsEmpty(if (state.canUpload) "No photographs on this file yet. Take one or pick one above." else "No photographs on this file yet. Add some under Photos first.") }
        } else {
            item {
                MediaGrid(state.media, picked = state.attached.map { it.id }) { m -> a.toggleAttached(m) }
            }
        }
    }
}

@Composable
private fun DiagBubble(line: AiClinical.DiagLine) {
    val mine = line.mine
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 5.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 18.dp, topEnd = 18.dp,
                bottomStart = if (mine) 18.dp else 4.dp,
                bottomEnd = if (mine) 4.dp else 18.dp,
            ),
            color = if (mine) T.slab else T.surface,
            border = if (mine) null else BorderStroke(1.dp, T.line),
            modifier = Modifier.fillMaxWidth(0.88f),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                if (line.images.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                        line.images.take(4).forEach { url ->
                            Box(Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).background(T.surfaceSoft)) {
                                AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                            }
                        }
                    }
                }
                Txt(line.content, Type.body, if (mine) T.onSlab else T.ink, maxLines = 80)
            }
        }
    }
}

// ====================================================================== plan

private fun LazyListScope.plan(state: AiClinicalState, a: AiClinicalActions) {
    state.planError?.let { item { ErrorBand(it, a.clearErrors) } }
    state.planSaved?.let { item { NoticeBand(it, a.clearErrors) } }

    item {
        Column(Modifier.fillMaxWidth().padding(top = 6.dp)) {
            if (state.proposal == null) {
                Column(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                    Txt("Propose a treatment plan", Type.heading, T.ink, maxLines = 2)
                    Spacer(Modifier.height(6.dp))
                    Txt(
                        "Built from what is on the chart and the clinic's own price list, with visits " +
                            "placed on real free slots in the diary. Up to three options. Anything the " +
                            "price list cannot name arrives at zero for you to price.",
                        Type.body, T.inkMuted, maxLines = 6,
                    )
                }
            }
            SheetField(
                label = "Anything the assistant should know",
                value = state.instructions,
                onChange = a.instruct,
                hint = "Patient wants the front teeth first; budget is tight",
                lines = 2,
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SettingsPill(
                    if (state.planning) "Working…" else if (state.proposal == null) "Propose · ${state.planCredits} credits" else "Propose again · ${state.planCredits} credits",
                    solid = true,
                ) { if (!state.planning) a.propose(false) }
            }
            ModeRow(
                on = state.superMode,
                label = "Pro model",
                hint = "Deeper reasoning, three times the credits",
                onToggle = a.setSuper,
            )
        }
    }

    if (state.planning) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(10.dp))
                Txt("Reading the chart and the diary…", Type.caption, T.inkMuted)
            }
        }
    }

    val proposal = state.proposal ?: return

    if (proposal.questions.isNotEmpty()) {
        item { SectionLabel("The assistant asks") }
        item {
            RowGroup {
                proposal.questions.forEachIndexed { i, q ->
                    if (i > 0) Rule()
                    Txt(q, Type.body, T.ink, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 4)
                }
            }
        }
        item {
            SheetField("Your answers", state.answers, a.answer, hint = "Two visits is fine; 90 minutes each", lines = 2)
        }
        item {
            Row(Modifier.padding(horizontal = T.gutter, vertical = 4.dp)) {
                SettingsPill("Refine with these answers · ${state.planCredits} credits", solid = true) {
                    if (!state.planning && state.answers.isNotBlank()) a.propose(true)
                }
            }
        }
    }

    proposal.options.forEachIndexed { index, option ->
        item { SectionLabel("Option ${index + 1}") }
        item {
            RowGroup {
                Column(Modifier.padding(horizontal = T.gutter, vertical = 14.dp)) {
                    Row(verticalAlignment = Alignment.Top) {
                        Txt(option.title, Type.rowName, T.ink, Modifier.weight(1f), maxLines = 3)
                        Spacer(Modifier.width(10.dp))
                        Txt("${option.total.toLong()} ${proposal.currency}", Type.label.copy(fontSize = 14.sp), T.ink)
                    }
                    if (option.description.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Txt(option.description, Type.caption, T.inkMuted, maxLines = 8)
                    }
                }
                option.visits.forEachIndexed { vi, visit ->
                    Rule()
                    Column(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                        Txt(
                            "Visit ${vi + 1} · ${visit.label.ifBlank { "Visit" }}",
                            Type.eyebrow, T.inkFaint, uppercase = true,
                        )
                        Spacer(Modifier.height(2.dp))
                        Txt(
                            listOfNotNull(
                                visit.date.takeIf { it.isNotBlank() }?.let { noteDate(it) },
                                visit.time.takeIf { it.isNotBlank() },
                                "${visit.durationMinutes} min",
                            ).joinToString(" · "),
                            Type.caption, T.inkMuted,
                        )
                        visit.steps.forEach { step ->
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.Top) {
                                Column(Modifier.weight(1f)) {
                                    Txt(step.serviceName, Type.body, T.ink, maxLines = 2)
                                    val detail = listOfNotNull(
                                        step.teeth.takeIf { it.isNotBlank() }?.let { "teeth $it" },
                                        step.quantity.takeIf { it > 1 }?.let { "×$it" },
                                        step.note.takeIf { it.isNotBlank() },
                                    )
                                    if (detail.isNotEmpty()) {
                                        Txt(detail.joinToString(" · "), Type.caption, T.inkMuted, maxLines = 3)
                                    }
                                }
                                Spacer(Modifier.width(8.dp))
                                Txt(
                                    if (step.unmatched) "unpriced" else step.lineTotal.toLong().toString(),
                                    Type.caption.copy(fontSize = 12.sp),
                                    if (step.unmatched) T.warn else T.ink,
                                )
                            }
                        }
                    }
                }
                Rule()
                Row(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                    SettingsPill(
                        if (state.savingOption == index) "Saving…" else "Save as a draft plan",
                        solid = true,
                    ) { if (state.savingOption == null) a.saveOption(index) }
                }
            }
        }
    }

    if (proposal.calendarNotes.isNotEmpty()) {
        item {
            Txt(
                proposal.calendarNotes.joinToString("\n"),
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp), maxLines = 6,
            )
        }
    }
}

// ====================================================================== x-rays

private fun LazyListScope.xrays(state: AiClinicalState, a: AiClinicalActions) {
    state.xrayError?.let { item { ErrorBand(it, a.clearErrors) } }

    item { SectionLabel("Pick up to ${AiClinical.XRAY_MAX_IMAGES} pictures") }
    item { UploadRow(state, a, category = "X-Ray") }
    if (state.media.isEmpty()) {
        item { SettingsEmpty(if (state.canUpload) "No x-rays on this file yet. Take one or pick one above." else "No x-rays or photographs on this file yet. Add them under Photos first.") }
    } else {
        item { MediaGrid(state.xrayCandidates, picked = state.picked) { m -> a.togglePicked(m.id) } }
    }

    item {
        Column(Modifier.fillMaxWidth()) {
            SheetField("A note for the reader", state.note, a.noteXray, hint = "Pain upper left, suspect 26", lines = 1)
            ModeRow(state.deep, "Deep read", "The bigger model, three times the credits", a.setDeep)
            ModeRow(state.compare, "Compare over time", "Exactly two pictures, older first", a.setCompare)
            Row(Modifier.padding(horizontal = T.gutter, vertical = 8.dp)) {
                SettingsPill(
                    if (state.reading) "Reading…" else "Read ${state.picked.size.takeIf { it > 0 }?.let { "$it picture${if (it == 1) "" else "s"} · " } ?: ""}${state.xrayCredits} credits",
                    solid = true,
                ) { if (!state.reading && state.picked.isNotEmpty()) a.read() }
            }
            Txt(
                "An AI reading is a second opinion for the dentist, never a diagnosis for the " +
                    "patient. Nothing reaches the chart or the patient until you confirm it and sign.",
                Type.caption, T.inkFaint,
                Modifier.padding(horizontal = T.gutter, vertical = 6.dp), maxLines = 3,
            )
        }
    }

    if (state.reading) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(10.dp))
                Txt("Reading the pictures. This takes a moment.", Type.caption, T.inkMuted)
            }
        }
    }

    if (state.reports.isNotEmpty()) {
        item { SectionLabel("Readings · ${state.reports.size}") }
        item {
            RowGroup {
                state.reports.forEachIndexed { i, row ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().clickable { a.view(row) }
                            .padding(horizontal = T.gutter, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        row.media.firstOrNull()?.let { m ->
                            Box(Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(T.surfaceSoft)) {
                                AsyncImage(m.url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                            }
                            Spacer(Modifier.width(12.dp))
                        }
                        Column(Modifier.weight(1f)) {
                            Txt(row.report.summary.ifBlank { row.report.imageType }, Type.rowName, T.ink, maxLines = 2)
                            Spacer(Modifier.height(2.dp))
                            Txt(
                                listOfNotNull(
                                    noteDateMillis(row.createdMillis),
                                    row.report.imageType.replace('_', ' ').takeIf { it.isNotBlank() },
                                    "${row.report.teeth.size} finding${if (row.report.teeth.size == 1) "" else "s"}",
                                    if (row.mode == "deep") "deep" else null,
                                ).joinToString(" · "),
                                Type.caption, T.inkMuted, maxLines = 1,
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Txt(
                            if (row.signed) "Signed" else "Unsigned",
                            Type.chip.copy(fontSize = 10.sp),
                            if (row.signed) T.ok else T.warn,
                            uppercase = true,
                        )
                    }
                }
            }
        }
    }
}

/**
 * One reading, in full.
 *
 * Findings first, each with the dentist's three answers — confirm, reject, chart — because that is
 * the work; the prose sections come after. Signing is the last thing on the sheet and stays
 * available until it has been done, so the report cannot be read as final by mistake.
 */
@Composable
fun XrayReportSheet(state: AiClinicalState, a: AiClinicalActions) {
    val row = state.viewing ?: return
    val r = row.report

    Sheet(
        title = "X-ray reading",
        caption = listOfNotNull(
            noteDateMillis(row.createdMillis),
            r.imageType.replace('_', ' ').takeIf { it.isNotBlank() },
            if (row.signed) "signed by ${row.signedByName.ifBlank { "the dentist" }}" else "not yet signed",
        ).joinToString(" · "),
        busy = state.reviewing,
        error = state.xrayError,
        action = if (row.signed) "Signed" else "Sign this report",
        ready = !row.signed,
        onAction = { a.review(emptyMap(), emptyMap(), true) },
        onDismiss = { a.view(null) },
    ) {
        if (row.media.isNotEmpty()) {
            Row(
                Modifier.padding(horizontal = T.gutter, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.media.forEach { m ->
                    Box(Modifier.size(84.dp).clip(RoundedCornerShape(10.dp)).background(T.surfaceSoft)) {
                        AsyncImage(m.url, m.category, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }

        if (r.summary.isNotBlank()) {
            Txt(r.summary, Type.body, T.ink, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 12)
        }
        Txt(
            listOfNotNull(
                r.quality.takeIf { it.isNotBlank() }?.let { "Image quality $it" },
                r.qualityNotes.takeIf { it.isNotBlank() },
            ).joinToString(" · "),
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 2.dp), maxLines = 3,
        )

        if (r.comparisonVerdict.isNotBlank()) {
            Rule()
            Txt("Over time: ${r.comparisonVerdict.replace('_', ' ')}", Type.rowName, T.ink, Modifier.padding(horizontal = T.gutter, vertical = 10.dp))
            r.comparisonChanges.forEach { Txt("· $it", Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 2.dp), maxLines = 4) }
        }

        if (r.teeth.isNotEmpty()) {
            Rule()
            Txt("Findings", Type.eyebrow, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 10.dp), uppercase = true)
            r.teeth.forEachIndexed { i, f ->
                val key = i.toString()
                val verdict = row.verdicts[key].orEmpty()
                val charted = row.charted.containsKey(key)
                Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(severityColor(f.severity)))
                        Spacer(Modifier.width(8.dp))
                        Txt(
                            (if (f.tooth.isNotBlank()) "Tooth ${f.tooth} · " else "") + f.finding,
                            Type.rowName, if (verdict == "rejected") T.inkFaint else T.ink,
                            Modifier.weight(1f), maxLines = 4,
                        )
                    }
                    Spacer(Modifier.height(2.dp))
                    Txt(
                        listOfNotNull(
                            f.severity.takeIf { it.isNotBlank() },
                            f.confidence.takeIf { it.isNotBlank() }?.let { "$it confidence" },
                            if (row.media.size > 1) "picture ${f.image}" else null,
                            when (verdict) { "confirmed" -> "confirmed"; "rejected" -> "rejected"; "edited" -> "edited"; else -> null },
                            if (charted) "on the chart" else null,
                        ).joinToString(" · "),
                        Type.caption, T.inkMuted, maxLines = 2,
                    )
                    if (!row.signed) {
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (verdict != "confirmed") SettingsPill("Confirm") { a.review(mapOf(key to "confirmed"), emptyMap(), false) }
                            if (verdict != "rejected") SettingsPill("Reject") { a.review(mapOf(key to "rejected"), emptyMap(), false) }
                            if (f.category.isNotBlank() && !charted && verdict != "rejected" && f.tooth.matches(Regex("\\d{2}"))) {
                                SettingsPill("Chart it", solid = true) {
                                    a.review(mapOf(key to "confirmed"), mapOf(key to f.category), false)
                                }
                            }
                        }
                    }
                }
            }
        }

        listOf(
            "General" to r.general,
            "Incidental" to r.incidental,
            "Recommendations" to r.recommendations,
            "Differs from the chart" to r.chartDiscrepancies,
        ).filter { it.second.isNotEmpty() }.forEach { (label, lines) ->
            Rule()
            Txt(label, Type.eyebrow, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 10.dp), uppercase = true)
            lines.forEach { Txt("· $it", Type.body, T.ink, Modifier.padding(horizontal = T.gutter, vertical = 3.dp), maxLines = 6) }
        }

        if (r.limitations.isNotBlank()) {
            Rule()
            Txt(r.limitations, Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 10.dp), maxLines = 6)
        }

        if (r.patientSummary.isNotBlank()) {
            Rule()
            Txt("In the patient's words", Type.eyebrow, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 10.dp), uppercase = true)
            Txt(r.patientSummary, Type.body, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 2.dp), maxLines = 12)
            Txt(
                "Sent to the patient only from the website, and only once this report is signed.",
                Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 8.dp), maxLines = 2,
            )
        }

        Rule()
        Txt(
            "Signing closes the report under your name. Confirm or reject the findings first; " +
                "unreviewed findings are signed as read, not as agreed.",
            Type.caption, T.inkMuted, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 4,
        )
    }
}

// ====================================================================== pieces

/** Three across, tap to tick. The same grid the Photos tab draws, with a tick on the chosen ones. */
@Composable
private fun MediaGrid(items: List<PatientMedia>, picked: List<String>, onTap: (PatientMedia) -> Unit) {
    Column(Modifier.padding(horizontal = T.gutter, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { m ->
                    val on = m.id in picked
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(T.surfaceSoft)
                            .then(if (on) Modifier.border(3.dp, T.accent, RoundedCornerShape(10.dp)) else Modifier)
                            .clickable { onTap(m) },
                    ) {
                        AsyncImage(m.url, m.category, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        Txt(
                            m.category.ifBlank { "Photo" },
                            Type.chip.copy(fontSize = 9.sp), Color.White,
                            Modifier.align(Alignment.BottomStart).background(Color.Black.copy(alpha = .55f))
                                .padding(horizontal = 6.dp, vertical = 3.dp),
                            uppercase = true,
                        )
                        if (on) {
                            Box(
                                Modifier.align(Alignment.TopEnd).padding(6.dp).size(22.dp).clip(CircleShape).background(T.accent),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Filled.Check, null, tint = T.onAccent, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * Take a picture or pick one, from the AI tab itself.
 *
 * The owner: "there should be an upload button here". The picture goes on the patient's file
 * under Photos exactly as if it had been added there, and comes straight back into this list,
 * attached — so an x-ray taken at the chair is read without a trip through another tab.
 */
@Composable
private fun UploadRow(state: AiClinicalState, a: AiClinicalActions, category: String) {
    val upload = a.upload
    if (upload == null || !state.canUpload) {
        Txt(
            "Adding pictures needs the clinical tick-box under Settings → The team.",
            Type.caption, T.inkFaint, Modifier.padding(horizontal = T.gutter, vertical = 4.dp), maxLines = 2,
        )
        return
    }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SettingsPill(if (state.uploading) "Saving…" else "Take a photo", solid = true) { if (!state.uploading) upload(true, category) }
        SettingsPill("From the gallery") { if (!state.uploading) upload(false, category) }
        Txt(
            if (category == "X-Ray") "Saved to the file as an x-ray" else "Saved to the file as a clinical photo",
            Type.caption, T.inkFaint, Modifier.weight(1f), maxLines = 2,
        )
    }
}

@Composable
private fun ModeRow(on: Boolean, label: String, hint: String, onToggle: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onToggle(!on) }.padding(horizontal = T.gutter, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Txt(label, Type.rowName, T.ink)
            Txt(hint, Type.caption, T.inkMuted, maxLines = 2)
        }
        Surface(
            shape = T.pill,
            color = if (on) T.slab else T.surface,
            border = if (on) null else BorderStroke(1.dp, T.line),
        ) {
            Txt(
                if (on) "On" else "Off", Type.label.copy(fontSize = 12.sp),
                if (on) T.onSlab else T.inkMuted,
                Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun ErrorBand(message: String, onDismiss: () -> Unit) {
    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth().clickable(onClick = onDismiss)) {
        Txt(message, Type.caption, T.danger, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 5)
    }
}

@Composable
private fun NoticeBand(message: String, onDismiss: () -> Unit) {
    Surface(color = T.accentTint, modifier = Modifier.fillMaxWidth().clickable(onClick = onDismiss)) {
        Txt(message, Type.caption, T.accentInk, Modifier.padding(horizontal = T.gutter, vertical = 12.dp), maxLines = 4)
    }
}

// The palette is read through a composition local, so a colour lookup is itself composable.
@Composable
private fun severityColor(severity: String): Color = when (severity) {
    "urgent", "severe" -> T.danger
    "moderate" -> T.warn
    "mild" -> T.ok
    else -> T.inkFaint
}

private fun noteDateMillis(millis: Long): String? {
    if (millis <= 0L) return null
    return java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale.US).format(java.util.Date(millis))
}
