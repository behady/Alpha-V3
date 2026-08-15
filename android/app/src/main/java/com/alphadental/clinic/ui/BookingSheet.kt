package com.alphadental.clinic.ui

import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Doctor
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.Patient
import com.alphadental.clinic.data.Service
import com.alphadental.clinic.data.Slot
import kotlinx.coroutines.delay

/** What the sheet is collecting, so the caller can hand it straight to the repository. */
/**
 * Chair-time lengths offered when booking.
 *
 * A short list of round numbers rather than a free minutes field: reception is booking while a
 * patient stands at the desk, and the website's own slot lengths land on these anyway.
 */
private val DURATION_CHOICES = listOf(15, 30, 45, 60, 90)

data class BookingDraft(
    val patient: Patient? = null,
    val doctor: Doctor? = null,
    val time: String = "",
    val treatment: String = "",
    val notes: String = "",
    val newPatientName: String = "",
    val newPatientPhone: String = "",
    val service: Service? = null,
    /** Minutes of chair time. Zero means "use the clinic's slot length". */
    val durationMinutes: Int = 0,
    /** What the visit is expected to cost. Sits on the appointment; it does not post to the ledger. */
    val cost: Double = 0.0,
)

/**
 * Book an appointment, or move an existing one.
 *
 * Deliberately one scrolling sheet rather than a wizard. Reception books while a patient is
 * standing at the desk and often while on the phone; a four-step flow with a Next button on each
 * screen is slower than one form you can see all of.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingSheet(
    dateLabel: String,
    slots: List<Slot>,
    doctors: List<Doctor>,
    /** The clinic's own visit reasons, from Settings → Visit Reasons. */
    visitReasons: List<String>,
    /** The clinic's price list, from Settings → Prices. */
    services: List<Service>,
    searchResults: List<Patient>,
    searching: Boolean,
    saving: Boolean,
    scheduleConfigured: Boolean,
    isOffDay: Boolean,
    /**
     * The appointment being edited, or null when booking a new one.
     *
     * Carried rather than a bare boolean because editing has to show what is already there. The
     * sheet previously offered only a new time slot, so changing a visit's reason, its service,
     * its length or its notes meant opening the website — which is most of what "edit" means.
     */
    editing: Appointment?,
    arabic: Boolean,
    onSearch: (String) -> Unit,
    onSave: (BookingDraft) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val rescheduling = editing != null

    var draft by remember { mutableStateOf(BookingDraft()) }

    // Filled in from the appointment as it stands, so editing starts from what is there rather
    // than from blank fields that would overwrite it on save.
    //
    // Keyed on the doctor and service lists as well as the appointment, and filling only what is
    // still empty. The lists load after the sheet can already be open, and the first version of
    // this ran once against empty lists: the doctor and service resolved to null, never resolved
    // again, and saving an edit then stripped the service off the appointment and zeroed its
    // expected cost — a data loss the person editing had no way to see. Fill-if-empty means a late
    // list arrival completes the form without overwriting anything a human has typed since.
    LaunchedEffect(editing?.id, doctors, services) {
        val current = editing ?: return@LaunchedEffect
        draft = draft.copy(
            doctor = draft.doctor
                ?: doctors.firstOrNull { it.id == current.doctorId || it.name == current.doctor },
            time = draft.time.ifBlank { current.time },
            treatment = draft.treatment.ifBlank { current.treatment },
            notes = draft.notes.ifBlank { current.notes },
            service = draft.service ?: services.firstOrNull { it.id == current.serviceId },
            durationMinutes = if (draft.durationMinutes > 0) draft.durationMinutes else current.duration,
            cost = if (draft.cost > 0) draft.cost else current.cost,
        )
    }
    var query by remember { mutableStateOf("") }
    var creatingPatient by remember { mutableStateOf(false) }

    // Search as they type, but not on every keystroke — a clinic register is a real read.
    // One character is enough, matching the directory and the website.
    LaunchedEffect(query) {
        if (!rescheduling && draft.patient == null && query.isNotBlank()) {
            delay(300)
            onSearch(query)
        }
    }

    val readyToSave = when {
        rescheduling -> draft.time.isNotBlank()
        creatingPatient -> draft.newPatientName.isNotBlank() && draft.time.isNotBlank()
        else -> draft.patient != null && draft.time.isNotBlank()
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = when {
                    rescheduling && arabic -> "تعديل الموعد"
                    rescheduling -> "Edit appointment"
                    arabic -> "حجز موعد"
                    else -> "Book an appointment"
                },
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                color = Alpha.Slate900,
            )
            Text(
                text = dateLabel,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate500,
            )

            // A clinic that never set its hours parses as 09:00–21:00 every day. Say so, rather
            // than presenting invented slots as though they were the clinic's real timetable.
            if (!scheduleConfigured) {
                Spacer(Modifier.height(12.dp))
                Warning(
                    if (arabic) "لم يتم ضبط مواعيد عمل العيادة، لذلك تظهر الأوقات الافتراضية ٩ ص–٩ م."
                    else "This clinic has no working hours set, so these are the default 9am–9pm slots."
                )
            }
            if (isOffDay) {
                Spacer(Modifier.height(12.dp))
                Warning(
                    if (arabic) "هذا اليوم مُسجَّل كإجازة للعيادة."
                    else "This day is marked as a clinic day off."
                )
            }

            Spacer(Modifier.height(18.dp))

            // ---------------------------------------------------------------- patient
            if (!rescheduling) {
                SectionHeading(if (arabic) "المريض" else "PATIENT")
                Spacer(Modifier.height(8.dp))

                when {
                    draft.patient != null -> SelectedPatientRow(
                        patient = draft.patient!!,
                        changeLabel = if (arabic) "تغيير" else "Change",
                        onChange = { draft = draft.copy(patient = null); query = "" },
                    )

                    creatingPatient -> {
                        OutlinedTextField(
                            value = draft.newPatientName,
                            onValueChange = { draft = draft.copy(newPatientName = it) },
                            label = { Text(if (arabic) "اسم المريض" else "Patient name") },
                            singleLine = true,
                            shape = Alpha.CardShape,
                            colors = bookingFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(
                            value = draft.newPatientPhone,
                            onValueChange = { draft = draft.copy(newPatientPhone = it) },
                            label = { Text(if (arabic) "رقم الهاتف" else "Phone number") },
                            singleLine = true,
                            shape = Alpha.CardShape,
                            colors = bookingFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        TextButton(onClick = { creatingPatient = false }) {
                            Text(
                                if (arabic) "بحث عن مريض موجود" else "Search for an existing patient",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate500,
                            )
                        }
                    }

                    else -> {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            label = { Text(if (arabic) "ابحث بالاسم أو الهاتف" else "Search name or phone") },
                            singleLine = true,
                            leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400) },
                            trailingIcon = {
                                if (searching) {
                                    CircularProgressIndicator(
                                        strokeWidth = 2.dp,
                                        color = Alpha.Slate400,
                                        modifier = Modifier.size(18.dp),
                                    )
                                }
                            },
                            shape = Alpha.CardShape,
                            colors = bookingFieldColors(),
                            modifier = Modifier.fillMaxWidth(),
                        )

                        if (searchResults.isNotEmpty()) {
                            Spacer(Modifier.height(8.dp))
                            // Bounded so a long result list cannot push the Save button off the
                            // bottom of a small screen.
                            LazyColumn(Modifier.heightIn(max = 220.dp)) {
                                items(searchResults, key = { it.id }) { patient ->
                                    PatientRow(patient) { draft = draft.copy(patient = patient) }
                                }
                            }
                        }

                        TextButton(onClick = { creatingPatient = true }) {
                            Icon(Icons.Filled.PersonAdd, null, tint = Alpha.Green, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.size(6.dp))
                            Text(
                                if (arabic) "مريض جديد" else "New patient",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Black,
                                color = Alpha.Green,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(18.dp))
            }

            // ----------------------------------------------------------------- doctor
            if (doctors.isNotEmpty()) {
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
                Spacer(Modifier.height(18.dp))
            }

            // ------------------------------------------------------------------ time
            SectionHeading(if (arabic) "الوقت" else "TIME")
            Spacer(Modifier.height(8.dp))

            if (slots.isEmpty()) {
                Warning(
                    if (arabic) "لا توجد أوقات متاحة في هذا اليوم."
                    else "There are no bookable times on this day."
                )
            } else {
                SlotGrid(
                    slots = slots,
                    selected = draft.time,
                    arabic = arabic,
                    onSelect = { draft = draft.copy(time = it) },
                )
            }

            Spacer(Modifier.height(18.dp))

            // ------------------------------------------------------------- what for
            // Shown when editing as well as when booking. These are the fields an appointment is
            // actually changed for once it exists — a patient ringing to say they now want a
            // cleaning rather than a check-up is an edit, not a reschedule.
            run {
                SectionHeading(if (arabic) "سبب الزيارة" else "REASON FOR VISIT")
                Spacer(Modifier.height(8.dp))

                if (visitReasons.isEmpty()) {
                    // Only reachable if the clinic's list failed to load; typing one is better
                    // than a dead end.
                    OutlinedTextField(
                        value = draft.treatment,
                        onValueChange = { draft = draft.copy(treatment = it) },
                        label = { Text(if (arabic) "سبب الزيارة" else "Reason for visit") },
                        singleLine = true,
                        shape = Alpha.CardShape,
                        colors = bookingFieldColors(),
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(visitReasons) { reason ->
                            FilterChip(
                                selected = draft.treatment == reason,
                                onClick = {
                                    draft = draft.copy(treatment = if (draft.treatment == reason) "" else reason)
                                },
                                label = { Text(reason, fontSize = 13.sp, fontWeight = FontWeight.Bold) },
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

                // ------------------------------------------------------------ service
                if (services.isNotEmpty()) {
                    SectionHeading(if (arabic) "الخدمة (اختياري)" else "SERVICE (OPTIONAL)")
                    Spacer(Modifier.height(8.dp))
                    ServicePicker(
                        services = services,
                        selected = draft.service,
                        arabic = arabic,
                        onSelect = { chosen ->
                            // Picking a service carries its price and its chair time across, the
                            // same two things the website fills in. A crown and a check-up are not
                            // the same length, and treating them as such overbooks the day.
                            draft = draft.copy(
                                service = chosen,
                                cost = chosen?.price ?: draft.cost,
                                durationMinutes = chosen?.durationMinutes?.takeIf { it > 0 }
                                    ?: draft.durationMinutes,
                            )
                        },
                    )
                    Spacer(Modifier.height(18.dp))
                }

                // ----------------------------------------------------------- how long
                SectionHeading(if (arabic) "مدة الموعد" else "HOW LONG")
                Spacer(Modifier.height(8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(DURATION_CHOICES) { minutes ->
                        FilterChip(
                            selected = draft.durationMinutes == minutes,
                            onClick = { draft = draft.copy(durationMinutes = minutes) },
                            label = {
                                Text(
                                    if (arabic) "$minutes د" else "$minutes min",
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

                Spacer(Modifier.height(18.dp))

                OutlinedTextField(
                    value = if (draft.cost > 0) draft.cost.toInt().toString() else "",
                    onValueChange = { input ->
                        draft = draft.copy(
                            cost = input.filter { it.isDigit() }.toDoubleOrNull() ?: 0.0
                        )
                    },
                    label = { Text(if (arabic) "التكلفة المتوقعة" else "Expected cost") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    shape = Alpha.CardShape,
                    colors = bookingFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                // Said plainly, because the same number on the clinical-notes screen DOES bill.
                Spacer(Modifier.height(6.dp))
                Text(
                    if (arabic) "رقم متوقع على الموعد فقط — لا يُضاف إلى حساب المريض."
                    else "An expected figure on the appointment only — nothing is charged to the patient.",
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate400,
                )

                Spacer(Modifier.height(18.dp))

                OutlinedTextField(
                    value = draft.notes,
                    onValueChange = { draft = draft.copy(notes = it) },
                    label = { Text(if (arabic) "ملاحظات (اختياري)" else "Notes (optional)") },
                    shape = Alpha.CardShape,
                    colors = bookingFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(20.dp))
            }

            Button(
                onClick = { onSave(draft) },
                enabled = readyToSave && !saving,
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
                        text = when {
                            rescheduling && arabic -> "حفظ التعديل"
                            rescheduling -> "Save changes"
                            arabic -> "تأكيد الحجز"
                            else -> "Book appointment"
                        },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }

            // The website messages the patient when a booking is made or moved. That runs through
            // the server, which this app deliberately does not call — so it says so rather than
            // letting a receptionist assume the patient was told.
            Spacer(Modifier.height(10.dp))
            Text(
                text = if (arabic)
                    "لن تُرسل رسالة للمريض تلقائياً من التطبيق — استخدم زر واتساب من الموعد بعد الحفظ."
                else
                    "The patient is not messaged automatically from the app — use the WhatsApp button on the appointment afterwards.",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }
}

/**
 * The slot picker.
 *
 * A taken slot is shown and disabled rather than hidden, with the name of whoever holds it. Hiding
 * it would leave a silent gap in the day that reads as "the clinic is closed then" — staff need to
 * see that 3pm exists and is occupied, so they can decide whether to double-book or move someone.
 */
@Composable
private fun SlotGrid(
    slots: List<Slot>,
    selected: String,
    arabic: Boolean,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        slots.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { slot ->
                    val isSelected = slot.time == selected
                    Surface(
                        shape = Alpha.CardShape,
                        color = when {
                            isSelected -> Alpha.Ink
                            slot.isFree -> Alpha.Slate50
                            else -> Color(0xFFFFF1F2)
                        },
                        modifier = Modifier.weight(1f),
                    ) {
                        TextButton(
                            onClick = { if (slot.isFree) onSelect(slot.time) },
                            enabled = slot.isFree,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    slot.time,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Black,
                                    color = when {
                                        isSelected -> Color.White
                                        slot.isFree -> Alpha.Slate700
                                        else -> Color(0xFF9F1239)
                                    },
                                )
                                if (!slot.isFree) {
                                    Text(
                                        slot.takenBy.orEmpty(),
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFF9F1239).copy(alpha = .75f),
                                        maxLines = 1,
                                    )
                                }
                            }
                        }
                    }
                }
                // Keep the last row's columns the same width as every other row.
                repeat(3 - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * Pick one entry from the price list.
 *
 * Searchable rather than a plain list, because a clinic's price list runs to dozens of entries and
 * scrolling it one-handed at the desk is slower than typing three letters. The price is shown on
 * every row: the person booking is usually being asked "how much will that be?" at the same moment.
 */
@Composable
private fun ServicePicker(
    services: List<Service>,
    selected: Service?,
    arabic: Boolean,
    onSelect: (Service?) -> Unit,
) {
    var filter by remember { mutableStateOf("") }

    if (selected != null) {
        Surface(shape = Alpha.CardShape, color = Alpha.GreenSoft, modifier = Modifier.fillMaxWidth()) {
            Row(
                Modifier.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(selected.name, fontSize = 15.sp, fontWeight = FontWeight.Black, color = Alpha.Slate900)
                    Text(
                        buildString {
                            append("${selected.price.toInt()} EGP")
                            if (selected.durationMinutes > 0) append("  ·  ${selected.durationMinutes} min")
                        },
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                    )
                }
                TextButton(onClick = { onSelect(null); filter = "" }) {
                    Text(
                        if (arabic) "إزالة" else "Remove",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Green,
                    )
                }
            }
        }
        return
    }

    val matches = remember(filter, services) {
        if (filter.isBlank()) services else services.filter { it.name.contains(filter.trim(), ignoreCase = true) }
    }

    OutlinedTextField(
        value = filter,
        onValueChange = { filter = it },
        label = { Text(if (arabic) "ابحث في قائمة الأسعار" else "Search the price list") },
        singleLine = true,
        leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400) },
        shape = Alpha.CardShape,
        colors = bookingFieldColors(),
        modifier = Modifier.fillMaxWidth(),
    )

    Spacer(Modifier.height(6.dp))

    if (matches.isEmpty()) {
        Text(
            if (arabic) "لا توجد خدمة بهذا الاسم." else "No service matches that.",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = Alpha.Slate400,
            modifier = Modifier.padding(4.dp),
        )
    } else {
        // Bounded so a long price list cannot push the Book button off the screen.
        LazyColumn(Modifier.heightIn(max = 200.dp)) {
            items(matches, key = { it.id }) { service ->
                Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.Slate50,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp),
                ) {
                    TextButton(onClick = { onSelect(service) }, modifier = Modifier.fillMaxWidth()) {
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
}

@Composable
private fun PatientRow(patient: Patient, onClick: () -> Unit) {
    Surface(
        shape = Alpha.CardShape,
        color = Alpha.Slate50,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
    ) {
        TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Person, null, tint = Alpha.Slate400, modifier = Modifier.size(16.dp))
            Spacer(Modifier.size(10.dp))
            Column(Modifier.weight(1f)) {
                Text(patient.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate800)
                if (patient.phone.isNotBlank()) {
                    Text(patient.phone, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
                }
            }
        }
    }
}

@Composable
private fun SelectedPatientRow(patient: Patient, changeLabel: String, onChange: () -> Unit) {
    Surface(shape = Alpha.CardShape, color = Alpha.GreenSoft, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(patient.name, fontSize = 15.sp, fontWeight = FontWeight.Black, color = Alpha.Slate900)
                if (patient.phone.isNotBlank()) {
                    Text(patient.phone, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
                }
            }
            TextButton(onClick = onChange) {
                Text(changeLabel, fontSize = 12.sp, fontWeight = FontWeight.Black, color = Alpha.Green)
            }
        }
    }
}

@Composable
private fun Warning(text: String) {
    Surface(shape = Alpha.CardShape, color = Color(0xFFFEF3C7), modifier = Modifier.fillMaxWidth()) {
        Text(
            text,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF92400E),
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
private fun bookingFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Color.White,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)
