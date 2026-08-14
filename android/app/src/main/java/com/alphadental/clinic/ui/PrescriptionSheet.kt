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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
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
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.DrugShortcut
import com.alphadental.clinic.data.RxItem

/**
 * Write a prescription.
 *
 * The clinic's saved drug shortcuts sit at the top because the same handful of antibiotics and
 * painkillers cover most dental prescribing — tapping one fills the name and the usual dose, and
 * anything unusual can still be typed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrescriptionSheet(
    patientName: String,
    doctors: List<Doctor>,
    shortcuts: List<DrugShortcut>,
    saving: Boolean,
    arabic: Boolean,
    onSave: (doctor: String, diagnosis: String, drugs: List<RxItem>) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    val drugs = remember { mutableStateListOf<RxItem>() }
    var doctor by remember { mutableStateOf(doctors.firstOrNull()?.name.orEmpty()) }
    var diagnosis by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var dose by remember { mutableStateOf("") }

    fun addCurrent() {
        if (name.isBlank()) return
        drugs += RxItem(name = name.trim(), dose = dose.trim())
        name = ""
        dose = ""
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                if (arabic) "كتابة روشتة" else "Write a prescription",
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                color = Alpha.Slate900,
            )
            Text(patientName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate500)

            if (doctors.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                SectionHeading(if (arabic) "الطبيب" else "PRESCRIBED BY")
                Spacer(Modifier.height(8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(doctors, key = { it.id }) { d ->
                        FilterChip(
                            selected = doctor == d.name,
                            onClick = { doctor = d.name },
                            label = { Text(d.name, fontSize = 13.sp, fontWeight = FontWeight.Bold) },
                            shape = Alpha.PillShape,
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = Alpha.Ink,
                                selectedLabelColor = Color.White,
                            ),
                        )
                    }
                }
            }

            if (shortcuts.isNotEmpty()) {
                Spacer(Modifier.height(16.dp))
                SectionHeading(if (arabic) "الأدوية المحفوظة" else "SAVED MEDICINES")
                Spacer(Modifier.height(8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(shortcuts, key = { it.id }) { shortcut ->
                        AssistChip(
                            onClick = { drugs += RxItem(name = shortcut.name, dose = shortcut.dose) },
                            label = { Text(shortcut.name, fontSize = 13.sp, fontWeight = FontWeight.Bold) },
                            shape = Alpha.PillShape,
                            colors = AssistChipDefaults.assistChipColors(labelColor = Alpha.Slate700),
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "إضافة دواء" else "ADD A MEDICINE")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(if (arabic) "الاسم" else "Medicine") },
                    singleLine = true,
                    shape = Alpha.CardShape,
                    colors = rxFieldColors(),
                    modifier = Modifier.weight(1.4f),
                )
                OutlinedTextField(
                    value = dose,
                    onValueChange = { dose = it },
                    label = { Text(if (arabic) "الجرعة" else "Dose") },
                    singleLine = true,
                    shape = Alpha.CardShape,
                    colors = rxFieldColors(),
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = { addCurrent() }, enabled = name.isNotBlank()) {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = if (arabic) "إضافة" else "Add",
                        tint = if (name.isBlank()) Alpha.Slate300 else Alpha.Green,
                    )
                }
            }

            if (drugs.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                SectionHeading(if (arabic) "الروشتة" else "ON THIS PRESCRIPTION")
                Spacer(Modifier.height(6.dp))
                Column(Modifier.heightIn(max = 200.dp).verticalScroll(rememberScrollState())) {
                    drugs.forEachIndexed { index, item ->
                        Surface(
                            shape = Alpha.CardShape,
                            color = Alpha.Slate50,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 3.dp),
                        ) {
                            Row(
                                Modifier.padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        item.name,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate800,
                                    )
                                    if (item.dose.isNotBlank()) {
                                        Text(
                                            item.dose,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium,
                                            color = Alpha.Slate500,
                                        )
                                    }
                                }
                                IconButton(onClick = { drugs.removeAt(index) }) {
                                    Icon(
                                        Icons.Filled.Close,
                                        contentDescription = if (arabic) "حذف" else "Remove",
                                        tint = Alpha.Slate400,
                                        modifier = Modifier.size(18.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = diagnosis,
                onValueChange = { diagnosis = it },
                label = { Text(if (arabic) "التشخيص (اختياري)" else "Diagnosis (optional)") },
                shape = Alpha.CardShape,
                colors = rxFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(18.dp))
            Button(
                onClick = {
                    // Anything half-typed in the fields counts too — losing a medicine because
                    // the + was never tapped is exactly the kind of slip that matters here.
                    val finalDrugs = if (name.isNotBlank()) {
                        drugs + RxItem(name = name.trim(), dose = dose.trim())
                    } else {
                        drugs.toList()
                    }
                    onSave(doctor, diagnosis, finalDrugs)
                },
                enabled = (drugs.isNotEmpty() || name.isNotBlank()) && !saving,
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
                        if (arabic) "حفظ الروشتة" else "Save prescription",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Text(
                // Honest about where printing lives, rather than leaving someone hunting for a
                // print button that was never built.
                if (arabic) "تُحفظ الروشتة في ملف المريض. الطباعة من النظام على المتصفح."
                else "Saved to the patient's file. Print it from the full system in a browser.",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }
}

@Composable
private fun rxFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Color.White,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)
