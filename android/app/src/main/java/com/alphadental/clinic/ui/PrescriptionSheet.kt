package com.alphadental.clinic.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
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
import com.alphadental.clinic.data.DrugCatalog
import com.alphadental.clinic.data.DrugShortcut
import com.alphadental.clinic.data.RxItem

/** Past this many rows the picker stops rendering; a query that broad is not a query. */
private const val PICKER_MAX_ROWS = 40

/**
 * Write a prescription.
 *
 * The drug list at the top is the built-in Egyptian formulary plus whatever the clinic has done
 * to it, so a phone opened on its first day already offers the same 53 medicines the website
 * does. Tapping one fills the name and both dose lines; nothing is ever added automatically,
 * because the dose usually needs adjusting for the patient in front of you.
 *
 * Every line carries an Arabic twin. That is not decoration: the English dose is for the
 * pharmacist and the Arabic one is the sentence the patient reads at home, and both print, one
 * under the other. A phone that wrote only the English half would produce a script that is
 * visibly poorer than the same script written at the desk.
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
    var doseAr by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var instructionsAr by remember { mutableStateOf("") }
    var drugFilter by remember { mutableStateOf("") }

    // Merged once per load of the clinic's rows, not per keystroke: the merge walks the whole
    // catalog and builds a search string for every drug in it.
    val library = remember(shortcuts) { mergeDrugPicks(shortcuts) }
    val matches = remember(drugFilter, library) { searchDrugPicks(library, drugFilter) }

    fun addCurrent() {
        if (name.isBlank()) return
        drugs += RxItem(
            name = name.trim(),
            dose = dose.trim(),
            doseAr = doseAr.trim(),
            note = instructions.trim(),
            noteAr = instructionsAr.trim(),
        )
        name = ""
        dose = ""
        doseAr = ""
        instructions = ""
        instructionsAr = ""
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                if (arabic) "كتابة روشتة" else "Write a prescription",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
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

            // Always shown. It used to hide itself when the clinic had saved nothing, which was
            // honest then and is wrong now: the built-in library means the list is never empty.
            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "من قائمة الأدوية" else "FROM THE DRUG LIST")
            Spacer(Modifier.height(8.dp))

            OutlinedTextField(
                value = drugFilter,
                onValueChange = { drugFilter = it },
                placeholder = {
                    Text(
                        if (arabic) "ابحث بالاسم أو بالحالة" else "Search by name or by what it treats",
                        color = Alpha.Slate400,
                        fontSize = 13.sp,
                    )
                },
                singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400, modifier = Modifier.size(18.dp)) },
                shape = Alpha.PillShape,
                colors = rxFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(6.dp))
            if (matches.isEmpty()) {
                Text(
                    if (arabic) "لا يوجد دواء بهذا الاسم في القائمة." else "No medicine in the list matches that.",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate400,
                    modifier = Modifier.padding(4.dp),
                )
            } else {
                // Deliberately NOT a LazyColumn. This whole sheet already sits in a verticalScroll,
                // which measures its child against an infinite height, and a lazy list handed an
                // infinite constraint throws rather than degrading. A plain Column with its own
                // scroll and a hard row cap composes a bounded, known amount of work instead.
                Column(
                    Modifier
                        .heightIn(max = 260.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    matches.take(PICKER_MAX_ROWS).forEach { pick ->
                        DrugPickRow(
                            pick = pick,
                            arabic = arabic,
                            onPick = {
                                name = pick.name
                                dose = pick.dose
                                doseAr = pick.doseAr
                                // The catalog's note is advice for the dentist to say out loud, not
                                // text for the patient's paper, so it stays in the row above and the
                                // instruction boxes start empty — clearing whatever a previous pick
                                // or a half-typed line left in them.
                                instructions = ""
                                instructionsAr = ""
                                drugFilter = ""
                            },
                        )
                    }
                    if (matches.size > PICKER_MAX_ROWS) {
                        Text(
                            if (arabic) "اكتب أكثر لتضييق النتائج (${matches.size} دواء)"
                            else "Keep typing to narrow it down (${matches.size} matches)",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "إضافة دواء" else "ADD A MEDICINE")
            Spacer(Modifier.height(8.dp))
            // The name gets its own line and each language pairs across: four boxes crammed into
            // two mixed rows made it impossible to see at a glance which Arabic line belonged to
            // which English one, which is exactly the mistake that reaches the patient.
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(if (arabic) "الاسم" else "Medicine") },
                singleLine = true,
                shape = Alpha.CardShape,
                colors = rxFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = dose,
                    onValueChange = { dose = it },
                    label = { Text(if (arabic) "الجرعة" else "Dose") },
                    singleLine = true,
                    shape = Alpha.CardShape,
                    colors = rxFieldColors(),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = doseAr,
                    onValueChange = { doseAr = it },
                    label = { Text(if (arabic) "الجرعة (بالعربي)" else "Dose (Arabic)") },
                    singleLine = true,
                    shape = Alpha.CardShape,
                    colors = rxFieldColors(),
                    modifier = Modifier.weight(1f),
                )
            }

            // How to take it. The field existed on the record and printed on the
            // script all along — there was simply nowhere to type it, so every
            // prescription written on a phone reached the pharmacy without it.
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = instructions,
                    onValueChange = { instructions = it },
                    label = { Text(if (arabic) "التعليمات" else "Instructions") },
                    placeholder = {
                        // Not switched on `arabic`: this box is the English line whatever
                        // language the app is in, and the box beside it is the Arabic one.
                        Text(
                            "3 times daily after meals",
                            color = Alpha.Slate400,
                            fontSize = 12.5.sp,
                        )
                    },
                    shape = Alpha.CardShape,
                    colors = rxFieldColors(),
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                )
                OutlinedTextField(
                    value = instructionsAr,
                    onValueChange = { instructionsAr = it },
                    label = { Text(if (arabic) "تعليمات (بالعربي)" else "Instructions (Arabic)") },
                    placeholder = {
                        Text(
                            "٣ مرات يومياً بعد الأكل",
                            color = Alpha.Slate400,
                            fontSize = 12.5.sp,
                        )
                    },
                    shape = Alpha.CardShape,
                    colors = rxFieldColors(),
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                )
            }

            Spacer(Modifier.height(4.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (arabic) "أضف الدواء للروشتة" else "Add to the prescription",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (name.isBlank()) Alpha.Slate300 else Alpha.Slate600,
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
                                    val detail = listOfNotNull(
                                        item.dose.takeIf { it.isNotBlank() },
                                        item.note.takeIf { it.isNotBlank() },
                                    ).joinToString("  ·  ")
                                    if (detail.isNotBlank()) {
                                        Text(
                                            detail,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium,
                                            color = Alpha.Slate500,
                                        )
                                    }
                                    // The Arabic twin gets its own line rather than being joined
                                    // onto the English one: one Text holding both directions puts
                                    // the separator at the wrong end and reads as a typo.
                                    val detailAr = listOfNotNull(
                                        item.doseAr.takeIf { it.isNotBlank() },
                                        item.noteAr.takeIf { it.isNotBlank() },
                                    ).joinToString("  ·  ")
                                    if (detailAr.isNotBlank()) {
                                        Text(
                                            detailAr,
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
                        drugs + RxItem(
                            name = name.trim(),
                            dose = dose.trim(),
                            doseAr = doseAr.trim(),
                            note = instructions.trim(),
                            noteAr = instructionsAr.trim(),
                        )
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
                        fontWeight = FontWeight.ExtraBold,
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

/**
 * One tappable row of the drug list.
 *
 * The note and the caution are shown and never copied anywhere. That is the whole point of them:
 * "finish the course" is a sentence for the dentist to say, and "ask about penicillin allergy" is
 * a question to ask before writing the line at all — putting either on the patient's paper would
 * be, at best, confusing.
 */
