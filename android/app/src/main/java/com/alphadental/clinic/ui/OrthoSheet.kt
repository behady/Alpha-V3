package com.alphadental.clinic.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.OrthoCase

/** The statuses the website writes. Anything else reads as Active. */
val ORTHO_STATUSES = listOf("Active", "Retention", "Completed")

/**
 * Orthodontic cases.
 *
 * Scoped to what happens at the chair: which cases are running, what was done last time, and
 * logging today's adjustment. The diagnosis and the cephalometric numbers are read-only here —
 * those are typed once from a tracing, need to be exact, and belong on a screen with a keyboard.
 *
 * An ortho case is months of short visits whose whole value is the thread between them. Making a
 * dentist open a laptop to answer "what did we do last time" is how that thread gets lost.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrthoSheet(
    cases: List<OrthoCase>,
    openCase: OrthoCase?,
    loading: Boolean,
    saving: Boolean,
    canEdit: Boolean,
    arabic: Boolean,
    onOpenCase: (OrthoCase?) -> Unit,
    onLogVisit: (OrthoCase, String, String) -> Unit,
    onSetStatus: (OrthoCase, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            if (openCase == null) {
                OrthoList(cases, loading, arabic, onOpenCase)
            } else {
                OrthoCaseView(openCase, saving, canEdit, arabic, onOpenCase, onLogVisit, onSetStatus)
            }
        }
    }
}

@Composable
private fun OrthoList(
    cases: List<OrthoCase>,
    loading: Boolean,
    arabic: Boolean,
    onOpenCase: (OrthoCase?) -> Unit,
) {
    var filter by remember { mutableStateOf("Active") }
    val shown = cases.filter { it.status == filter }

    Text(
        if (arabic) "التقويم" else "Orthodontics",
        fontSize = 22.sp,
        fontWeight = FontWeight.Black,
        color = Alpha.Slate900,
    )

    Spacer(Modifier.height(12.dp))

    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(ORTHO_STATUSES) { status ->
            FilterChip(
                selected = filter == status,
                onClick = { filter = status },
                label = {
                    Text(
                        "${orthoStatusLabel(status, arabic)} (${cases.count { it.status == status }})",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                    )
                },
                shape = Alpha.PillShape,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Alpha.Ink,
                    selectedLabelColor = Color.White,
                ),
            )
        }
    }

    Spacer(Modifier.height(14.dp))

    when {
        loading -> Box(Modifier.fillMaxWidth().padding(vertical = 40.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
        }

        shown.isEmpty() -> Text(
            if (arabic) "لا توجد حالات هنا." else "No cases here.",
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            color = Alpha.Slate400,
            modifier = Modifier.padding(vertical = 24.dp),
        )

        else -> LazyColumn(
            Modifier.heightIn(max = 460.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(shown, key = { it.patientId }) { case ->
                Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.Slate50,
                    modifier = Modifier.fillMaxWidth().clickable { onOpenCase(case) },
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                case.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                                fontSize = 14.5.sp,
                                fontWeight = FontWeight.Black,
                                color = Alpha.Slate900,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = buildString {
                                    append(
                                        if (arabic) "${case.visits.size} زيارة"
                                        else "${case.visits.size} visit${if (case.visits.size == 1) "" else "s"}"
                                    )
                                    // The last adjustment date is the number a dentist scans for:
                                    // it says whether this patient is overdue for one.
                                    case.visits.maxByOrNull { it.visitNo }?.date?.takeIf { it.isNotBlank() }?.let {
                                        append(if (arabic) " · آخرها $it" else " · last $it")
                                    }
                                },
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate400,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OrthoCaseView(
    case: OrthoCase,
    saving: Boolean,
    canEdit: Boolean,
    arabic: Boolean,
    onBack: (OrthoCase?) -> Unit,
    onLogVisit: (OrthoCase, String, String) -> Unit,
    onSetStatus: (OrthoCase, String) -> Unit,
) {
    var workDone by remember(case.patientId) { mutableStateOf("") }
    var nextStep by remember(case.patientId) { mutableStateOf("") }

    Column(Modifier.verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onBack(null) }) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate600)
            }
            Column(Modifier.weight(1f)) {
                Text(
                    case.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Black,
                    color = Alpha.Slate900,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (case.startDate.isNotBlank()) {
                    Text(
                        (if (arabic) "بدأ " else "started ") + case.startDate,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate400,
                    )
                }
            }
        }

        if (case.diagnosis.isNotBlank()) {
            Spacer(Modifier.height(10.dp))
            SectionHeading(if (arabic) "التشخيص" else "DIAGNOSIS")
            Spacer(Modifier.height(6.dp))
            Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
                Text(
                    case.diagnosis,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate700,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        if (canEdit) {
            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "تسجيل زيارة" else "LOG TODAY'S VISIT")
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = workDone,
                onValueChange = { workDone = it },
                label = { Text(if (arabic) "ما تم عمله" else "What was done") },
                shape = Alpha.CardShape,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = nextStep,
                onValueChange = { nextStep = it },
                label = { Text(if (arabic) "الخطوة التالية" else "Next step") },
                shape = Alpha.CardShape,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    onLogVisit(case, workDone, nextStep)
                    workDone = ""
                    nextStep = ""
                },
                enabled = workDone.isNotBlank() && !saving,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                } else {
                    Text(
                        if (arabic) "حفظ الزيارة" else "Save visit",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "حالة العلاج" else "CASE STATUS")
            Spacer(Modifier.height(8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ORTHO_STATUSES) { status ->
                    FilterChip(
                        selected = case.status == status,
                        onClick = { if (case.status != status) onSetStatus(case, status) },
                        label = {
                            Text(orthoStatusLabel(status, arabic), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        },
                        shape = Alpha.PillShape,
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Alpha.Ink,
                            selectedLabelColor = Color.White,
                        ),
                    )
                }
            }
        }

        Spacer(Modifier.height(18.dp))
        SectionHeading(if (arabic) "الزيارات السابقة" else "PREVIOUS VISITS")
        Spacer(Modifier.height(8.dp))

        if (case.visits.isEmpty()) {
            Text(
                if (arabic) "لم تُسجَّل زيارات بعد." else "No visits logged yet.",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate400,
            )
        } else {
            // Newest first: the last adjustment is the one that decides what happens today.
            case.visits.sortedByDescending { it.visitNo }.forEach { visit ->
                Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.Slate50,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Row {
                            Text(
                                "#${visit.visitNo}",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Black,
                                color = Alpha.Green,
                            )
                            Spacer(Modifier.size(8.dp))
                            Text(
                                visit.date,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate400,
                            )
                        }
                        if (visit.workDone.isNotBlank()) {
                            Text(
                                visit.workDone,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate800,
                                modifier = Modifier.padding(top = 4.dp),
                            )
                        }
                        if (visit.nextStep.isNotBlank()) {
                            Text(
                                (if (arabic) "التالي: " else "Next: ") + visit.nextStep,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                                color = Alpha.Slate500,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(10.dp))
        Text(
            if (arabic) "القياسات السيفالومترية والتشخيص تُحرَّر من النظام على المتصفح."
            else "Cephalometric measurements and the diagnosis are edited in the full system.",
            fontSize = 11.5.sp,
            fontWeight = FontWeight.Medium,
            color = Alpha.Slate400,
        )
    }
}

private fun orthoStatusLabel(status: String, arabic: Boolean): String = when (status) {
    "Active" -> if (arabic) "جارية" else "Active"
    "Retention" -> if (arabic) "تثبيت" else "Retention"
    "Completed" -> if (arabic) "منتهية" else "Completed"
    else -> status
}
