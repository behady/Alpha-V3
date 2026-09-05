package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.data.LabCases.LabCase
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Lab Tracking — where every case is, right now — on the phone.
 *
 * The website raises the orders, prints them and settles the lab's bill. The phone does what
 * happens away from the desk: a driver arrives with a bag and someone marks it back; a crown is
 * fitted chairside and the dentist closes the case from the surgery. So this is a board and a
 * stage button, not an order form.
 *
 * Three counts sit at the top, and the third is the one worth having. Overdue and due-this-week
 * are obvious. "Back and waiting" is the pile nobody measures — finished work sitting in a
 * drawer because nobody called the patient — and it is money already spent. Marking a case back
 * therefore ends with the patient's number on a button.
 */
@Composable
fun LabScreen(
    cases: List<LabCase>,
    loaded: Boolean,
    error: String?,
    openCaseId: String,
    busyId: String,
    arrived: LabCase?,
    arabic: Boolean,
    onOpenCase: (String) -> Unit,
    onCloseCase: () -> Unit,
    onAdvance: (LabCase, String) -> Unit,
    onDismissArrived: () -> Unit,
    /** Null for roles that may not open a patient's file. */
    onOpenPatient: ((String) -> Unit)?,
    onRetry: () -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }
    val today = AppViewModel.today()

    var filter by rememberSaveable { mutableStateOf("open") }
    var labFilter by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }

    val summary = LabCases.summarise(cases, today)
    val labs = cases.mapNotNull { it.labName.trim().takeIf(String::isNotBlank) }
        .groupingBy { it }.eachCount().entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .map { it.key }

    val q = search.trim()
    val shown = cases.filter { c ->
        if (labFilter.isNotBlank() && c.labName.trim() != labFilter) return@filter false
        val keep = when (filter) {
            "open" -> !c.meta.closed
            "out" -> c.meta.atLab
            "overdue" -> LabCases.dueStateFor(c, today) == LabCases.Due.OVERDUE
            "week" -> LabCases.dueStateFor(c, today).let { state ->
                state == LabCases.Due.DUE_TODAY || state == LabCases.Due.DUE_SOON ||
                    (state == LabCases.Due.ON_TIME && (LabCases.daysUntil(c.dueDate, today) ?: 99) <= 7)
            }
            "all" -> true
            else -> c.status == filter
        }
        if (!keep) return@filter false
        if (q.isBlank()) return@filter true
        if (LabCases.matchesCode(c.code, q)) return@filter true
        val hay = listOf(c.patientName, c.patientPhone, c.labName, c.doctorName, c.workDescription).joinToString(" ").lowercase()
        q.lowercase().split(Regex("\\s+")).all { hay.contains(it) }
    }

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
                        if (arabic) "متابعة المعمل" else "Lab Tracking",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "${summary.atLab} حالة في المعامل الآن" else "${summary.atLab} case${if (summary.atLab == 1) "" else "s"} out at labs right now",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
            }

            // The three numbers, each a filter. Tapping a count that says 3 must show 3 rows.
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                CountTile(
                    summary.overdue, if (arabic) "متأخرة" else "Overdue",
                    tint = if (summary.overdue > 0) Alpha.DangerText else Alpha.Slate900,
                    selected = filter == "overdue", modifier = Modifier.weight(1f),
                ) { filter = if (filter == "overdue") "open" else "overdue" }
                CountTile(
                    summary.dueThisWeek, if (arabic) "خلال أسبوع" else "Due this week",
                    tint = if (summary.dueThisWeek > 0) Alpha.WarnText else Alpha.Slate900,
                    selected = filter == "week", modifier = Modifier.weight(1f),
                ) { filter = if (filter == "week") "open" else "week" }
                CountTile(
                    summary.waitingForPatient, if (arabic) "وصلت وتنتظر" else "Back & waiting",
                    tint = if (summary.waitingForPatient > 0) Alpha.Green else Alpha.Slate900,
                    selected = filter == "back", modifier = Modifier.weight(1f),
                ) { filter = if (filter == "back") "open" else "back" }
            }

            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                singleLine = true,
                placeholder = { Text(if (arabic) "رقم الحالة، اسم المريض، المعمل" else "Case number, patient, lab", color = Alpha.Slate400) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Alpha.Slate400) },
                colors = labFieldColors(),
                shape = Alpha.CardShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            ) {
                Chip(if (arabic) "المفتوحة" else "Open", filter == "open") { filter = "open" }
                Chip(if (arabic) "في المعمل" else "At lab", filter == "out") { filter = "out" }
                Chip(if (arabic) "وصلت" else "Back", filter == "back") { filter = "back" }
                Chip(if (arabic) "تم التركيب" else "Fitted", filter == "fitted") { filter = "fitted" }
                Chip(if (arabic) "الكل" else "All", filter == "all") { filter = "all" }
            }
            if (labs.size > 1) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(start = 16.dp, end = 16.dp, bottom = 6.dp),
                ) {
                    labs.forEach { lab ->
                        Chip(lab, labFilter == lab, soft = true) { labFilter = if (labFilter == lab) "" else lab }
                    }
                }
            }

            error?.let {
                LoadErrorBanner(it, arabic, onRetry, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp))
            }

            when {
                !loaded && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Alpha.Ink)
                }
                shown.isEmpty() -> Box(Modifier.fillMaxSize().padding(16.dp)) {
                    EmptyState(
                        when {
                            error != null -> ""
                            q.isNotBlank() -> if (arabic) "لا توجد حالة بهذا الرقم أو الاسم." else "No case matches that number or name."
                            filter == "overdue" -> if (arabic) "لا شيء متأخر." else "Nothing is overdue."
                            filter == "back" -> if (arabic) "لا توجد حالات تنتظر مريضاً." else "Nothing is waiting on a patient."
                            cases.isEmpty() -> if (arabic) "لا توجد حالات معمل بعد. تُفتح الطلبات من الموقع." else "No lab cases yet. Orders are raised on the website."
                            else -> if (arabic) "لا توجد حالات هنا." else "Nothing here."
                        }
                    )
                }
                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(shown, key = { it.id }) { case ->
                        CaseRow(case, today, arabic) { onOpenCase(case.id) }
                    }
                }
            }
        }
    }

    cases.firstOrNull { it.id == openCaseId }?.let { case ->
        CaseSheet(
            case = case,
            today = today,
            busy = busyId == case.id,
            arabic = arabic,
            onAdvance = { next -> onAdvance(case, next) },
            onOpenPatient = onOpenPatient,
            onDismiss = onCloseCase,
        )
    }

    arrived?.let { case ->
        ArrivedSheet(case, arabic, onOpenPatient, onDismissArrived)
    }
}