@Composable
private fun DrugPickRow(pick: DrugPick, arabic: Boolean, onPick: () -> Unit) {
    Surface(
        shape = Alpha.CardShape,
        color = Alpha.Slate50,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
    ) {
        // Clickable on the inside of the Surface, not on its modifier: the Surface clips to its
        // shape, so the ripple follows the rounded card instead of flashing a rectangle over it.
        Column(
            Modifier
                .clickable { onPick() }
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(
                pick.name,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate800,
            )

            // Falls back to the other language rather than showing nothing: a clinic's own drug
            // usually carries one dose line, and which one it is is up to whoever typed it.
            val shownDose =
                if (arabic) pick.doseAr.ifBlank { pick.dose } else pick.dose.ifBlank { pick.doseAr }
            if (shownDose.isNotBlank()) {
                Text(
                    shownDose,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate500,
                )
            }

            val note = if (arabic) pick.noteAr.ifBlank { pick.noteEn } else pick.noteEn.ifBlank { pick.noteAr }
            if (note.isNotBlank()) {
                Text(
                    note,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate400,
                    lineHeight = 15.sp,
                )
            }

            val caution =
                if (arabic) pick.cautionAr.ifBlank { pick.cautionEn } else pick.cautionEn.ifBlank { pick.cautionAr }
            if (caution.isNotBlank()) {
                Row(Modifier.padding(top = 3.dp), verticalAlignment = Alignment.Top) {
                    Icon(
                        Icons.Filled.Warning,
                        contentDescription = null,
                        tint = Alpha.WarnText,
                        modifier = Modifier.padding(top = 1.dp).size(13.dp),
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(
                        caution,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.WarnText,
                        lineHeight = 15.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun rxFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)

/**
 * One row of the picker: the built-in library and the clinic's own drugs, flattened into the one
 * shape the list draws.
 *
 * [haystack] is every word the row may be found by, normalised once at merge time — a search that
 * re-derived it per keystroke would fold 53 drugs' worth of Arabic on every letter typed.
 */
private data class DrugPick(
    val name: String,
    val dose: String,
    val doseAr: String,
    val noteEn: String,
    val noteAr: String,
    val cautionEn: String,
    val cautionAr: String,
    val haystack: String,
)

/**
 * The same merge src/lib/drugList.ts performs on the web, and it has to stay the same one.
 *
 * `catalogId` is the join key: a clinic row carrying one stands in front of that built-in and
 * supplies its name and both doses, the same row with `hidden` removes the built-in entirely, and
 * a row carrying no `catalogId` is a drug the clinic typed in themselves and is listed first. A
 * clinic that has changed nothing stores nothing and simply gets the library.
 *
 * The description and the caution are never taken from the clinic row even when one exists: those
 * are ours to keep accurate and were never the dentist's to edit.
 */
private fun mergeDrugPicks(shortcuts: List<DrugShortcut>): List<DrugPick> {
    val overrides = HashMap<String, DrugShortcut>()
    val own = mutableListOf<DrugShortcut>()

    for (doc in shortcuts) {
        val catalogId = doc.catalogId.trim()
        // Last one wins, if a clinic somehow ends up with two rows for the same built-in.
        if (catalogId.isNotEmpty()) overrides[catalogId] = doc
        else if (doc.name.isNotBlank()) own += doc
    }

    val ownPicks = own
        .map { doc ->
            val name = doc.name.trim()
            DrugPick(
                name = name,
                dose = doc.dose,
                doseAr = doc.doseAr,
                noteEn = "",
                noteAr = "",
                cautionEn = "",
                cautionAr = "",
                haystack = DrugCatalog.normalize(listOf(name, doc.dose, doc.doseAr).joinToString(" ")),
            )
        }
        .sortedBy { it.name.lowercase() }

    val catalogPicks = DrugCatalog.ALL.mapNotNull { drug ->
        val doc = overrides[drug.id]
        if (doc?.hidden == true) return@mapNotNull null
        val name = doc?.name?.trim().orEmpty().ifBlank { drug.name }
        // An override supplies the doses whatever they are, blank included: a dentist who cleared
        // the Arabic line meant to clear it, and quietly restoring ours would undo the edit.
        val shownDose = if (doc != null) doc.dose else drug.doseEn
        val shownDoseAr = if (doc != null) doc.doseAr else drug.doseAr
        DrugPick(
            name = name,
            dose = shownDose,
            doseAr = shownDoseAr,
            noteEn = drug.noteEn,
            noteAr = drug.noteAr,
            cautionEn = drug.cautionEn,
            cautionAr = drug.cautionAr,
            haystack = DrugCatalog.normalize(
                (
                    listOf(
                        name,
                        shownDose,
                        shownDoseAr,
                        drug.descEn,
                        drug.descAr,
                        DrugCatalog.categoryLabel(drug.cat, arabic = false),
                        DrugCatalog.categoryLabel(drug.cat, arabic = true),
                    ) + drug.keywords
                ).joinToString(" ")
            ),
        )
    }

    return ownPicks + catalogPicks
}

/**
 * Every whitespace-separated term must appear somewhere in the row, in any order, so "aug 1" and
 * "مضاد حيوي حساسيه" both land. An empty query returns the list untouched.
 *
 * Both sides of the comparison go through the catalog's normaliser, which is why an Arabic query
 * typed with a plain alef finds a drug written with a hamza — a plain `contains` on the raw text
 * would miss most of what a dentist actually types.
 */
private fun searchDrugPicks(picks: List<DrugPick>, query: String): List<DrugPick> {
    val q = DrugCatalog.normalize(query)
    if (q.isEmpty()) return picks
    val terms = q.split(" ").filter { it.isNotEmpty() }
    return picks.filter { pick -> terms.all { pick.haystack.contains(it) } }
}
