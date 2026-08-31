package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.Lead
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The CRM inbox on the phone.
 *
 * The website grows leads (Meta ads webhooks, stubs that heal, campaign
 * reports); the phone's job is the part that happens away from a desk: see the
 * new lead the moment it pings, call or WhatsApp them in two taps, and move
 * them along the pipe. Due follow-ups float to the top of the inbox, exactly as
 * they do on the website. Converting a lead into a patient stays on the
 * website, because that flow creates or links a patient file.
 */
@Composable
fun LeadsScreen(
    leads: List<Lead>,
    loading: Boolean,
    arabic: Boolean,
    onSetStage: (Lead, String, String?) -> Unit,
    /** Creates or links a patient file. Null for roles that may not add patients. */
    onConvert: ((Lead) -> Unit)?,
    /** The lead currently being converted, so only its own button waits. */
    convertingLeadId: String,
    onAdd: () -> Unit,
    onClose: () -> Unit,
) {
    val context = LocalContextCompat()
    BackHandler { onClose() }

    var stageFilter by rememberSaveable { mutableStateOf("inbox") }
    /** Blank means every source. Survives rotation, like the stage above it. */
    var sourceFilter by rememberSaveable { mutableStateOf("") }
    var losing by remember { mutableStateOf<Lead?>(null) }

    losing?.let { lead ->
        var reason by remember(lead.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { losing = null },
            containerColor = Alpha.Card,
            title = {
                Text(
                    if (arabic) "لماذا خسرنا ${lead.name}؟" else "Why was ${lead.name} lost?",
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate900,
                    fontSize = 17.sp,
                )
            },
            text = {
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    placeholder = {
                        Text(
                            if (arabic) "غالي، اختار عيادة أخرى، لا يرد…" else "Too expensive, chose elsewhere, no answer…",
                            color = Alpha.Slate400,
                        )
                    },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Alpha.Green,
                        unfocusedBorderColor = Alpha.Slate200,
                        cursorColor = Alpha.Ink,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onSetStage(lead, "lost", reason)
                    losing = null
                }) {
                    Text(if (arabic) "تأكيد" else "Mark lost", color = Alpha.Danger, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { losing = null }) {
                    Text(if (arabic) "إلغاء" else "Cancel", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            },
        )
    }

    val today = AppViewModel.today()
    // Every source the clinic actually has leads from, commonest first — read off
    // the leads rather than from a fixed list, because a clinic adds its own
    // sources on the website and a hardcoded set here would go stale the day it did.
    val sources = leads
        .mapNotNull { it.source.trim().takeIf(String::isNotBlank) }
        .groupingBy { it }
        .eachCount()
        .entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .map { it.key }

    val shown = leads
        .filter { lead ->
            when (stageFilter) {
                "inbox" -> lead.stage != "won" && lead.stage != "lost"
                else -> lead.stage == stageFilter
            }
        }
        // Narrowed together: "Facebook leads still in the inbox" is one question,
        // not two screens.
        .filter { lead -> sourceFilter.isBlank() || lead.source.trim() == sourceFilter }
        .sortedWith(
            // Due follow-ups first, then the newest arrivals.
            compareByDescending<Lead> { it.followUpDate.isNotBlank() && it.followUpDate <= today && it.stage !in setOf("won", "lost") }
                .thenByDescending { it.createdAtMillis }
        )

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp),
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (arabic) "العملاء المحتملون" else "Leads",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "من الإعلانات والاتصالات — اتصل بسرعة" else "From ads and calls — speed wins them",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                    )
                }
                Surface(onClick = onAdd, shape = CircleShape, color = Alpha.Ink) {
                    Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Filled.Add,
                            contentDescription = if (arabic) "إضافة عميل" else "Add lead",
                            tint = Color.White,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }

            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            ) {
                val filters = listOf(
                    "inbox" to if (arabic) "الوارد" else "Inbox",
                    "new" to stageLabel("new", arabic),
                    "contacted" to stageLabel("contacted", arabic),
                    "booked" to stageLabel("booked", arabic),
                    "won" to stageLabel("won", arabic),
                    "lost" to stageLabel("lost", arabic),
                )
                items(filters) { (key, label) ->
                    val selected = stageFilter == key
                    val count = when (key) {
                        "inbox" -> leads.count { it.stage != "won" && it.stage != "lost" }
                        else -> leads.count { it.stage == key }
                    }
                    Surface(
                        onClick = { stageFilter = key },
                        shape = Alpha.PillShape,
                        color = if (selected) Alpha.Ink else Alpha.Card,
                    ) {
                        Text(
                            "$label · $count",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (selected) Color.White else Alpha.Slate600,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                }
            }

            // Where they came from. Hidden entirely with one source or none — a row
            // of filters offering a single choice is furniture, not a control.
            if (sources.size > 1) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 8.dp),
                ) {
                    item {
                        SourceChip(
                            label = if (arabic) "كل المصادر" else "All sources",
                            selected = sourceFilter.isBlank(),
                        ) { sourceFilter = "" }
                    }
                    items(sources) { source ->
                        val count = leads.count { it.source.trim() == source }
                        SourceChip(
                            label = "$source · $count",
                            selected = sourceFilter == source,
                        ) {
                            // Tapping the chosen one again clears it, so getting back
                            // to everything does not mean hunting for "All sources".
                            sourceFilter = if (sourceFilter == source) "" else source
                        }
                    }
                }
            }

            when {
                loading && leads.isEmpty() -> Box(
                    Modifier.fillMaxSize().padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                }

                shown.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp)) {
                    // An empty list because of a filter is a different fact from an
                    // empty list because nobody has enquired, and only one of them
                    // is fixed by tapping something.
                    EmptyState(
                        when {
                            sourceFilter.isNotBlank() && arabic ->
                                "لا يوجد عملاء من \"$sourceFilter\" في هذا القسم."
                            sourceFilter.isNotBlank() ->
                                "No leads from \"$sourceFilter\" here. Tap the source again to see them all."
                            arabic -> "لا يوجد عملاء محتملون هنا."
                            else -> "Nothing here — new leads land in the inbox the moment they arrive."
                        }
                    )
                }

                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(shown, key = { it.id }) { lead ->
                        LeadCard(
                            lead = lead,
                            arabic = arabic,
                            dueToday = lead.followUpDate.isNotBlank() && lead.followUpDate <= today &&
                                lead.stage !in setOf("won", "lost"),
                            onCall = { context.dialLead(lead.phone) },
                            onWhatsapp = { context.whatsappLead(lead.phone) },
                            onStage = { stage ->
                                if (stage == "lost") losing = lead else onSetStage(lead, stage, null)
                            },
                            // Nothing to convert once it is won — the file exists.
                            onConvert = if (onConvert != null && lead.stage != "won") {
                                { onConvert(lead) }
                            } else null,
                            converting = convertingLeadId == lead.id,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LeadCard(
    lead: Lead,
    arabic: Boolean,
    dueToday: Boolean,
    onCall: () -> Unit,
    onWhatsapp: () -> Unit,
    onStage: (String) -> Unit,
    onConvert: (() -> Unit)?,
    converting: Boolean,
) {
    var expanded by remember { mutableStateOf(false) }

    AlphaCard(
        modifier = Modifier
            .fillMaxWidth()
            .clip(Alpha.CardShape)
            .clickable { expanded = !expanded },
        shape = Alpha.CardShape,
    ) {
        Column(Modifier.padding(13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SourceBadge(lead.source)
                Spacer(Modifier.width(11.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        lead.name.ifBlank { if (arabic) "بدون اسم" else "No name yet" },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        listOfNotNull(
                            lead.phone.takeIf { it.isNotBlank() },
                            prettyLeadDate(lead.createdAtMillis, arabic),
                        ).joinToString("  ·  "),
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    // Where it came from, and how long it has been sitting. The source
                    // was a coloured initial plus a word buried mid-sentence; the wait
                    // was not shown at all, though it is the thing that decides which
                    // lead to ring first.
                    Spacer(Modifier.height(4.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Said plainly when it is missing, rather than left blank —
                        // "no source recorded" is a fact about the lead, not a gap in
                        // the screen.
                        Surface(shape = Alpha.PillShape, color = Alpha.Slate100) {
                            Text(
                                lead.source.ifBlank { if (arabic) "مصدر غير مسجل" else "No source" },
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (lead.source.isBlank()) Alpha.Slate400 else Alpha.Slate700,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.5.dp),
                            )
                        }
                        waitingLabel(lead, arabic)?.let { waited ->
                            val stale = isStale(lead)
                            Surface(
                                shape = Alpha.PillShape,
                                color = if (stale) Alpha.WarnBg else Alpha.Slate100,
                            ) {
                                Text(
                                    waited,
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (stale) Alpha.WarnText else Alpha.Slate600,
                                    maxLines = 1,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.5.dp),
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                StagePill(lead.stage, arabic)
            }

            if (lead.interest.isNotBlank() || lead.existingPatientName.isNotBlank() || dueToday ||
                (lead.stage == "lost" && lead.lostReason.isNotBlank())
            ) {
                Spacer(Modifier.height(7.dp))
                Column {
                    if (lead.interest.isNotBlank()) {
                        Text(
                            (if (arabic) "يسأل عن: " else "Asking about: ") + lead.interest,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.Slate600,
                        )
                    }
                    if (lead.existingPatientName.isNotBlank()) {
                        Text(
                            if (arabic) "مريض معروف: ${lead.existingPatientName}"
                            else "Already a patient: ${lead.existingPatientName}",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.Green,
                        )
                    }
                    if (dueToday) {
                        Text(
                            if (arabic) "متابعة مستحقة اليوم" else "Follow-up due",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.WarnText,
                        )
                    }
                    // Whatever reception wrote down when they last spoke to this
                    // person. It is on the website's card and was simply absent here.
                    if (lead.notes.isNotBlank()) {
                        Text(
                            lead.notes,
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate500,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (lead.stage == "lost" && lead.lostReason.isNotBlank()) {
                        Text(
                            (if (arabic) "السبب: " else "Reason: ") + lead.lostReason,
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                        )
                    }
                }
            }

            if (lead.phone.isNotBlank()) {
                Spacer(Modifier.height(9.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ContactChip(
                        label = if (arabic) "اتصال" else "Call",
                        icon = Icons.Filled.Phone,
                        modifier = Modifier.weight(1f),
                        onClick = onCall,
                    )
                    ContactChip(
                        label = "WhatsApp",
                        icon = Icons.Filled.Chat,
                        modifier = Modifier.weight(1f),
                        onClick = onWhatsapp,
                    )
                }
            }

            // Winning a lead means a patient file exists, so this is the button that
            // does it rather than a pill that says it happened. Not offered once the
            // lead is won — the file is already there.
            if (onConvert != null) {
                Spacer(Modifier.height(8.dp))
                Surface(
                    onClick = { if (!converting) onConvert() },
                    enabled = !converting,
                    shape = Alpha.PillShape,
                    color = Alpha.Ink,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(vertical = 10.dp),
                    ) {
                        if (converting) {
                            CircularProgressIndicator(
                                color = Color.White,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(14.dp),
                            )
                        } else {
                            Icon(
                                Icons.Filled.PersonAdd,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (arabic) "تحويل إلى مريض" else "Add as a patient",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Color.White,
                        )
                    }
                }
            }

            if (expanded) {
                Spacer(Modifier.height(10.dp))
                Text(
                    if (arabic) "نقل إلى" else "MOVE TO",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate400,
                    letterSpacing = 1.2.sp,
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("new", "contacted", "booked", "lost").forEach { stage ->
                        val current = lead.stage == stage
                        Surface(
                            onClick = { if (!current) onStage(stage) },
                            enabled = !current,
                            shape = Alpha.PillShape,
                            color = if (current) Alpha.Ink else Alpha.Slate100,
                        ) {
                            Text(
                                stageLabel(stage, arabic),
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (current) Color.White else Alpha.Slate600,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    if (arabic) "تحويله لمريض يتم من الموقع — يُنشئ ملف المريض ويربطه."
                    else "Converting to a patient happens on the website — it creates and links the patient file.",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate400,
                )
            }
        }
    }
}

@Composable
private fun ContactChip(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(onClick = onClick, shape = Alpha.PillShape, color = Alpha.GreenSoft, modifier = modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier.padding(vertical = 7.dp),
        ) {
            Icon(icon, contentDescription = null, tint = Alpha.Green, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Alpha.Green)
        }
    }
}

/** The channel's colour and initial — sources are free text, so this fuzzy-matches. */
/** One source filter. Outlined rather than filled, so it sits under the stage
 *  pills as a refinement of them rather than as a second set of tabs. */
@Composable
private fun SourceChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.GreenSoft else Alpha.Card,
        border = BorderStroke(1.dp, if (selected) Alpha.Green else Alpha.Slate200),
    ) {
        Text(
            label,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Alpha.Green else Alpha.Slate600,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun SourceBadge(source: String) {
    val lower = source.lowercase()
    val (color, letter) = when {
        "facebook" in lower || "meta" in lower || "فيس" in lower -> Color(0xFF1877F2) to "f"
        "instagram" in lower || "انستا" in lower -> Color(0xFFE1306C) to "in"
        "whatsapp" in lower || "واتس" in lower -> Color(0xFF25D366) to "w"
        "google" in lower || "جوجل" in lower -> Color(0xFF4285F4) to "G"
        "tiktok" in lower || "تيك" in lower -> Color(0xFF010101) to "t"
        "phone" in lower || "call" in lower || "اتصال" in lower || "هاتف" in lower -> Color(0xFF0EA5E9) to "☎"
        "friend" in lower || "referral" in lower || "صديق" in lower || "ترشيح" in lower -> Color(0xFFF59E0B) to "★"
        else -> Color(0xFF64748B) to (source.trim().firstOrNull()?.uppercase() ?: "•")
    }
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(color.copy(alpha = .14f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = color)
    }
}

@Composable
private fun StagePill(stage: String, arabic: Boolean) {
    val (bg, fg) = when (stage) {
        "new" -> Alpha.GreenSoft to Alpha.Green
        "contacted" -> Color(0x220EA5E9) to Color(0xFF0EA5E9)
        "booked" -> Alpha.WarnBg to Alpha.WarnText
        "won" -> Alpha.GreenSoft to Alpha.Green
        "lost" -> Alpha.DangerSoft to Alpha.DangerText
        else -> Alpha.Slate100 to Alpha.Slate600
    }
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(
            stageLabel(stage, arabic),
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
        )
    }
}

private fun stageLabel(stage: String, arabic: Boolean): String = when (stage) {
    "new" -> if (arabic) "جديد" else "New"
    "contacted" -> if (arabic) "تم التواصل" else "Contacted"
    "booked" -> if (arabic) "حجز" else "Booked"
    "won" -> if (arabic) "تحوّل لمريض" else "Converted"
    "lost" -> if (arabic) "مفقود" else "Lost"
    else -> stage
}

/**
 * A lead typed in at the desk — the same five fields the website's add form asks for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddLeadSheet(
    saving: Boolean,
    arabic: Boolean,
    onSave: (name: String, phone: String, source: String, interest: String, notes: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var source by remember { mutableStateOf("Walk-in") }
    var interest by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }

    val sources = listOf("Walk-in", "Phone call", "WhatsApp", "Meta ads", "Google", "Instagram", "TikTok", "Friend referral")

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            Text(
                if (arabic) "عميل محتمل جديد" else "New lead",
                fontSize = 19.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Spacer(Modifier.height(14.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(if (arabic) "الاسم" else "Name") },
                singleLine = true,
                shape = Alpha.CardShape,
                colors = leadFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = phone,
                onValueChange = { phone = it },
                label = { Text(if (arabic) "الهاتف" else "Phone") },
                singleLine = true,
                shape = Alpha.CardShape,
                colors = leadFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(14.dp))
            SectionHeading(if (arabic) "المصدر" else "SOURCE")
            Spacer(Modifier.height(6.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(sources) { option ->
                    val selected = source == option
                    Surface(
                        onClick = { source = option },
                        shape = Alpha.PillShape,
                        color = if (selected) Alpha.Ink else Alpha.Slate50,
                    ) {
                        Text(
                            option,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (selected) Color.White else Alpha.Slate600,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = interest,
                onValueChange = { interest = it },
                label = { Text(if (arabic) "يسأل عن (اختياري)" else "Asking about (optional)") },
                singleLine = true,
                shape = Alpha.CardShape,
                colors = leadFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                label = { Text(if (arabic) "ملاحظات (اختياري)" else "Notes (optional)") },
                shape = Alpha.CardShape,
                colors = leadFieldColors(),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 3,
            )

            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { onSave(name.trim(), phone.trim(), source, interest.trim(), notes.trim()) },
                enabled = name.isNotBlank() && !saving,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(10.dp))
                }
                Text(if (arabic) "حفظ" else "Save lead", fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun leadFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)

@Composable
private fun LocalContextCompat(): Context = androidx.compose.ui.platform.LocalContext.current

private fun prettyLeadDate(millis: Long, arabic: Boolean): String? {
    if (millis <= 0) return null
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    // The year too: a lead from last March read as "12 Mar" and looked like this week.
    return SimpleDateFormat("d MMM yyyy", locale).format(Date(millis))
}

/**
 * How long this lead has been waiting for somebody to answer it.
 *
 * The single most useful thing on the card and the one it did not say. An advert
 * lead answered in minutes converts several times better than one answered
 * tomorrow, and a date alone makes the reader do that arithmetic themselves for
 * every row in the list.
 *
 * Stops counting once the lead is won or lost: those are finished, and "waiting
 * 40 days" on a patient who has been treated is noise dressed as an alarm.
 */
private fun waitingLabel(lead: Lead, arabic: Boolean, now: Long = System.currentTimeMillis()): String? {
    if (lead.createdAtMillis <= 0) return null
    if (lead.stage == "won" || lead.stage == "lost") return null

    val minutes = ((now - lead.createdAtMillis) / 60_000L).coerceAtLeast(0)
    return when {
        minutes < 60 && arabic -> "في الانتظار منذ $minutes دقيقة"
        minutes < 60 -> "waiting ${minutes}m"
        minutes < 60 * 24 && arabic -> "في الانتظار منذ ${minutes / 60} ساعة"
        minutes < 60 * 24 -> "waiting ${minutes / 60}h"
        arabic -> "في الانتظار منذ ${minutes / (60 * 24)} يوم"
        else -> "waiting ${minutes / (60 * 24)}d"
    }
}

/** Past this, a lead nobody has answered is a problem rather than a queue. */
private fun isStale(lead: Lead, now: Long = System.currentTimeMillis()): Boolean {
    if (lead.createdAtMillis <= 0) return false
    if (lead.stage == "won" || lead.stage == "lost") return false
    if (lead.hasFirstContact) return false
    return now - lead.createdAtMillis > 24L * 60 * 60 * 1000
}

private fun Context.dialLead(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.trim()}"))) }
}

private fun Context.whatsappLead(phone: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))) }
}