// ---------------------------------------------------------------------------------------------
// Board pieces
// ---------------------------------------------------------------------------------------------

@Composable
private fun CountTile(count: Int, caption: String, tint: Color, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.CardShape,
        color = if (selected) Alpha.Ink else Alpha.Card,
        border = if (selected || Alpha.dark) null else BorderStroke(1.dp, Alpha.Slate200),
        modifier = modifier,
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(
                count.toString(),
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = AlphaType.Display,
                color = if (selected) Color.White else tint,
            )
            Text(
                caption,
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                color = if (selected) Color.White.copy(alpha = .8f) else Alpha.Slate500,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, soft: Boolean = false, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = when {
            selected && soft -> Alpha.GreenSoft
            selected -> Alpha.Ink
            else -> Alpha.Card
        },
        border = if (selected) null else BorderStroke(1.dp, Alpha.Slate200),
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = when {
                selected && soft -> Alpha.Green
                selected -> Color.White
                else -> Alpha.Slate700
            },
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun CaseRow(case: LabCase, today: String, arabic: Boolean, onClick: () -> Unit) {
    val due = LabCases.dueStateFor(case, today)
    AlphaCard(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    case.code.ifBlank { "—" },
                    fontSize = 15.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                )
                if (case.remakeRound > 1) {
                    Spacer(Modifier.width(6.dp))
                    Tag(if (arabic) "إعادة" else "Remake", Alpha.WarnBg, Alpha.WarnText)
                }
                Spacer(Modifier.weight(1f))
                StatusTag(case.status, arabic)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                case.patientName.ifBlank { if (arabic) "بدون مريض" else "No patient attached" },
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = if (case.patientName.isBlank()) Alpha.Slate400 else Alpha.Slate800,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                buildString {
                    append(LabCases.workTypeLabel(case.workType, arabic))
                    if (case.teeth.isNotEmpty()) append(" · ").append(case.teeth.joinToString(", "))
                    if (case.labName.isNotBlank()) append(" · ").append(case.labName)
                },
                fontSize = 12.5.sp,
                color = Alpha.Slate500,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val dueLine = dueLabel(case, due, today, arabic)
            if (dueLine != null) {
                Spacer(Modifier.height(6.dp))
                Tag(
                    dueLine,
                    when (due) {
                        LabCases.Due.OVERDUE -> Alpha.DangerSoft
                        LabCases.Due.DUE_TODAY, LabCases.Due.DUE_SOON -> Alpha.WarnBg
                        else -> Alpha.Slate100
                    },
                    when (due) {
                        LabCases.Due.OVERDUE -> Alpha.DangerText
                        LabCases.Due.DUE_TODAY, LabCases.Due.DUE_SOON -> Alpha.WarnText
                        else -> Alpha.Slate600
                    },
                )
            }
        }
    }
}

