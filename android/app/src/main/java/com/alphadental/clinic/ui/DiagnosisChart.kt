package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.DIAGNOSIS_CATEGORIES
import com.alphadental.clinic.data.DIAGNOSIS_OPTIONS
import com.alphadental.clinic.data.ToothDiagnosis
import com.alphadental.clinic.data.diagnosisCategory
import com.alphadental.clinic.data.diagnosisColor
import com.alphadental.clinic.data.diagnosisLabel

/** The permanent dentition, as the chart lays it out. Mirrors TeethChart's quadrants. */
private val DQ1 = listOf(18, 17, 16, 15, 14, 13, 12, 11)
private val DQ2 = listOf(21, 22, 23, 24, 25, 26, 27, 28)
private val DQ4 = listOf(48, 47, 46, 45, 44, 43, 42, 41)
private val DQ3 = listOf(31, 32, 33, 34, 35, 36, 37, 38)

private val DChildQ1 = listOf(55, 54, 53, 52, 51)
private val DChildQ2 = listOf(61, 62, 63, 64, 65)
private val DChildQ4 = listOf(85, 84, 83, 82, 81)
private val DChildQ3 = listOf(71, 72, 73, 74, 75)

/**
 * The diagnosis chart — the phone's half of the website's charting screen.
 *
 * Each tooth wears the colour of its condition's category, so a mouth reads at
 * a glance: red caries, orange pulp, teal perio. Tapping one opens the
 * catalogue — the same sixty-one conditions the website offers, in the same
 * eleven groups, saved under the same ids.
 *
 * Surface-level marking and perio pocket charting deliberately stay on the
 * website: those need a precision a thumb on a 6mm target cannot give, and a
 * half-accurate perio chart is worse than none.
 */
@Composable
fun DiagnosisChart(
    diagnosis: List<ToothDiagnosis>,
    arabic: Boolean,
    saving: Boolean,
    /** Null when this user may not chart. */
    onSave: ((tooth: String, statuses: List<String>, notes: String) -> Unit)?,
) {
    var showChild by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<String?>(null) }

    val byTooth = remember(diagnosis) { diagnosis.associateBy { it.tooth } }

    editing?.let { tooth ->
        ToothDiagnosisSheet(
            tooth = tooth,
            existing = byTooth[tooth],
            arabic = arabic,
            saving = saving,
            readOnly = onSave == null,
            onSave = { statuses, notes ->
                onSave?.invoke(tooth, statuses, notes)
                editing = null
            },
            onDismiss = { editing = null },
        )
    }

    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionHeading(if (arabic) "مخطط التشخيص" else "DIAGNOSIS CHART", Modifier.weight(1f))
            TextButton(onClick = { showChild = !showChild }) {
                Text(
                    if (showChild) {
                        if (arabic) "أسنان دائمة" else "Adult teeth"
                    } else {
                        if (arabic) "أسنان لبنية" else "Child teeth"
                    },
                    fontSize = 12.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Alpha.Green,
                )
            }
        }

        Spacer(Modifier.height(6.dp))

        Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(vertical = 12.dp, horizontal = 8.dp)) {
                DiagnosisArch(
                    right = if (showChild) DChildQ1 else DQ1,
                    left = if (showChild) DChildQ2 else DQ2,
                    byTooth = byTooth,
                ) { editing = it }

                Spacer(Modifier.height(6.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(Alpha.Slate200))
                Spacer(Modifier.height(6.dp))

                DiagnosisArch(
                    right = if (showChild) DChildQ4 else DQ4,
                    left = if (showChild) DChildQ3 else DQ3,
                    byTooth = byTooth,
                ) { editing = it }
            }
        }

        Spacer(Modifier.height(8.dp))
        Text(
            when {
                onSave == null && arabic -> "للعرض فقط — حسابك لا يعدّل التشخيص."
                onSave == null -> "Read-only — your account cannot chart diagnoses."
                arabic -> "اضغط على أي سن لتسجيل حالته."
                else -> "Tap any tooth to record its condition."
            },
            fontSize = 11.5.sp,
            fontWeight = FontWeight.Medium,
            color = Alpha.Slate400,
        )
    }
}

@Composable
private fun DiagnosisArch(
    right: List<Int>,
    left: List<Int>,
    byTooth: Map<String, ToothDiagnosis>,
    onTap: (String) -> Unit,
) {
    // Weighted, like the other charts: sixteen fixed-width teeth do not fit a phone.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        right.forEach { DiagnosisTooth(it, byTooth, Modifier.weight(1f), onTap) }
        Spacer(Modifier.width(5.dp))
        left.forEach { DiagnosisTooth(it, byTooth, Modifier.weight(1f), onTap) }
    }
}

