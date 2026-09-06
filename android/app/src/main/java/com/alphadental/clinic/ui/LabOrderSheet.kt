package com.alphadental.clinic.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.activity.compose.BackHandler
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.data.Patient

/**
 * Raising a lab order from the phone.
 *
 * This is the screen whose absence sent someone to a laptop with a bag of impressions in their
 * hand. It asks what the website's order form asks and writes the same document, including the
 * minted `MAD-0142` code — so a case raised chairside is indistinguishable from one raised at
 * the desk, on the same board, in the same sequence.
 *
 * The form is per work type, as the website's is: picking "surgical guide" stops asking for a
 * tooth shade and starts asking for a sleeve system, because a form that asks a guide for its
 * shade is a form people stop reading. Picking a lab fills in the due date from that lab's usual
 * turnaround and the agreed price from what it charges for this work — both still editable,
 * because the whole point of an agreed price is that it was agreed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabOrderSheet(
    /** The case being edited, or null when raising a new one. */
    editing: LabCases.LabCase?,
    /** Set when this is a remake of a case that came back wrong. */
    remakeOf: LabCases.LabCase?,
    labs: List<LabCases.Lab>,
    branches: List<LabCases.Branch>,
    doctors: List<Doctor>,
    /** Patient search: the query goes up, the results come back down. */
    patientResults: List<Patient>,
    patientSearching: Boolean,
    onSearchPatients: (String) -> Unit,
    saving: Boolean,
    error: String?,
    arabic: Boolean,
    onSave: (LabCases.Draft, remakeReason: String, remakeFault: String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }

    var draft by remember(editing?.id, remakeOf?.id) {
        mutableStateOf(
            when {
                editing != null -> LabCases.draftOf(editing)
                remakeOf != null -> LabCases.draftOf(remakeOf).copy(agreedPrice = 0.0, status = "at_lab", sentAt = "", dueDate = "")
                else -> LabCases.Draft()
            }
        )
    }
    var remakeReason by remember { mutableStateOf("") }
    var remakeFault by remember { mutableStateOf("lab") }
    var patientPickerOpen by remember { mutableStateOf(false) }

    val work = LabCases.workTypeFor(draft.workType)

    // A new order for a clinic with one branch has nothing to choose: fill it in rather than
    // showing a picker with a single option and calling it a decision.
    LaunchedEffect(branches, editing, remakeOf) {
        if (editing == null && draft.branchId.isBlank() && branches.size == 1) {
            val only = branches.first()
            draft = draft.copy(branchId = only.id, branchName = only.name, branchCode = LabCases.branchCodeFor(only, 0))
        }
    }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
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
                        when {
                            editing != null -> if (arabic) "تعديل الطلب ${editing.code}" else "Edit ${editing.code}"
                            remakeOf != null -> if (arabic) "إعادة عمل ${remakeOf.code}" else "Remake of ${remakeOf.code}"
                            else -> if (arabic) "طلب معمل جديد" else "New lab order"
                        },
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (editing != null) (if (arabic) "الرقم والسجل لا يتغيران" else "The code and history do not change")
                        else if (arabic) "سيأخذ رقمه عند الحفظ" else "It takes its number when you save",
                        fontSize = 11.5.sp,
                        color = Alpha.Slate500,
                    )
                }
            }

            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
            ) {
                // --- who ---
                if (remakeOf != null) {
                    Field(if (arabic) "سبب الإعادة" else "Why is it being remade") {
                        LabField(remakeReason, { remakeReason = it }, if (arabic) "كسر، اللون غلط، مش مظبوط…" else "Broke, wrong shade, does not fit…", arabic)
                    }
                    Field(if (arabic) "الخطأ من" else "Whose fault") {
                        ChipRow(
                            listOf(
                                "lab" to (if (arabic) "المعمل" else "The lab"),
                                "clinic" to (if (arabic) "العيادة" else "The clinic"),
                                "patient" to (if (arabic) "المريض" else "The patient"),
                                "unknown" to (if (arabic) "غير معروف" else "Unknown"),
                            ),
                            remakeFault,
                        ) { remakeFault = it }
                    }
                }

                SectionHeading(if (arabic) "المريض والطبيب" else "PATIENT AND DENTIST")
                Spacer(Modifier.height(8.dp))
                Surface(
                    onClick = { patientPickerOpen = true },
                    shape = Alpha.CardShape,
                    color = Alpha.Card,
                    border = BorderStroke(1.dp, Alpha.Slate200),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(14.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                draft.patientName.ifBlank { if (arabic) "اختر المريض" else "Choose the patient" },
                                fontSize = 14.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (draft.patientName.isBlank()) Alpha.Slate400 else Alpha.Slate900,
                            )
                            if (draft.patientPhone.isNotBlank()) {
                                Text(draft.patientPhone, fontSize = 12.sp, color = Alpha.Slate500)
                            }
                        }
                        Text(
                            if (arabic) "اختياري" else "optional",
                            fontSize = 11.sp,
                            color = Alpha.Slate400,
                        )
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    if (arabic) "بعض الحالات بلا مريض — إصلاح، موديل دراسي." else "Some cases have no patient — a repair, a study model.",
                    fontSize = 11.sp,
                    color = Alpha.Slate400,
                )

                if (doctors.isNotEmpty()) {
                    Field(if (arabic) "الطبيب" else "Dentist") {
                        ChipRow(doctors.map { it.name to it.name }, draft.doctorName) { name ->
                            val doctor = doctors.firstOrNull { it.name == name }
                            draft = draft.copy(doctorName = if (draft.doctorName == name) "" else name, doctorId = doctor?.id.orEmpty())
                        }
                    }
                }

                if (branches.size > 1 && editing == null) {
                    Field(if (arabic) "الفرع" else "Branch") {
                        ChipRow(branches.map { it.id to it.name }, draft.branchId) { id ->
                            val index = branches.indexOfFirst { it.id == id }
                            val branch = branches.getOrNull(index)
                            draft = draft.copy(
                                branchId = id,
                                branchName = branch?.name.orEmpty(),
                                branchCode = LabCases.branchCodeFor(branch, index),
                            )
                        }
                    }
                }

                // --- the lab ---
                SectionHeading(if (arabic) "المعمل" else "THE LAB")
                Spacer(Modifier.height(8.dp))
                if (labs.isEmpty()) {
                    Text(
                        if (arabic) "لا توجد معامل في الإعدادات بعد. أضف معملاً من الإعدادات ← المعامل."
                        else "No labs in Settings yet. Add one under Settings → Dental labs.",
                        fontSize = 12.5.sp,
                        color = Alpha.WarnText,
                    )
                } else {
                    ChipRow(labs.map { it.id to it.name }, draft.labId) { id ->
                        val lab = labs.firstOrNull { it.id == id }
                        draft = draft.copy(
                            labId = id,
                            labName = lab?.name.orEmpty(),
                            // The lab's usual turnaround becomes the due date, and its price for
                            // this work the agreed one. Both stay editable.
                            dueDate = if (lab != null && lab.turnaroundDays > 0) LabCases.dueInDays(lab.turnaroundDays) else draft.dueDate,
                            agreedPrice = lab?.prices?.get(draft.workType) ?: draft.agreedPrice,
                        )
                    }
                }

                // --- the work ---
                SectionHeading(if (arabic) "الشغل" else "THE WORK")
                Spacer(Modifier.height(8.dp))
                ChipRow(LabCases.WORK_TYPE_LIST.map { it.id to it.label(arabic) }, draft.workType) { id ->
                    val type = LabCases.workTypeFor(id)
                    val lab = labs.firstOrNull { it.id == draft.labId }
                    draft = draft.copy(
                        workType = id,
                        // The defaults this kind of work carries: a denture tries in, a guide
                        // goes as files. Both remain switches the person can flip.
                        needsTryIn = type.tryInByDefault,
                        sentVia = if (type.digitalByDefault) "digital" else "driver",
                        agreedPrice = lab?.prices?.get(id) ?: draft.agreedPrice,
                    )
                }

                Field(if (arabic) "الوصف" else "Description") {
                    LabField(
                        draft.workDescription,
                        { draft = draft.copy(workDescription = it) },
                        if (arabic) "٢ تاج زيركون، ١٥ و١٤" else "2 x zirconia crown, 15 and 14",
                        arabic,
                    )
                }

                Field(if (arabic) "الأسنان" else "Teeth") {
                    ToothPicker(draft.teeth, arabic) { draft = draft.copy(teeth = it) }
                }

                if (work.units) {
                    Field(if (arabic) "عدد الوحدات" else "Units") {
                        LabField(
                            if (draft.units > 0) draft.units.toString() else "",
                            { draft = draft.copy(units = it.filter(Char::isDigit).toIntOrNull() ?: 0) },
                            "0",
                            arabic,
                            numeric = true,
                        )
                    }
                }

                if (work.bodyShade) {
                    Field(if (arabic) "درجة الجسم" else "Body shade") {
                        ChipRow(LabCases.TOOTH_SHADES.map { it to it }, draft.bodyShade) {
                            draft = draft.copy(bodyShade = if (draft.bodyShade == it) "" else it)
                        }
                    }
                }
                if (work.cervicalShade) {
                    Field(if (arabic) "درجة الرقبة" else "Cervical shade") {
                        ChipRow(LabCases.TOOTH_SHADES.map { it to it }, draft.cervicalShade) {
                            draft = draft.copy(cervicalShade = if (draft.cervicalShade == it) "" else it)
                        }
                    }
                }
                if (work.gumShade) {
                    Field(if (arabic) "لون اللثة" else "Gum shade") {
                        ChipRow(LabCases.GUM_SHADES.map { it to it }, draft.gumShade) {
                            draft = draft.copy(gumShade = if (draft.gumShade == it) "" else it)
                        }
                    }
                }

                Field(if (arabic) "الخامة" else "Material") {
                    LabField(draft.material, { draft = draft.copy(material = it) }, if (arabic) "اختياري" else "optional", arabic)
                }

                if (work.implant) {
                    Field(if (arabic) "نظام الزرعة" else "Implant system") {
                        LabField(draft.implantSystem, { draft = draft.copy(implantSystem = it) }, "Straumann, Nobel, Dentium…", arabic)
                    }
                    Field(if (arabic) "المنصة" else "Platform") {
                        LabField(draft.implantPlatform, { draft = draft.copy(implantPlatform = it) }, "NC, RC, 3.5…", arabic)
                    }
                    Field(if (arabic) "الدعامة" else "Abutment") {
                        ChipRow(LabCases.ABUTMENT_OPTIONS.map { it.id to it.label(arabic) }, draft.abutmentType) {
                            draft = draft.copy(abutmentType = if (draft.abutmentType == it) "" else it)
                        }
                    }
                    Field(if (arabic) "التثبيت" else "Retention") {
                        ChipRow(LabCases.RETENTION_OPTIONS.map { it.id to it.label(arabic) }, draft.retention) {
                            draft = draft.copy(retention = if (draft.retention == it) "" else it)
                        }
                    }
                }

                if (work.guide) {
                    Field(if (arabic) "نوع الدليل" else "Guide type") {
                        ChipRow(LabCases.GUIDE_TYPE_OPTIONS.map { it.id to it.label(arabic) }, draft.guideType) {
                            draft = draft.copy(guideType = if (draft.guideType == it) "" else it)
                        }
                    }
                    Field(if (arabic) "نظام الأكمام" else "Sleeve system") {
                        LabField(draft.sleeveSystem, { draft = draft.copy(sleeveSystem = it) }, if (arabic) "اختياري" else "optional", arabic)
                    }
                }

                // --- how and when ---
                SectionHeading(if (arabic) "الإرسال والموعد" else "SENDING AND DUE DATE")
                Spacer(Modifier.height(8.dp))
                ChipRow(
                    listOf(
                        "driver" to (if (arabic) "مع السائق" else "By driver"),
                        "digital" to (if (arabic) "ملفات رقمية" else "As files"),
                    ),
                    draft.sentVia,
                ) { draft = draft.copy(sentVia = it) }

                Field(if (arabic) "موعد الاستلام" else "Due back") {
                    DateField(draft.dueDate, arabic) { draft = draft.copy(dueDate = it) }
                }

                Field(if (arabic) "السعر المتفق عليه" else "Agreed price") {
                    LabField(
                        if (draft.agreedPrice > 0) draft.agreedPrice.toInt().toString() else "",
                        { draft = draft.copy(agreedPrice = it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
                        if (arabic) "بالجنيه" else "EGP",
                        arabic,
                        numeric = true,
                    )
                }

                SwitchRow(
                    if (arabic) "يحتاج بروفة" else "Needs a try-in",
                    if (arabic) "الحالة هتروح وترجع قبل التركيب النهائي" else "The case comes back once before it is finished",
                    draft.needsTryIn,
                ) { draft = draft.copy(needsTryIn = it) }

                Field(if (arabic) "ملاحظات للفني" else "Notes for the technician") {
                    LabField(draft.notes, { draft = draft.copy(notes = it) }, if (arabic) "اختياري" else "optional", arabic, lines = 3)
                }

                if (editing == null) {
                    Field(if (arabic) "الحالة عند الحفظ" else "Save as") {
                        ChipRow(
                            listOf(
                                "at_lab" to (if (arabic) "في المعمل" else "At lab"),
                                "draft" to (if (arabic) "مسودة" else "Draft"),
                            ),
                            draft.status,
                        ) { draft = draft.copy(status = it) }
                    }
                }

                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Alpha.DangerText)
                }
                Spacer(Modifier.height(20.dp))
            }

            // The one action, always reachable at the bottom of the screen.
            Surface(color = Alpha.Card, shadowElevation = 8.dp, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    val ready = draft.labId.isNotBlank() &&
                        (draft.workDescription.isNotBlank() || draft.teeth.isNotEmpty()) &&
                        (remakeOf == null || remakeReason.isNotBlank())
                    Button(
                        onClick = {
                            val sending = if (draft.status == "at_lab" && draft.sentAt.isBlank()) {
                                draft.copy(sentAt = com.alphadental.clinic.AppViewModel.today())
                            } else draft
                            onSave(sending, remakeReason, remakeFault)
                        },
                        enabled = ready && !saving,
                        shape = Alpha.PillShape,
                        colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                        modifier = Modifier.fillMaxWidth().height(50.dp),
                    ) {
                        if (saving) {
                            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        } else {
                            Text(
                                when {
                                    editing != null -> if (arabic) "حفظ التعديلات" else "Save changes"
                                    remakeOf != null -> if (arabic) "افتح إعادة العمل" else "Raise the remake"
                                    else -> if (arabic) "احفظ الطلب" else "Save the order"
                                },
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 15.sp,
                            )
                        }
                    }
                    if (!ready) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            when {
                                draft.labId.isBlank() -> if (arabic) "اختر المعمل أولاً" else "Choose a lab first"
                                remakeOf != null && remakeReason.isBlank() -> if (arabic) "اكتب سبب الإعادة" else "Say why it is being remade"
                                else -> if (arabic) "اكتب وصف الشغل أو اختر الأسنان" else "Describe the work, or pick the teeth"
                            },
                            fontSize = 11.5.sp,
                            color = Alpha.Slate400,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }

    if (patientPickerOpen) {
        PatientPicker(
            results = patientResults,
            searching = patientSearching,
            arabic = arabic,
            onSearch = onSearchPatients,
            onPick = { patient ->
                draft = draft.copy(patientId = patient.id, patientName = patient.name, patientPhone = patient.phone)
                patientPickerOpen = false
            },
            onClear = {
                draft = draft.copy(patientId = "", patientName = "", patientPhone = "")
                patientPickerOpen = false
            },
            onDismiss = { patientPickerOpen = false },
        )
    }
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

