package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.Service

/** What the sheet collects, handed straight to the repository. */
data class NoteDraft(
    val procedure: String = "",
    val service: Service? = null,
    val tooth: String = "",
    val note: String = "",
    val cost: Double = 0.0,
    val status: String = "Completed",
    val doctor: Doctor? = null,
)

/**
 * Record what was done to a patient.
 *
 * The procedure can come from the price list or be typed freely — the website allows both, and a
 * dentist mid-surgery should not be blocked because a treatment was never added to the catalogue.
 * Picking from the list fills the cost and carries the lab fee, which is what makes the charge and
 * the commission come out right.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddNoteSheet(
    patientName: String,
    services: List<Service>,
    doctors: List<Doctor>,
    saving: Boolean,
    arabic: Boolean,
    onSave: (NoteDraft) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var draft by remember { mutableStateOf(NoteDraft()) }
    var costText by remember { mutableStateOf("") }
    var serviceFilter by remember { mutableStateOf("") }

    val cost = costText.replace(",", "").toDoubleOrNull() ?: 0.0
    val canSave = draft.procedure.isNotBlank() && !saving

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                if (arabic) "تسجيل إجراء" else "Record a procedure",
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                color = Alpha.Slate900,
            )
            Text(patientName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate500)

            Spacer(Modifier.height(18.dp))
            SectionHeading(if (arabic) "الإجراء" else "PROCEDURE")
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = draft.procedure,
                onValueChange = { draft = draft.copy(procedure = it, service = null) },
                label = { Text(if (arabic) "ما الذي تم عمله" else "What was done") },
                singleLine = true,
                shape = Alpha.CardShape,
                colors = noteFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            if (services.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = serviceFilter,
                    onValueChange = { serviceFilter = it },
                    label = { Text(if (arabic) "أو اختر من قائمة الأسعار" else "Or pick from the price list") },
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400) },
                    shape = Alpha.CardShape,
                    colors = noteFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )

                val matches = remember(serviceFilter, services) {
                    if (serviceFilter.isBlank()) services.take(6)
                    else services.filter { it.name.contains(serviceFilter.trim(), ignoreCase = true) }
                }

                Spacer(Modifier.height(6.dp))
                LazyColumn(Modifier.heightIn(max = 170.dp)) {
                    items(matches, key = { it.id }) { service ->
                        val selected = draft.service?.id == service.id
                        Surface(
                            shape = Alpha.CardShape,
                            color = if (selected) Alpha.GreenSoft else Alpha.Slate50,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp),
                        ) {
                            TextButton(
                                onClick = {
                                    draft = draft.copy(procedure = service.name, service = service)
                                    // Filling the price is the point of picking from the list; the
                                    // lab fee rides along and keeps the commission correct.
                                    costText = service.price.toInt().toString()
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    service.name,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate800,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    "${service.price.toInt()} EGP",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Black,
                                    color = Alpha.Slate600,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = draft.tooth,
                    onValueChange = { draft = draft.copy(tooth = it) },
                    label = { Text(if (arabic) "السن" else "Tooth") },
                    singleLine = true,
                    shape = Alpha.CardShape,
                    colors = noteFieldColors(),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = costText,
                    onValueChange = { input -> costText = input.filter { it.isDigit() || it == '.' } },
                    label = { Text(if (arabic) "التكلفة" else "Cost") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    shape = Alpha.CardShape,
                    colors = noteFieldColors(),
                    modifier = Modifier.weight(1f),
                )
            }

            // Says plainly what a cost does, because the alternative is a dentist assuming a
            // procedure was billed when it was only recorded.
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (cost > 0) {
                    if (arabic) "سيُضاف هذا المبلغ إلى حساب المريض."
                    else "This amount will be charged to the patient's account."
                } else {
                    if (arabic) "بدون تكلفة — يُسجَّل طبياً فقط ولا يُضاف للحساب."
                    else "No cost — recorded clinically only, nothing is charged."
                },
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = if (cost > 0) Alpha.Green else Alpha.Slate400,
            )

            if (doctors.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                SectionHeading(if (arabic) "الطبيب" else "DOCTOR")
                Spacer(Modifier.height(8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(doctors, key = { it.id }) { doctor ->
                        FilterChip(
                            selected = draft.doctor?.id == doctor.id,
                            onClick = {
                                draft = draft.copy(doctor = if (draft.doctor?.id == doctor.id) null else doctor)
                            },
                            label = { Text(doctor.name, fontSize = 13.sp, fontWeight = FontWeight.Bold) },
                            shape = Alpha.PillShape,
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = Alpha.Ink,
                                selectedLabelColor = Color.White,
                            ),
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "الحالة" else "STATUS")
            Spacer(Modifier.height(8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(NOTE_STATUSES) { status ->
                    FilterChip(
                        selected = draft.status == status,
                        onClick = { draft = draft.copy(status = status) },
                        label = { Text(noteStatusLabel(status, arabic), fontSize = 13.sp, fontWeight = FontWeight.Bold) },
                        shape = Alpha.PillShape,
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Alpha.Ink,
                            selectedLabelColor = Color.White,
                        ),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = draft.note,
                onValueChange = { draft = draft.copy(note = it) },
                label = { Text(if (arabic) "ملاحظات (اختياري)" else "Notes (optional)") },
                shape = Alpha.CardShape,
                colors = noteFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { onSave(draft.copy(cost = cost)) },
                enabled = canSave,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                } else {
                    Text(
                        if (arabic) "حفظ الإجراء" else "Save procedure",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }
        }
    }
}

/** The three states the website's clinical timeline uses. */
val NOTE_STATUSES = listOf("Planned", "Ongoing", "Completed")

fun noteStatusLabel(status: String, arabic: Boolean): String = when (status) {
    "Planned" -> if (arabic) "مخطط" else "Planned"
    "Ongoing" -> if (arabic) "جارٍ" else "Ongoing"
    "Completed" -> if (arabic) "مكتمل" else "Completed"
    else -> status
}

@Composable
private fun noteFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Color.White,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)