@Composable
private fun DiagnosisTooth(
    number: Int,
    byTooth: Map<String, ToothDiagnosis>,
    modifier: Modifier,
    onTap: (String) -> Unit,
) {
    val key = number.toString()
    val entry = byTooth[key]
    val colour = entry?.let { diagnosisColor(it.statuses) }

    Box(
        modifier
            .padding(horizontal = 0.5.dp)
            .height(34.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(colour ?: if (Alpha.dark) Alpha.Slate100 else Color.White)
            .clickable { onTap(key) },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                key,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                color = if (colour != null) Color.White else Alpha.Slate500,
                maxLines = 1,
                softWrap = false,
            )
            // A note with no condition still has to be visible, or it looks unrecorded.
            if (entry != null && entry.statuses.isEmpty() && entry.notes.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Box(Modifier.size(4.dp).clip(CircleShape).background(Alpha.Slate400))
            }
        }
    }
}

/**
 * One tooth's conditions, from the shared catalogue.
 *
 * Multi-select by design: a tooth can carry deep caries and an irreversible
 * pulpitis at once, and forcing one would make the record lie.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ToothDiagnosisSheet(
    tooth: String,
    existing: ToothDiagnosis?,
    arabic: Boolean,
    saving: Boolean,
    readOnly: Boolean,
    onSave: (List<String>, String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val picked = remember { mutableStateListOf<String>().apply { addAll(existing?.statuses.orEmpty()) } }
    var notes by remember { mutableStateOf(existing?.notes.orEmpty()) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(diagnosisColor(picked.toList()) ?: Alpha.Slate100),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        tooth,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = if (diagnosisColor(picked.toList()) != null) Color.White else Alpha.Slate700,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        (if (arabic) "السن " else "Tooth ") + tooth,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                    )
                    Text(
                        if (picked.isEmpty()) {
                            if (arabic) "لا توجد حالة مسجلة" else "Nothing recorded"
                        } else {
                            "${picked.size} " + (if (arabic) "حالة" else "selected")
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
                if (picked.isNotEmpty() && !readOnly) {
                    TextButton(onClick = { picked.clear() }) {
                        Text(
                            if (arabic) "مسح" else "Clear",
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate500,
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // The catalogue, grouped exactly as the website groups it.
            DIAGNOSIS_CATEGORIES.forEach { category ->
                val options = DIAGNOSIS_OPTIONS.filter { it.category == category.id }
                if (options.isEmpty()) return@forEach

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(top = 10.dp, bottom = 6.dp),
                ) {
                    Box(Modifier.size(9.dp).clip(CircleShape).background(category.color))
                    Spacer(Modifier.width(7.dp))
                    Text(
                        if (arabic) category.ar else category.en,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                        letterSpacing = 0.6.sp,
                    )
                }

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    options.forEach { option ->
                        val selected = option.id in picked
                        Surface(
                            onClick = {
                                if (readOnly) return@Surface
                                if (selected) picked.remove(option.id) else picked.add(option.id)
                            },
                            enabled = !readOnly,
                            shape = Alpha.PillShape,
                            color = if (selected) category.color else Alpha.Slate50,
                            border = if (selected) null else androidx.compose.foundation.BorderStroke(1.dp, Alpha.Slate200),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 11.dp, vertical = 7.dp),
                            ) {
                                if (selected) {
                                    Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(12.dp))
                                    Spacer(Modifier.width(5.dp))
                                }
                                Text(
                                    if (arabic) option.ar else option.en,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (selected) Color.White else Alpha.Slate700,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it },
                enabled = !readOnly,
                label = { Text(if (arabic) "ملاحظات على هذا السن" else "Notes on this tooth") },
                shape = Alpha.CardShape,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Alpha.Green,
                    unfocusedBorderColor = Alpha.Slate200,
                    focusedContainerColor = Alpha.Card,
                    unfocusedContainerColor = Alpha.Slate50,
                    focusedLabelColor = Alpha.Green,
                    unfocusedLabelColor = Alpha.Slate400,
                    cursorColor = Alpha.Ink,
                ),
                modifier = Modifier.fillMaxWidth(),
                maxLines = 4,
            )

            if (!readOnly) {
                Spacer(Modifier.height(18.dp))
                Button(
                    onClick = { onSave(picked.toList(), notes) },
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
                    Text(
                        when {
                            picked.isEmpty() && notes.isBlank() && arabic -> "مسح السن"
                            picked.isEmpty() && notes.isBlank() -> "Clear this tooth"
                            arabic -> "حفظ"
                            else -> "Save"
                        },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

/** The legend under the chart: which colour means which family of conditions. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DiagnosisLegend(arabic: Boolean) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        DIAGNOSIS_CATEGORIES.forEach { category ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(category.color))
                Spacer(Modifier.width(5.dp))
                Text(
                    if (arabic) category.ar else category.en,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate500,
                )
            }
        }
    }
}
