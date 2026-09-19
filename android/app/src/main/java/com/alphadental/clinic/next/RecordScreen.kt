package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material.icons.filled.MoreHoriz
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
    onRecordTreatment: (() -> Unit)? = null,
    onMore: (() -> Unit)? = null,
    onFilterMedia: (String) -> Unit = {},
    onUploadCategory: (String) -> Unit = {},
    onView: (String?) -> Unit = {},
    onCamera: (() -> Unit)? = null,
    onGallery: (() -> Unit)? = null,
    onSetNoteStatus: (String, String) -> Unit = { _, _ -> },
    onChart: (Int) -> Unit = {},
    onPrescribe: (() -> Unit)? = null,
    onEditDetails: (() -> Unit)? = null,
    onPrintScript: (com.alphadental.clinic.data.Prescription) -> Unit = {},
    onShareScript: (com.alphadental.clinic.data.Prescription) -> Unit = {},
    onSendScript: (com.alphadental.clinic.data.Prescription) -> Unit = {},
    onCopyScript: ((com.alphadental.clinic.data.Prescription) -> Unit)? = null,
    /** Null when this account may not correct the books, which makes the rows inert. */
    onEditRow: ((com.alphadental.clinic.next.data.Money) -> Unit)? = null,
    onEditNote: ((com.alphadental.clinic.data.ClinicalNote) -> Unit)? = null,
    /** The AI tab's own state and verbs. Null in the preview, which has no server to ask. */
    ai: AiClinicalState? = null,
    aiActions: AiClinicalActions? = null,
    // ---- the website's page
    onPlan: (() -> Unit)? = null,
    onOrtho: (() -> Unit)? = null,
    onSort: () -> Unit = {},
    onDeleteNote: ((com.alphadental.clinic.data.ClinicalNote) -> Unit)? = null,
    onDeleteRow: ((Money) -> Unit)? = null,
    onPlanStatus: ((com.alphadental.clinic.data.TreatmentPlans.Plan, String) -> Unit)? = null,
) {
    val record = state.record

    Column(Modifier.fillMaxSize().background(T.ground)) {

        // A short slab — back, the file number, the name — and the website's cards under it.
        Slab(
            title = record?.person?.name?.ifBlank { "No name" } ?: "Patient",
            eyebrow = "Patients" + (record?.fileId?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                val phone = record?.person?.phone.orEmpty()
                if (phone.isNotBlank()) {
                    SlabIcon(Icons.Filled.Phone, "Call") { onCall(phone) }
                    Spacer(Modifier.width(8.dp))
                }
                onTakePayment?.let {
                    SlabIcon(Icons.Filled.AccountBalanceWallet, "Take payment", onClick = it)
                    Spacer(Modifier.width(8.dp))
                }
                onMore?.let { SlabIcon(Icons.Filled.MoreHoriz, "More", onClick = it) }
            },
        )

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
                item { PatientCard(record, onEditDetails, onCall, onMessage) }
                item { StatsCard(visits = record.past.size, completed = state.notes.count { it.status != "Planned" }) }
                item { QuickActions(onRx = onPrescribe, onDiagnosis = { onTab(RecordTab.Notes) }, onOrtho = onOrtho) }
                item { Spacer(Modifier.height(6.dp)) }
                item { WebTabs(state.tab, onTab) }
                when (state.tab) {
                    RecordTab.Overview -> overview(state, record)
                    RecordTab.Ai -> if (ai != null && aiActions != null) {
                        aiClinical(ai, aiActions)
                    } else {
                        item { SettingsEmpty("The assistant is not available in the preview.") }
                    }
                    RecordTab.Notes -> {
                        // One tab for the mouth and what was done to it. The chart on top with its
                        // two verbs — add a procedure, add a diagnosis — then the picked tooth's
                        // history, then the timeline. They were two tabs, and the owner asked for
                        // one: a dentist charting a tooth and then recording the filling on it is
                        // doing one job, not two.
                        chart(state, record, onSelectTooth, onChart, onRecordTreatment)
                        if (state.tooth != null) toothHistory(state, record)
                        clinical(state, null, onSort, onEditNote, onDeleteNote)
                    }
                    RecordTab.Plan -> plans(state, onPlan, onPlanStatus)
                    RecordTab.Visits -> visits(record)
                    RecordTab.Rx -> scripts(state, onPrescribe, onPrintScript, onShareScript, onSendScript, onCopyScript)
                    RecordTab.Photos -> photos(state, onFilterMedia, onUploadCategory, onView, onCamera, onGallery)
                    RecordTab.Ledger -> finance(state, onTakePayment, onEditRow, onDeleteRow)
                }
            }
        }
    }
}

