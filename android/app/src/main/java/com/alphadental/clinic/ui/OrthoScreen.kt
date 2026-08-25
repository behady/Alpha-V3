package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
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
import com.alphadental.clinic.data.CEPH_FIELDS
import com.alphadental.clinic.data.OrthoCase
import com.alphadental.clinic.data.OrthoVisit
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Orthodontic cases, as a full page.
 *
 * It was a pop-up that could log a visit and change a status and nothing else —
 * a case could not be opened, a diagnosis could not be written, and a visit
 * typed in wrong stayed wrong. This is the whole file: a searchable list of
 * cases by stage, opening into a case with an editable header, its
 * cephalometric readings, and a visit timeline that can be added to, corrected
 * and pruned.
 */
@Composable
fun OrthoScreen(
    cases: List<OrthoCase>,
    openCase: OrthoCase?,
    loading: Boolean,
    saving: Boolean,
    canEdit: Boolean,
    arabic: Boolean,
    onOpenCase: (OrthoCase?) -> Unit,
    onLogVisit: (OrthoCase, String, String) -> Unit,
    onReviseVisit: (OrthoCase, Int, OrthoVisit?) -> Unit,
    onSaveDetails: (OrthoCase, String, Map<String, String>) -> Unit,
    onSetStatus: (OrthoCase, String) -> Unit,
    onOpenPatient: (String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { if (openCase != null) onOpenCase(null) else onClose() }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            if (openCase == null) {
                CaseList(cases, loading, arabic, onOpenCase, onClose)
            } else {
                CaseDetail(
                    case = cases.firstOrNull { it.patientId == openCase.patientId } ?: openCase,
                    saving = saving,
                    canEdit = canEdit,
                    arabic = arabic,
                    onBack = { onOpenCase(null) },
                    onLogVisit = onLogVisit,
                    onReviseVisit = onReviseVisit,
                    onSaveDetails = onSaveDetails,
                    onSetStatus = onSetStatus,
                    onOpenPatient = onOpenPatient,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

@Composable
private fun CaseList(
    cases: List<OrthoCase>,
    loading: Boolean,
    arabic: Boolean,
    onOpenCase: (OrthoCase) -> Unit,
    onClose: () -> Unit,
) {
    var stage by rememberSaveable { mutableStateOf("Active") }
    var query by rememberSaveable { mutableStateOf("") }

    val shown = cases
        .filter { stage == "All" || it.status == stage }
        .filter { query.isBlank() || it.patientName.contains(query.trim(), ignoreCase = true) }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp),
    ) {
        IconButton(onClick = onClose) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
        }
        Column(Modifier.weight(1f)) {
            Text(
                if (arabic) "حالات التقويم" else "Ortho cases",
                fontSize = 19.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
                fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
            )
            Text(
                if (arabic) "المتابعة والتعديلات" else "Follow-ups and adjustments",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }

    Column(Modifier.padding(horizontal = 16.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = {
                Text(if (arabic) "ابحث باسم المريض" else "Search by patient name", color = Alpha.Slate400, fontSize = 13.sp)
            },
            singleLine = true,
            leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400, modifier = Modifier.size(18.dp)) },
            shape = Alpha.PillShape,
            colors = orthoFieldColors(pill = true),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val stages = listOf(
                "Active" to (if (arabic) "نشطة" else "Active"),
                "Retention" to (if (arabic) "تثبيت" else "Retention"),
                "Completed" to (if (arabic) "منتهية" else "Completed"),
                "All" to (if (arabic) "الكل" else "All"),
            )
            items(stages) { (key, label) ->
                val selected = stage == key
                val count = if (key == "All") cases.size else cases.count { it.status == key }
                Surface(
                    onClick = { stage = key },
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
        Spacer(Modifier.height(8.dp))
    }

    when {
        loading && cases.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
        }

        shown.isEmpty() -> Box(Modifier.fillMaxSize().padding(24.dp)) {
            EmptyState(
                if (arabic) "لا توجد حالات هنا. تُفتح الحالة من ملف المريض."
                else "No cases here. A case is opened from the patient's own file.",
            )
        }

        else -> LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(shown, key = { it.patientId }) { case ->
                AlphaCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(Alpha.CardShape)
                        .clickable { onOpenCase(case) },
                    shape = Alpha.CardShape,
                ) {
                    Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(Alpha.GreenSoft),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                case.patientName.trim().firstOrNull()?.uppercase() ?: "•",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Green,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                case.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate900,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(
                                    if (case.visits.isEmpty()) {
                                        if (arabic) "لا زيارات" else "no visits yet"
                                    } else {
                                        if (arabic) "${case.visits.size} زيارة" else "${case.visits.size} visits"
                                    },
                                    case.visits.maxByOrNull { it.visitNo }?.date?.takeIf { it.isNotBlank() }
                                        ?.let { prettyDay(it, arabic) },
                                ).joinToString("  ·  "),
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Medium,
                                color = Alpha.Slate500,
                            )
                        }
                        StatusChip(case.status, arabic)
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One case
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CaseDetail(
    case: OrthoCase,
    saving: Boolean,
    canEdit: Boolean,
    arabic: Boolean,
    onBack: () -> Unit,
    onLogVisit: (OrthoCase, String, String) -> Unit,
    onReviseVisit: (OrthoCase, Int, OrthoVisit?) -> Unit,
    onSaveDetails: (OrthoCase, String, Map<String, String>) -> Unit,
    onSetStatus: (OrthoCase, String) -> Unit,
    onOpenPatient: (String) -> Unit,
) {
    var editingHeader by remember(case.patientId) { mutableStateOf(false) }
    var logging by remember(case.patientId) { mutableStateOf(false) }
    var editingVisit by remember(case.patientId) { mutableStateOf<OrthoVisit?>(null) }
    var deleting by remember(case.patientId) { mutableStateOf<OrthoVisit?>(null) }

    if (logging) {
        VisitSheet(
            existing = null,
            saving = saving,
            arabic = arabic,
            onSave = { workDone, nextStep ->
                onLogVisit(case, workDone, nextStep)
                logging = false
            },
            onDismiss = { logging = false },
        )
    }

    editingVisit?.let { visit ->
        VisitSheet(
            existing = visit,
            saving = saving,
            arabic = arabic,
            onSave = { workDone, nextStep ->
                onReviseVisit(case, visit.visitNo, visit.copy(workDone = workDone, nextStep = nextStep))
                editingVisit = null
            },
            onDismiss = { editingVisit = null },
        )
    }

    deleting?.let { visit ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = Alpha.Card,
            title = {
                Text(
                    if (arabic) "حذف الزيارة ${visit.visitNo}؟" else "Delete visit ${visit.visitNo}?",
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate900,
                )
            },
            text = {
                Text(
                    visit.workDone.ifBlank { if (arabic) "بدون وصف" else "No description" },
                    color = Alpha.Slate600,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onReviseVisit(case, visit.visitNo, null)
                    deleting = null
                }) {
                    Text(if (arabic) "حذف" else "Delete", color = Alpha.Danger, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleting = null }) {
                    Text(if (arabic) "إلغاء" else "Cancel", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            },
        )
    }

    if (editingHeader) {
        DetailsSheet(
            case = case,
            saving = saving,
            arabic = arabic,
            onSave = { diagnosis, ceph ->
                onSaveDetails(case, diagnosis, ceph)
                editingHeader = false
            },
            onDismiss = { editingHeader = false },
        )
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(start = 4.dp, end = 12.dp, top = 6.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
        }
        Column(Modifier.weight(1f)) {
            Text(
                case.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOfNotNull(
                    case.startDate.takeIf { it.isNotBlank() }
                        ?.let { (if (arabic) "بدأت " else "started ") + prettyDay(it, arabic) },
                    case.completedDate.takeIf { it.isNotBlank() }
                        ?.let { (if (arabic) "انتهت " else "finished ") + prettyDay(it, arabic) },
                ).joinToString("  ·  "),
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
        StatusChip(case.status, arabic)
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 28.dp),
    ) {
        // Diagnosis and ceph, with one pencil for both.
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionHeading(if (arabic) "التشخيص والقياسات" else "DIAGNOSIS & MEASUREMENTS", Modifier.weight(1f))
            if (canEdit) {
                IconButton(onClick = { editingHeader = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.Edit, contentDescription = "Edit", tint = Alpha.Green, modifier = Modifier.size(17.dp))
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
            Column(Modifier.padding(14.dp)) {
                Text(
                    case.diagnosis.ifBlank {
                        if (arabic) "لم يُكتب تشخيص بعد." else "No diagnosis written yet."
                    },
                    fontSize = 13.5.sp,
                    fontWeight = if (case.diagnosis.isBlank()) FontWeight.Medium else FontWeight.SemiBold,
                    color = if (case.diagnosis.isBlank()) Alpha.Slate400 else Alpha.Slate800,
                )
                val filled = CEPH_FIELDS.filter { (id, _) -> !case.cephData[id].isNullOrBlank() }
                if (filled.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        filled.forEach { (id, label) ->
                            Surface(shape = Alpha.PillShape, color = Alpha.Slate50) {
                                Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp)) {
                                    Text(
                                        label.substringBefore(" ("),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Alpha.Slate500,
                                    )
                                    Spacer(Modifier.width(5.dp))
                                    Text(
                                        case.cephData[id].orEmpty(),
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate800,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // The timeline.
        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionHeading(
                if (arabic) "الزيارات (${case.visits.size})" else "VISITS (${case.visits.size})",
                Modifier.weight(1f),
            )
            if (canEdit) {
                Surface(onClick = { logging = true }, shape = Alpha.PillShape, color = Alpha.GreenSoft) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                    ) {
                        Icon(Icons.Filled.Add, null, tint = Alpha.Green, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(5.dp))
                        Text(
                            if (arabic) "تسجيل زيارة" else "Log a visit",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Green,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        if (case.visits.isEmpty()) {
            EmptyState(if (arabic) "لا توجد زيارات بعد." else "No visits logged yet.")
        } else {
            case.visits.sortedByDescending { it.visitNo }.forEach { visit ->
                AlphaCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    shape = Alpha.CardShape,
                ) {
                    Row(Modifier.padding(start = 13.dp, end = 4.dp, top = 12.dp, bottom = 12.dp)) {
                        Box(
                            modifier = Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                .background(Alpha.Slate100),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "${visit.visitNo}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate600,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                visit.workDone.ifBlank { "—" },
                                fontSize = 13.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Alpha.Slate800,
                            )
                            val detail = listOfNotNull(
                                visit.date.takeIf { it.isNotBlank() }?.let { prettyDay(it, arabic) },
                                visit.nextStep.takeIf { it.isNotBlank() }
                                    ?.let { (if (arabic) "التالي: " else "next: ") + it },
                            ).joinToString("  ·  ")
                            if (detail.isNotBlank()) {
                                Spacer(Modifier.height(2.dp))
                                Text(detail, fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
                            }
                        }
                        if (canEdit) {
                            IconButton(onClick = { editingVisit = visit }, modifier = Modifier.size(34.dp)) {
                                Icon(Icons.Filled.Edit, contentDescription = "Edit", tint = Alpha.Slate400, modifier = Modifier.size(16.dp))
                            }
                            IconButton(onClick = { deleting = visit }, modifier = Modifier.size(34.dp)) {
                                Icon(Icons.Filled.DeleteOutline, contentDescription = "Delete", tint = Alpha.Slate300, modifier = Modifier.size(17.dp))
                            }
                        }
                    }
                }
            }
        }

        // Stage, and the way into the patient's file.
        if (canEdit) {
            Spacer(Modifier.height(14.dp))
            SectionHeading(if (arabic) "حالة العلاج" else "TREATMENT STAGE")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                listOf(
                    "Active" to (if (arabic) "نشطة" else "Active"),
                    "Retention" to (if (arabic) "تثبيت" else "Retention"),
                    "Completed" to (if (arabic) "منتهية" else "Completed"),
                ).forEach { (key, label) ->
                    val current = case.status == key
                    Surface(
                        onClick = { if (!current) onSetStatus(case, key) },
                        enabled = !current && !saving,
                        shape = Alpha.PillShape,
                        color = if (current) Alpha.Ink else Alpha.Slate100,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(
                            label,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (current) Color.White else Alpha.Slate600,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            modifier = Modifier.padding(vertical = 9.dp),
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(14.dp))
        TextButton(onClick = { onOpenPatient(case.patientId) }) {
            Text(
                if (arabic) "فتح ملف المريض" else "Open the patient file",
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Green,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

/** Log a new adjustment, or correct one already logged. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VisitSheet(
    existing: OrthoVisit?,
    saving: Boolean,
    arabic: Boolean,
    onSave: (workDone: String, nextStep: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var workDone by remember { mutableStateOf(existing?.workDone.orEmpty()) }
    var nextStep by remember { mutableStateOf(existing?.nextStep.orEmpty()) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            Text(
                when {
                    existing != null && arabic -> "تعديل الزيارة ${existing.visitNo}"
                    existing != null -> "Edit visit ${existing.visitNo}"
                    arabic -> "تسجيل زيارة"
                    else -> "Log a visit"
                },
                fontSize = 19.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Spacer(Modifier.height(14.dp))

            OutlinedTextField(
                value = workDone,
                onValueChange = { workDone = it },
                label = { Text(if (arabic) "ما تم عمله" else "What was done") },
                shape = Alpha.CardShape,
                colors = orthoFieldColors(),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 3,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = nextStep,
                onValueChange = { nextStep = it },
                label = { Text(if (arabic) "الخطوة التالية" else "Next step") },
                shape = Alpha.CardShape,
                colors = orthoFieldColors(),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 3,
            )

            Spacer(Modifier.height(18.dp))
            Button(
                onClick = { onSave(workDone.trim(), nextStep.trim()) },
                enabled = workDone.isNotBlank() && !saving,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                }
                Text(if (arabic) "حفظ" else "Save", fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** The case header: diagnosis and the eight cephalometric readings. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailsSheet(
    case: OrthoCase,
    saving: Boolean,
    arabic: Boolean,
    onSave: (diagnosis: String, ceph: Map<String, String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var diagnosis by remember { mutableStateOf(case.diagnosis) }
    val ceph = remember {
        androidx.compose.runtime.mutableStateMapOf<String, String>().apply {
            CEPH_FIELDS.forEach { (id, _) -> put(id, case.cephData[id].orEmpty()) }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            Text(
                if (arabic) "تفاصيل الحالة" else "Case details",
                fontSize = 19.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Spacer(Modifier.height(14.dp))

            OutlinedTextField(
                value = diagnosis,
                onValueChange = { diagnosis = it },
                label = { Text(if (arabic) "التشخيص" else "Diagnosis") },
                shape = Alpha.CardShape,
                colors = orthoFieldColors(),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 4,
            )

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "القياسات السيفالومترية" else "CEPHALOMETRICS")
            Text(
                if (arabic) "اتركه فارغاً إن لم يُقس." else "Leave blank where not measured.",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
            Spacer(Modifier.height(8.dp))

            // Two to a row: these are short numbers, and one per line would make
            // the sheet longer than the keyboard leaves room for.
            CEPH_FIELDS.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    pair.forEach { (id, label) ->
                        OutlinedTextField(
                            value = ceph[id].orEmpty(),
                            onValueChange = { ceph[id] = it },
                            label = { Text(label, fontSize = 11.sp) },
                            singleLine = true,
                            shape = Alpha.CardShape,
                            colors = orthoFieldColors(),
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
            }

            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { onSave(diagnosis, ceph.toMap()) },
                enabled = !saving,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                }
                Text(if (arabic) "حفظ" else "Save", fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun StatusChip(status: String, arabic: Boolean) {
    val (bg, fg) = when (status) {
        "Active" -> Alpha.GreenSoft to Alpha.Green
        "Retention" -> Alpha.WarnBg to Alpha.WarnText
        else -> Alpha.Slate100 to Alpha.Slate600
    }
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(
            when (status) {
                "Active" -> if (arabic) "نشطة" else "Active"
                "Retention" -> if (arabic) "تثبيت" else "Retention"
                "Completed" -> if (arabic) "منتهية" else "Completed"
                else -> status
            },
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            color = fg,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun orthoFieldColors(pill: Boolean = false) = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = if (pill) {
        if (Alpha.dark) Alpha.Slate100 else Color.Transparent
    } else Alpha.Slate200,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = if (pill) Alpha.Card else Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)

/** Handles both "yyyy-MM-dd" and the ISO timestamps the website wrote. */
private fun prettyDay(raw: String, arabic: Boolean): String {
    if (raw.isBlank()) return ""
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    val key = raw.take(10)
    val parsed = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(key) }.getOrNull()
        ?: return raw
    return SimpleDateFormat("d MMM yyyy", locale).format(parsed)
}