/** The due pill's words. Nothing for a case that is not at a lab; a plain date when it is on time. */
private fun dueLabel(case: LabCase, due: LabCases.Due, today: String, arabic: Boolean): String? {
    if (due == LabCases.Due.NONE) return null
    val days = LabCases.daysUntil(case.dueDate, today) ?: return null
    return when (due) {
        LabCases.Due.OVERDUE -> if (arabic) "متأخرة ${-days} يوم" else "Overdue ${-days}d"
        LabCases.Due.DUE_TODAY -> if (arabic) "النهارده" else "Due today"
        LabCases.Due.DUE_SOON -> if (arabic) "باقي $days يوم" else "Due in ${days}d"
        else -> (if (arabic) "الاستلام " else "Due ") + prettyDate(case.dueDate, arabic)
    }
}

@Composable
private fun StatusTag(status: String, arabic: Boolean) {
    val (bg, fg) = when (status) {
        "at_lab", "returned_to_lab" -> Alpha.Slate100 to Alpha.Slate700
        "tryin_back" -> Alpha.WarnBg to Alpha.WarnText
        "back" -> Alpha.GreenSoft to Alpha.Green
        "fitted" -> Alpha.Ink to Color.White
        "cancelled" -> Alpha.DangerSoft to Alpha.DangerText
        else -> Alpha.Slate50 to Alpha.Slate500
    }
    Tag(LabCases.statusLabel(status, arabic), bg, fg)
}