@Composable
private fun Field(label: String, content: @Composable () -> Unit) {
    Spacer(Modifier.height(14.dp))
    Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate600)
    Spacer(Modifier.height(6.dp))
    content()
}

@Composable
private fun LabField(
    value: String,
    onValue: (String) -> Unit,
    hint: String,
    arabic: Boolean,
    numeric: Boolean = false,
    lines: Int = 1,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        placeholder = { Text(hint, color = Alpha.Slate400, fontSize = 13.sp) },
        singleLine = lines == 1,
        maxLines = lines,
        keyboardOptions = if (numeric) KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Alpha.Green,
            unfocusedBorderColor = Alpha.Slate200,
            cursorColor = Alpha.Ink,
            focusedContainerColor = Alpha.Card,
            unfocusedContainerColor = Alpha.Card,
            focusedTextColor = Alpha.Slate900,
            unfocusedTextColor = Alpha.Slate900,
        ),
        shape = Alpha.CardShape,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** A horizontal row of choices. Tapping the selected one clears it, where clearing is allowed. */
@Composable
private fun ChipRow(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    ) {
        options.forEach { (id, label) ->
            val isOn = selected == id
            Surface(
                onClick = { onPick(id) },
                shape = Alpha.PillShape,
                color = if (isOn) Alpha.Ink else Alpha.Card,
                border = if (isOn) null else BorderStroke(1.dp, Alpha.Slate200),
            ) {
                Text(
                    label,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (isOn) Color.White else Alpha.Slate700,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Spacer(Modifier.height(14.dp))
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
            Text(hint, fontSize = 11.5.sp, color = Alpha.Slate500)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = Alpha.Green),
        )
    }
}