/**
 * The photographs on a file.
 *
 * A grid rather than a list: an x-ray is recognised at a glance and read by
 * opening it, and three to a row is the most a thumb can still hit.
 *
 * The camera is the point of having this on a phone at all. A clinical photo
 * taken chairside and filed in ten seconds is one that gets taken; one that has
 * to be emailed to a desk later is one that does not.
 */
private fun LazyListScope.photos(
    state: RecordState,
    onFilter: (String) -> Unit,
    onCategory: (String) -> Unit,
    onView: (String?) -> Unit,
    onCamera: (() -> Unit)?,
    onGallery: (() -> Unit)?,
) {
    state.mediaError?.let { message ->
        item {
            Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                Txt(message, Type.caption, T.danger, Modifier.padding(T.gutter), maxLines = 3)
            }
        }
    }

    if (onCamera != null || onGallery != null) {
        item { SectionLabel("File it as") }
        item {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MEDIA_CATEGORIES.forEach { c ->
                    SettingsPill(c, solid = state.uploadCategory == c) { onCategory(c) }
                }
            }
        }
        item {
            // Two proper buttons, not two chips in a row of chips. These are the
            // point of the tab: the camera is why a phone has a photos tab at
            // all, and a pill that looks like a filter reads as a filter.
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                onCamera?.let {
                    PhotoButton(
                        Icons.Filled.PhotoCamera, "Take a photo",
                        solid = true, busy = state.uploading, Modifier.weight(1f), it,
                    )
                }
                onGallery?.let {
                    PhotoButton(
                        Icons.Filled.PhotoLibrary, "From the gallery",
                        solid = false, busy = state.uploading, Modifier.weight(1f), it,
                    )
                }
            }
            if (state.uploading) {
                Txt(
                    "Saving the photograph…", Type.caption, T.inkMuted,
                    Modifier.padding(horizontal = T.gutter, vertical = 4.dp),
                )
            }
        }
    }

    if (state.media.isNotEmpty()) {
        item { SectionLabel("Show") }
        item {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SettingsPill("Everything", solid = state.mediaFilter.isBlank()) {
                    if (state.mediaFilter.isNotBlank()) onFilter(state.mediaFilter)
                }
                MEDIA_CATEGORIES.forEach { c ->
                    val n = state.media.count { it.category == c }
                    if (n > 0) {
                        SettingsPill("$c · $n", solid = state.mediaFilter == c) { onFilter(c) }
                    }
                }
            }
        }
    }

    val shown = state.shownMedia
    if (shown.isEmpty()) {
        item {
            SettingsEmpty(
                if (state.media.isEmpty()) {
                    "No photographs on this file yet."
                } else {
                    "Nothing filed under that."
                },
            )
        }
        return
    }

    // Chunked into rows by hand rather than a nested grid: a LazyVerticalGrid
    // inside a LazyColumn cannot measure itself, and this list already scrolls.
    shown.chunked(3).forEachIndexed { rowIndex, row ->
        item(key = "media-$rowIndex") {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                row.forEach { media ->
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1f)
                            .clip(T.cardShape)
                            .background(T.surfaceSoft)
                            .clickable { onView(media.url) },
                    ) {
                        AsyncImage(
                            model = media.url,
                            contentDescription = media.category.ifBlank { media.filename },
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
                // Keeps a short last row the same size as a full one instead of
                // stretching two photos across the screen.
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }

    item { Spacer(Modifier.height(10.dp)) }
}

/** A tall button with an icon over its label: the two ways a photo gets onto a file. */
@Composable
private fun PhotoButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    solid: Boolean,
    busy: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Surface(
        shape = T.cardShape,
        color = if (solid) T.slab else T.surface,
        border = if (solid) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
        modifier = modifier.clickable(enabled = !busy, onClick = onClick),
    ) {
        Column(
            Modifier.padding(vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (busy && solid) {
                CircularProgressIndicator(
                    color = T.onSlabFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp),
                )
            } else {
                Icon(
                    icon, null,
                    tint = if (solid) T.onSlab else T.ink,
                    modifier = Modifier.size(26.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            Txt(
                label,
                Type.label.copy(fontSize = 13.sp),
                if (solid) T.onSlab else T.ink,
                maxLines = 1,
            )
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
    onRecordTreatment: (() -> Unit)?,
    onMore: (() -> Unit)?,
    onEditDetails: (() -> Unit)?,
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
            // Recording treatment lives in the bar rather than beside the
            // balance, because it is the one thing on this screen that is done
            // whether or not the patient owes anything.
            onRecordTreatment?.let {
                Spacer(Modifier.width(8.dp))
                SlabIcon(Icons.Filled.Add, "Record treatment", onClick = it)
            }
            // Everything else this file can do, behind one icon. Five buttons in
            // a row on a phone is five buttons nobody can hit.
            onEditDetails?.let {
                Spacer(Modifier.width(8.dp))
                SlabIcon(Icons.Filled.Edit, "Patient details", onClick = it)
            }
            onMore?.let {
                Spacer(Modifier.width(8.dp))
                SlabIcon(Icons.Filled.MoreHoriz, "More", onClick = it)
            }
        },
        // Nothing at all when the account is settled, which most are.
        figure = if (record == null || (owed <= 0 && credit <= 0 && onTakePayment == null)) null else {
            {
                // The word goes in the currency slot rather than the note
                // column: with a button on this row there is no note column, and
                // "EGP" beside "outstanding" ran together into one word.
                SlabFigure(
                    amount = money(if (owed > 0) owed else credit),
                    currency = if (owed > 0) "EGP owed" else "EGP credit",
                    compact = onTakePayment != null && owed > 0,
                )
                if (onTakePayment != null) {
                    Spacer(Modifier.weight(1f))
                    Surface(
                        shape = T.pill,
                        color = T.accent,
                        modifier = Modifier.padding(bottom = 6.dp).clickable(onClick = onTakePayment),
                    ) {
                        Txt(
                            if (owed > 0) "Take payment" else "Take deposit",
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
    onChart: (Int) -> Unit,
    onRecordTreatment: (() -> Unit)?,
) {
    item {
        ToothChart(
            teeth = record.teeth,
            selected = state.tooth,
            onSelect = onSelectTooth,
            treatments = state.treatments,
        )
    }

    // The two things this tab is for, side by side under the chart: add a procedure (teal, the
    // website's), add a diagnosis to the picked tooth (green). Nothing to hunt for.
    if (state.canRecord) {
        item {
            val n = state.tooth
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                onRecordTreatment?.let { add ->
                    Surface(
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                        color = androidx.compose.ui.graphics.Color(0xFF0D9488),
                        modifier = Modifier.weight(1f).clickable(onClick = add),
                    ) {
                        Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Add, null, tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Txt("Add procedure", Type.label.copy(fontSize = 13.sp), androidx.compose.ui.graphics.Color.White, maxLines = 1)
                        }
                    }
                }
                Surface(
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
                    color = if (n != null) androidx.compose.ui.graphics.Color(0xFF16A34A) else T.surfaceSoft,
                    border = if (n != null) null else androidx.compose.foundation.BorderStroke(1.dp, T.line),
                    modifier = Modifier.weight(1f).clickable(enabled = n != null) { n?.let(onChart) },
                ) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Add, null, tint = if (n != null) androidx.compose.ui.graphics.Color.White else T.inkFaint, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Txt(
                            if (n != null) "Diagnosis · tooth $n" else "Tap a tooth to diagnose",
                            Type.label.copy(fontSize = 13.sp),
                            if (n != null) androidx.compose.ui.graphics.Color.White else T.inkFaint, maxLines = 1,
                        )
                    }
                }
            }
        }
    }
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