@Composable
private fun Tag(label: String, bg: Color, fg: Color) {
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(
            label,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

// ---------------------------------------------------------------------------------------------
// One case
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CaseSheet(
    case: LabCase,
    today: String,
    busy: Boolean,
    arabic: Boolean,
    onAdvance: (String) -> Unit,
    onOpenPatient: ((String) -> Unit)?,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val due = LabCases.dueStateFor(case, today)
    val next = LabCases.nextStatuses(case.status, case.needsTryIn)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        case.code.ifBlank { "—" },
                        fontSize = 26.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = AlphaType.Display,
                        color = Alpha.Slate900,
                    )
                    if (case.remakeOfCode.isNotBlank()) {
                        Text(
                            if (arabic) "إعادة للحالة ${case.remakeOfCode}" else "Remake of ${case.remakeOfCode}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.WarnText,
                        )
                    }
                }
                StatusTag(case.status, arabic)
            }

            Spacer(Modifier.height(12.dp))

            // Who and what.
            Text(
                case.patientName.ifBlank { if (arabic) "بدون مريض" else "No patient attached" },
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = if (case.patientName.isBlank()) Alpha.Slate400 else Alpha.Slate900,
            )
            if (case.doctorName.isNotBlank()) {
                Text(case.doctorName, fontSize = 13.sp, color = Alpha.Slate500)
            }

            Spacer(Modifier.height(12.dp))
            Detail(if (arabic) "العمل" else "Work", LabCases.workTypeLabel(case.workType, arabic) + if (case.units > 0) " × ${case.units}" else "")
            if (case.workDescription.isNotBlank()) Detail(if (arabic) "الوصف" else "Description", case.workDescription)
            if (case.teeth.isNotEmpty()) Detail(if (arabic) "الأسنان" else "Teeth", case.teeth.joinToString(", "))
            val shades = listOfNotNull(
                case.bodyShade.takeIf { it.isNotBlank() }?.let { (if (arabic) "الجسم " else "Body ") + it },
                case.cervicalShade.takeIf { it.isNotBlank() }?.let { (if (arabic) "الرقبة " else "Cervical ") + it },
                case.gumShade.takeIf { it.isNotBlank() }?.let { (if (arabic) "اللثة " else "Gum ") + it },
            )
            if (shades.isNotEmpty()) Detail(if (arabic) "الدرجات" else "Shades", shades.joinToString(" · "))
            if (case.material.isNotBlank()) Detail(if (arabic) "الخامة" else "Material", case.material)
            if (case.implantSystem.isNotBlank()) Detail(if (arabic) "نظام الزرعة" else "Implant system", case.implantSystem)
            Detail(if (arabic) "المعمل" else "Lab", case.labName.ifBlank { "—" } + if (case.sentVia == "digital") (if (arabic) " · ملفات رقمية" else " · sent as files") else "")
            if (case.branchName.isNotBlank()) Detail(if (arabic) "الفرع" else "Branch", case.branchName)
            if (case.agreedPrice > 0) Detail(if (arabic) "السعر المتفق عليه" else "Agreed price", "${case.agreedPrice.toInt()} ${if (arabic) "ج.م" else "EGP"}")
            if (case.notes.isNotBlank()) Detail(if (arabic) "ملاحظات" else "Notes", case.notes)

            // Dates, with the due date coloured by how worried to be.
            Spacer(Modifier.height(6.dp))
            if (case.sentAt.isNotBlank()) Detail(if (arabic) "أُرسلت" else "Sent", prettyDate(case.sentAt, arabic))
            if (case.dueDate.isNotBlank()) {
                Detail(
                    if (arabic) "موعد الاستلام" else "Due back",
                    prettyDate(case.dueDate, arabic) + (dueLabel(case, due, today, arabic)?.takeIf { due != LabCases.Due.ON_TIME }?.let { " · $it" } ?: ""),
                    tint = when (due) {
                        LabCases.Due.OVERDUE -> Alpha.DangerText
                        LabCases.Due.DUE_TODAY, LabCases.Due.DUE_SOON -> Alpha.WarnText
                        else -> Alpha.Slate900
                    },
                )
            }
            if (case.receivedAt.isNotBlank()) Detail(if (arabic) "وصلت" else "Received", prettyDate(case.receivedAt, arabic))
            if (case.fittedAt.isNotBlank()) Detail(if (arabic) "رُكّبت" else "Fitted", prettyDate(case.fittedAt, arabic))

            // Reach the patient.
            if (case.patientPhone.isNotBlank() || (case.patientId.isNotBlank() && onOpenPatient != null)) {
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (case.patientPhone.isNotBlank()) {
                        OutlinedButton(onClick = { context.dial(case.patientPhone) }, shape = Alpha.PillShape) {
                            Icon(Icons.Filled.Phone, contentDescription = null, modifier = Modifier.size(16.dp), tint = Alpha.Slate900)
                            Spacer(Modifier.width(6.dp))
                            Text(if (arabic) "اتصال" else "Call", color = Alpha.Slate900, fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(onClick = { context.whatsapp(case.patientPhone) }, shape = Alpha.PillShape) {
                            Icon(Icons.Filled.Chat, contentDescription = null, modifier = Modifier.size(16.dp), tint = Alpha.Green)
                            Spacer(Modifier.width(6.dp))
                            Text("WhatsApp", color = Alpha.Green, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (case.patientId.isNotBlank() && onOpenPatient != null) {
                        OutlinedButton(onClick = { onOpenPatient(case.patientId) }, shape = Alpha.PillShape) {
                            Icon(Icons.Filled.Folder, contentDescription = null, modifier = Modifier.size(16.dp), tint = Alpha.Slate900)
                            Spacer(Modifier.width(6.dp))
                            Text(if (arabic) "الملف" else "File", color = Alpha.Slate900, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // The stage buttons: the reason the sheet exists on a phone.
            if (next.isNotEmpty()) {
                Spacer(Modifier.height(18.dp))
                SectionHeading(if (arabic) "نقل الحالة إلى" else "MOVE TO")
                Spacer(Modifier.height(8.dp))
                next.forEach { stage ->
                    val primary = stage in setOf("back", "fitted", "at_lab")
                    val danger = stage == "cancelled"
                    Button(
                        onClick = { onAdvance(stage) },
                        enabled = !busy,
                        shape = Alpha.PillShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = when {
                                danger -> Alpha.DangerSoft
                                primary -> Alpha.Ink
                                else -> Alpha.Slate100
                            },
                            contentColor = when {
                                danger -> Alpha.DangerText
                                primary -> Color.White
                                else -> Alpha.Slate900
                            },
                        ),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    ) {
                        if (busy) {
                            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp), color = Alpha.Slate500)
                        } else {
                            Text(LabCases.statusLabel(stage, arabic), fontWeight = FontWeight.ExtraBold)
                        }
                    }
                }
            }

            // The trail: every stage the case has been through, dated.
            if (case.events.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                SectionHeading(if (arabic) "السجل" else "HISTORY")
                Spacer(Modifier.height(6.dp))
                case.events.asReversed().forEach { e ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(Alpha.Slate300))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(LabCases.statusLabel(e.status, arabic), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate800)
                            Text(
                                listOfNotNull(prettyStamp(e.at, arabic), e.by.takeIf { it.isNotBlank() }).joinToString(" · "),
                                fontSize = 11.5.sp,
                                color = Alpha.Slate500,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Detail(label: String, value: String, tint: Color = Alpha.Slate900) {
    Row(modifier = Modifier.padding(vertical = 3.dp)) {
        Text(label, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Alpha.Slate500, modifier = Modifier.width(120.dp))
        Text(value, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = tint, modifier = Modifier.weight(1f))
    }
}

/**
 * The prompt after marking a case back: the person who tapped is holding the case, and the
 * patient's number is one tap away. "Back and waiting" is the pile this exists to prevent.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArrivedSheet(case: LabCase, arabic: Boolean, onOpenPatient: ((String) -> Unit)?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Alpha.Card) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(44.dp).clip(CircleShape).background(Alpha.GreenSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Inbox, contentDescription = null, tint = Alpha.Green)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        "${case.code} ${if (arabic) "وصلت" else "is back"}",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = AlphaType.Display,
                        color = Alpha.Slate900,
                    )
                    Text(
                        when {
                            case.patientName.isNotBlank() && arabic -> "كلّم ${case.patientName} واحجزله ميعاد التركيب."
                            case.patientName.isNotBlank() -> "Call ${case.patientName} and book the fitting."
                            arabic -> "الحالة دي مش مربوطة بمريض، فمفيش حد نكلّمه."
                            else -> "This case has no patient attached, so there is nobody to call."
                        },
                        fontSize = 13.sp,
                        color = Alpha.Slate600,
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (case.patientPhone.isNotBlank()) {
                    Button(
                        onClick = { onDismiss(); context.dial(case.patientPhone) },
                        shape = Alpha.PillShape,
                        colors = ButtonDefaults.buttonColors(containerColor = Alpha.Green, contentColor = Color.White),
                    ) {
                        Icon(Icons.Filled.Phone, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (arabic) "اتصل" else "Call", fontWeight = FontWeight.ExtraBold)
                    }
                }
                if (case.patientId.isNotBlank() && onOpenPatient != null) {
                    OutlinedButton(onClick = { onDismiss(); onOpenPatient(case.patientId) }, shape = Alpha.PillShape) {
                        Text(if (arabic) "افتح الملف" else "Open the patient", color = Alpha.Slate900, fontWeight = FontWeight.Bold)
                    }
                }
                TextButton(onClick = onDismiss) {
                    Text(if (arabic) "بعدين" else "Later", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Words and dates
// ---------------------------------------------------------------------------------------------

@Composable
private fun labFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    cursorColor = Alpha.Ink,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = Alpha.Card,
    focusedTextColor = Alpha.Slate900,
    unfocusedTextColor = Alpha.Slate900,
)

private fun prettyDate(ymd: String, arabic: Boolean): String = runCatching {
    val date = SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH).parse(ymd) ?: return ymd
    SimpleDateFormat("EEE d MMM", if (arabic) Locale.forLanguageTag("ar") else Locale.ENGLISH).format(date)
}.getOrDefault(ymd)

private fun prettyStamp(iso: String, arabic: Boolean): String? = runCatching {
    val millis = java.time.Instant.parse(iso).toEpochMilli()
    SimpleDateFormat("d MMM, h:mm a", if (arabic) Locale.forLanguageTag("ar") else Locale.ENGLISH).format(java.util.Date(millis))
}.getOrNull()

private fun Context.dial(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }
}

private fun Context.whatsapp(phone: String) {
    val digits = phone.filter { it.isDigit() }
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))) }
}