/**
 * The date, typed as yyyy-MM-dd with a row of shortcuts.
 *
 * A wheel picker is the obvious thing and the wrong one here: a due date is nearly always "about
 * a week", which is one tap, and the exact-date case still wants the keyboard.
 */
@Composable
private fun DateField(value: String, arabic: Boolean, onValue: (String) -> Unit) {
    Column {
        LabField(value, onValue, "yyyy-mm-dd", arabic)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(3, 5, 7, 10, 14).forEach { days ->
                Surface(
                    onClick = { onValue(LabCases.dueInDays(days)) },
                    shape = Alpha.PillShape,
                    color = Alpha.Card,
                    border = BorderStroke(1.dp, Alpha.Slate200),
                ) {
                    Text(
                        if (arabic) "$days ي" else "${days}d",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate700,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}

/**
 * The FDI chart, as four quadrants of eight.
 *
 * Upper row first and the patient's right on the left, which is how a chart is read when you are
 * facing them — the same order the printed order sheet uses.
 */
@Composable
private fun ToothPicker(selected: List<Int>, arabic: Boolean, onChange: (List<Int>) -> Unit) {
    val upper = listOf(18, 17, 16, 15, 14, 13, 12, 11) + listOf(21, 22, 23, 24, 25, 26, 27, 28)
    val lower = listOf(48, 47, 46, 45, 44, 43, 42, 41) + listOf(31, 32, 33, 34, 35, 36, 37, 38)

    fun toggle(t: Int) {
        onChange(if (selected.contains(t)) selected - t else (selected + t).sorted())
    }

    Column {
        listOf(upper, lower).forEach { row ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp),
            ) {
                row.forEachIndexed { index, tooth ->
                    if (index == 8) Spacer(Modifier.width(8.dp))
                    val on = selected.contains(tooth)
                    Surface(
                        onClick = { toggle(tooth) },
                        shape = Alpha.CardShape,
                        color = if (on) Alpha.Ink else Alpha.Card,
                        border = if (on) null else BorderStroke(1.dp, Alpha.Slate200),
                    ) {
                        Text(
                            tooth.toString(),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (on) Color.White else Alpha.Slate600,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
        if (selected.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    selected.joinToString(", "),
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Green,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { onChange(emptyList()) }) {
                    Text(if (arabic) "مسح" else "Clear", fontSize = 12.sp, color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/** The register, as a picker: the same search the Patients tab uses. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PatientPicker(
    results: List<Patient>,
    searching: Boolean,
    arabic: Boolean,
    onSearch: (String) -> Unit,
    onPick: (Patient) -> Unit,
    onClear: () -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    LaunchedEffect(query) {
        kotlinx.coroutines.delay(300)
        onSearch(query)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Alpha.Card) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
            Text(
                if (arabic) "اختر المريض" else "Choose the patient",
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = AlphaType.Display,
                color = Alpha.Slate900,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text(if (arabic) "الاسم أو رقم الهاتف" else "Name or phone number", color = Alpha.Slate400) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null, tint = Alpha.Slate400) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Alpha.Green,
                    unfocusedBorderColor = Alpha.Slate200,
                    cursorColor = Alpha.Ink,
                    focusedContainerColor = Alpha.Ground,
                    unfocusedContainerColor = Alpha.Ground,
                    focusedTextColor = Alpha.Slate900,
                    unfocusedTextColor = Alpha.Slate900,
                ),
                shape = Alpha.CardShape,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            when {
                searching && results.isEmpty() -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                }
                results.isEmpty() -> Text(
                    if (arabic) "لا يوجد مريض بهذا الاسم." else "No patient matches that.",
                    fontSize = 13.sp,
                    color = Alpha.Slate400,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
                else -> LazyColumn(Modifier.heightIn(max = 340.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(results, key = { it.id }) { patient ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(Alpha.CardShape)
                                .clickable { onPick(patient) }
                                .padding(horizontal = 10.dp, vertical = 10.dp),
                        ) {
                            Box(
                                Modifier.size(34.dp).clip(CircleShape).background(Alpha.GreenSoft),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    patient.name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Alpha.Green,
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(patient.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                if (patient.phone.isNotBlank()) Text(patient.phone, fontSize = 12.sp, color = Alpha.Slate500)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onClear) {
                Text(if (arabic) "بدون مريض" else "No patient", fontWeight = FontWeight.Bold, color = Alpha.Slate500)
            }
        }
    }
}
