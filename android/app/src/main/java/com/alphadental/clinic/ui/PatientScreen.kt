package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.MedicalServices
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.ClinicalNote
import com.alphadental.clinic.data.OrthoCase
import com.alphadental.clinic.data.PatientFile
import com.alphadental.clinic.data.PatientMedia
import com.alphadental.clinic.data.Prescription
import com.alphadental.clinic.data.parseTeeth
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * One patient, as a full page — the phone's version of the website's patient
 * profile. It replaced a single overloaded bottom sheet on 2026-08-17.
 *
 * Seven tabs, opening on Overview: the at-a-glance answer to "who is this and
 * where do we stand", then Clinical (teeth chart and treatment record),
 * Diagnosis (the website's tooth chart, read-only), Finance (the patient's own
 * statement), Photos (what the website uploaded), Ortho, and Prescriptions.
 */
@Composable
fun PatientScreen(
    file: PatientFile?,
    loading: Boolean,
    error: String?,
    arabic: Boolean,
    media: List<PatientMedia>,
    ortho: List<OrthoCase>,
    /** Null when this user may not take payments, so no button is shown at all. */
    onTakePayment: (() -> Unit)?,
    notes: List<ClinicalNote>,
    /** Null when this user may not record treatment. */
    onAddNote: (() -> Unit)?,
    prescriptions: List<Prescription>,
    /** Null when this user may not prescribe. */
    onWriteRx: (() -> Unit)?,
    /** Null when this user may not change a recorded procedure. */
    onSetNoteStatus: ((noteId: String, status: String) -> Unit)?,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    BackHandler { onClose() }

    var viewingImage by remember { mutableStateOf<PatientMedia?>(null) }

    viewingImage?.let { image ->
        Dialog(onDismissRequest = { viewingImage = null }) {
            Surface(shape = Alpha.CardShape, color = Alpha.Card) {
                Column(Modifier.padding(10.dp)) {
                    AsyncImage(
                        model = image.url,
                        contentDescription = image.filename,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(Alpha.CardShape),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        listOfNotNull(
                            image.category.takeIf { it.isNotBlank() },
                            prettyFileDate(image.createdAtMillis, arabic),
                            image.uploadedBy.takeIf { it.isNotBlank() },
                        ).joinToString("  ·  "),
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                    )
                }
            }
        }
    }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            when {
                loading -> {
                    HeaderBar(onClose)
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                    }
                }

                error != null -> {
                    HeaderBar(onClose)
                    Surface(
                        shape = Alpha.CardShape,
                        color = Alpha.DangerSoft,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                    ) {
                        Text(
                            error,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.DangerText,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }

                file != null -> {
                    // Header: back, identity, reach-them buttons.
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(start = 4.dp, end = 10.dp, top = 4.dp),
                    ) {
                        IconButton(onClick = onClose) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                        }
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .clip(CircleShape)
                                .background(Alpha.GreenSoft),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                file.patient.name.trim().firstOrNull()?.uppercase() ?: "•",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Green,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                file.patient.name.ifBlank { if (arabic) "بدون اسم" else "No name" },
                                fontSize = 17.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Alpha.Slate900,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(
                                    file.fileId.takeIf { it.isNotBlank() },
                                    file.patient.phone.takeIf { it.isNotBlank() },
                                ).joinToString("  ·  ").ifBlank { if (arabic) "لا يوجد هاتف" else "no phone" },
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Alpha.Slate400,
                                maxLines = 1,
                            )
                        }
                        if (file.patient.phone.isNotBlank()) {
                            IconButton(onClick = { context.dialNumber(file.patient.phone) }) {
                                Icon(Icons.Filled.Phone, contentDescription = if (arabic) "اتصال" else "Call", tint = Alpha.Green, modifier = Modifier.size(20.dp))
                            }
                            IconButton(onClick = { context.openWhatsApp(file.patient.phone) }) {
                                Icon(Icons.Filled.Chat, contentDescription = "WhatsApp", tint = Alpha.Green, modifier = Modifier.size(20.dp))
                            }
                        }
                    }

                    var tab by rememberSaveable { mutableStateOf("overview") }

                    val tabs = listOf(
                        TabSpec("overview", if (arabic) "نظرة عامة" else "Overview", Icons.Filled.Dashboard),
                        TabSpec("clinical", if (arabic) "السجل" else "Clinical", Icons.Filled.MedicalServices),
                        TabSpec("diagnosis", if (arabic) "التشخيص" else "Diagnosis", Icons.Filled.Assignment),
                        TabSpec("finance", if (arabic) "المالية" else "Finance", Icons.Filled.Payments),
                        TabSpec("photos", if (arabic) "الصور" else "Photos", Icons.Filled.PhotoLibrary),
                        TabSpec("ortho", if (arabic) "التقويم" else "Ortho", Icons.Filled.Timeline),
                        TabSpec("rx", if (arabic) "الروشتات" else "Rx", Icons.Filled.Medication),
                    )

                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        items(tabs, key = { it.id }) { spec ->
                            val selected = tab == spec.id
                            Surface(
                                onClick = { tab = spec.id },
                                shape = Alpha.PillShape,
                                color = if (selected) Alpha.Ink else Alpha.Card,
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                                ) {
                                    Icon(
                                        spec.icon,
                                        contentDescription = null,
                                        tint = if (selected) Color.White else Alpha.Slate400,
                                        modifier = Modifier.size(15.dp),
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        spec.label,
                                        fontSize = 12.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = if (selected) Color.White else Alpha.Slate600,
                                    )
                                }
                            }
                        }
                    }

                    Box(Modifier.weight(1f)) {
                        when (tab) {
                            "overview" -> OverviewTab(
                                file, notes, media, arabic, onTakePayment, onAddNote, onWriteRx,
                                onSeeFinance = { tab = "finance" },
                            )
                            "clinical" -> ClinicalTab(file, notes, arabic, onAddNote, onSetNoteStatus)
                            "diagnosis" -> DiagnosisTab(file, arabic)
                            "finance" -> FinanceTab(file, arabic, onTakePayment)
                            "photos" -> PhotosTab(media, arabic) { viewingImage = it }
                            "ortho" -> OrthoTab(ortho, arabic)
                            "rx" -> RxTab(prescriptions, arabic, onWriteRx)
                        }
                    }
                }
            }
        }
    }
}

private data class TabSpec(val id: String, val label: String, val icon: ImageVector)

@Composable
private fun HeaderBar(onClose: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
        IconButton(onClick = onClose) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
        }
    }
}

// ---------------------------------------------------------------------------
// Overview — where do we stand with this patient, in one screen.
// ---------------------------------------------------------------------------

@Composable
private fun OverviewTab(
    file: PatientFile,
    notes: List<ClinicalNote>,
    media: List<PatientMedia>,
    arabic: Boolean,
    onTakePayment: (() -> Unit)?,
    onAddNote: (() -> Unit)?,
    onWriteRx: (() -> Unit)?,
    onSeeFinance: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp),
    ) {
        Box(Modifier.clickable(onClick = onSeeFinance)) {
            BalanceCard(file, arabic)
        }

        if (onTakePayment != null && (file.balance.owed > 0 || file.balance.inCredit)) {
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = onTakePayment,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Icon(Icons.Filled.AccountBalanceWallet, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(if (arabic) "تسجيل دفعة" else "Take a payment", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile(
                value = file.past.size.toString(),
                caption = if (arabic) "زيارة" else "Visits",
                modifier = Modifier.weight(1f),
            )
            StatTile(
                value = notes.size.toString(),
                caption = if (arabic) "إجراء" else "Procedures",
                modifier = Modifier.weight(1f),
            )
            StatTile(
                value = media.size.toString(),
                caption = if (arabic) "صورة" else "Photos",
                modifier = Modifier.weight(1f),
            )
        }

        // What is booked next — the front desk's most common question after money.
        file.upcoming.firstOrNull()?.let { next ->
            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "الموعد القادم" else "NEXT APPOINTMENT")
            Spacer(Modifier.height(6.dp))
            AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                Box(Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) { VisitRow(next, arabic) }
            }
        }

        if (notes.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "آخر العلاجات" else "RECENT TREATMENT")
            Spacer(Modifier.height(6.dp))
            notes.take(3).forEach { NoteRow(it, arabic, onSetStatus = null) }
        }

        if (onAddNote != null || onWriteRx != null) {
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (onAddNote != null) {
                    OutlinedButton(onClick = onAddNote, shape = Alpha.CardShape, modifier = Modifier.weight(1f)) {
                        Text(
                            if (arabic) "+ إجراء" else "+ Procedure",
                            fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate700,
                        )
                    }
                }
                if (onWriteRx != null) {
                    OutlinedButton(onClick = onWriteRx, shape = Alpha.CardShape, modifier = Modifier.weight(1f)) {
                        Text(
                            if (arabic) "+ روشتة" else "+ Prescription",
                            fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate700,
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Clinical — the teeth chart and the treatment record.
// ---------------------------------------------------------------------------

@Composable
private fun ClinicalTab(
    file: PatientFile,
    notes: List<ClinicalNote>,
    arabic: Boolean,
    onAddNote: (() -> Unit)?,
    onSetNoteStatus: ((noteId: String, status: String) -> Unit)?,
) {
    var selectedTooth by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp),
    ) {
        TeethChart(
            notes = notes,
            arabic = arabic,
            selectedTooth = selectedTooth,
            onSelectTooth = { selectedTooth = it },
        )

        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionHeading(if (arabic) "العلاج" else "TREATMENT", Modifier.weight(1f))
            if (onAddNote != null) {
                TextButton(onClick = onAddNote) {
                    Text(
                        if (arabic) "+ إضافة" else "+ Add",
                        fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Green,
                    )
                }
            }
        }
        Spacer(Modifier.height(4.dp))

        // Matched against the teeth a note actually names, not its raw stored value: a note on
        // "16,17" belongs under both, and comparing the whole string found neither.
        val shownNotes = selectedTooth?.let { t -> notes.filter { t in parseTeeth(it.tooth) } } ?: notes

        if (shownNotes.isEmpty()) {
            Text(
                if (selectedTooth != null) {
                    if (arabic) "لا توجد إجراءات على هذا السن." else "Nothing recorded on this tooth."
                } else if (arabic) "لا توجد إجراءات مسجلة." else "No procedures recorded.",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate400,
            )
        } else {
            shownNotes.forEach { NoteRow(it, arabic, onSetNoteStatus) }
        }

        if (file.past.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            SectionHeading(if (arabic) "الزيارات السابقة" else "PAST VISITS")
            Spacer(Modifier.height(6.dp))
            file.past.take(15).forEach { VisitRow(it, arabic) }
        }
    }
}

// ---------------------------------------------------------------------------
// Diagnosis — the website's tooth chart, readable here.
// ---------------------------------------------------------------------------

@Composable
private fun DiagnosisTab(file: PatientFile, arabic: Boolean) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp),
    ) {
        if (file.diagnosis.isEmpty()) {
            EmptyState(
                if (arabic) "لا يوجد تشخيص مسجل بعد. مخطط التشخيص يُملأ من الموقع."
                else "No diagnosis recorded yet. The diagnosis chart is filled in on the website.",
            )
            return
        }

        Text(
            if (arabic) "يُعدل التشخيص من الموقع؛ هنا للقراءة."
            else "Edited on the website; read-only here.",
            fontSize = 11.5.sp,
            fontWeight = FontWeight.Medium,
            color = Alpha.Slate400,
        )
        Spacer(Modifier.height(10.dp))

        file.diagnosis.forEach { tooth ->
            AlphaCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
                shape = Alpha.CardShape,
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(Alpha.CardShape)
                            .background(Alpha.Slate100),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            tooth.tooth,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Alpha.Slate700,
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        if (tooth.statuses.isNotEmpty()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                tooth.statuses.take(3).forEach { status ->
                                    Surface(shape = Alpha.PillShape, color = Alpha.WarnBg) {
                                        Text(
                                            status,
                                            fontSize = 10.5.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Alpha.WarnText,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                        )
                                    }
                                }
                            }
                        }
                        if (tooth.notes.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                tooth.notes,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium,
                                color = Alpha.Slate600,
                            )
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Finance — this patient's own statement.
// ---------------------------------------------------------------------------

@Composable
private fun FinanceTab(file: PatientFile, arabic: Boolean, onTakePayment: (() -> Unit)?) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp),
    ) {
        BalanceCard(file, arabic)

        if (onTakePayment != null) {
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = onTakePayment,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Icon(Icons.Filled.AccountBalanceWallet, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(if (arabic) "تسجيل دفعة" else "Take a payment", fontSize = 15.sp, fontWeight = FontWeight.ExtraBold)
            }
        }

        Spacer(Modifier.height(16.dp))
        SectionHeading(if (arabic) "كشف الحساب" else "STATEMENT")
        Spacer(Modifier.height(6.dp))

        if (file.ledger.isEmpty()) {
            EmptyState(if (arabic) "لا توجد حركات مالية." else "No money has moved yet.")
        } else {
            file.ledger.forEach { entry ->
                AlphaCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp),
                    shape = Alpha.CardShape,
                ) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                entry.description.ifBlank { if (entry.isPayment) "Payment" else "Charge" },
                                fontSize = 13.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate900,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                listOfNotNull(
                                    prettyVisitDate(entry.date, arabic).takeIf { entry.date.isNotBlank() },
                                    entry.addedBy.takeIf { it.isNotBlank() },
                                ).joinToString("  ·  "),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                color = Alpha.Slate400,
                            )
                        }
                        Text(
                            (if (entry.isPayment) "+" else "-") + entry.amount.toInt(),
                            fontSize = 14.5.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = if (entry.isPayment) Alpha.Green else Alpha.Slate600,
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Photos — what the website uploaded, viewable full-screen.
// ---------------------------------------------------------------------------

@Composable
private fun PhotosTab(media: List<PatientMedia>, arabic: Boolean, onOpen: (PatientMedia) -> Unit) {
    if (media.isEmpty()) {
        Column(Modifier.padding(16.dp)) {
            EmptyState(
                if (arabic) "لا توجد صور أو أشعة لهذا المريض. الرفع يتم من الموقع."
                else "No photos or x-rays for this patient. Uploading happens on the website.",
            )
        }
        return
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(media, key = { it.id }) { item ->
            Box(
                Modifier
                    .aspectRatio(1f)
                    .clip(Alpha.CardShape)
                    .background(Alpha.Slate100)
                    .clickable { onOpen(item) },
            ) {
                AsyncImage(
                    model = item.url,
                    contentDescription = item.filename,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                if (item.category.isNotBlank()) {
                    Surface(
                        shape = Alpha.PillShape,
                        color = Color(0xAA10201B),
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(5.dp),
                    ) {
                        Text(
                            item.category,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Ortho — this patient's cases and their visit log.
// ---------------------------------------------------------------------------

@Composable
private fun OrthoTab(cases: List<OrthoCase>, arabic: Boolean) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp),
    ) {
        if (cases.isEmpty()) {
            EmptyState(if (arabic) "لا توجد حالة تقويم لهذا المريض." else "No ortho case for this patient.")
            return
        }

        cases.forEach { case ->
            AlphaCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 10.dp),
                shape = Alpha.CardShape,
            ) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            case.diagnosis.ifBlank { if (arabic) "حالة تقويم" else "Ortho case" },
                            fontSize = 14.5.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Alpha.Slate900,
                            modifier = Modifier.weight(1f),
                        )
                        Surface(
                            shape = Alpha.PillShape,
                            color = if (case.status == "Active") Alpha.GreenSoft else Alpha.Slate100,
                        ) {
                            Text(
                                case.status,
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (case.status == "Active") Alpha.Green else Alpha.Slate600,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            )
                        }
                    }
                    if (case.startDate.isNotBlank()) {
                        Text(
                            (if (arabic) "بدأت " else "Started ") + prettyVisitDate(case.startDate, arabic),
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                        )
                    }
                    if (case.visits.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        case.visits.sortedByDescending { it.visitNo }.forEach { visit ->
                            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(26.dp)
                                        .clip(CircleShape)
                                        .background(Alpha.Slate100),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "${visit.visitNo}",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate600,
                                    )
                                }
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        visit.workDone.ifBlank { "—" },
                                        fontSize = 12.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Alpha.Slate800,
                                    )
                                    Text(
                                        listOfNotNull(
                                            visit.date.takeIf { it.isNotBlank() }?.let { prettyVisitDate(it, arabic) },
                                            visit.nextStep.takeIf { it.isNotBlank() }?.let {
                                                (if (arabic) "التالي: " else "next: ") + it
                                            },
                                        ).joinToString("  ·  "),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Alpha.Slate400,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

@Composable
private fun RxTab(prescriptions: List<Prescription>, arabic: Boolean, onWriteRx: (() -> Unit)?) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(bottom = 24.dp),
    ) {
        if (onWriteRx != null) {
            Button(
                onClick = onWriteRx,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(46.dp),
            ) {
                Text(if (arabic) "كتابة روشتة" else "Write a prescription", fontSize = 14.sp, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(Modifier.height(12.dp))
        }

        if (prescriptions.isEmpty()) {
            EmptyState(if (arabic) "لا توجد روشتات." else "No prescriptions.")
        } else {
            prescriptions.forEach { rx ->
                AlphaCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp),
                    shape = Alpha.CardShape,
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            // The medicines themselves are the identifying detail —
                            // a list of dates would make every prescription look alike.
                            rx.drugs.joinToString(" · ") { it.name }.ifBlank { "—" },
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate800,
                        )
                        Text(
                            listOfNotNull(
                                rx.date.takeIf { it.isNotBlank() },
                                rx.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
                            ).joinToString("  ·  "),
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Shared pieces (carried over from the old sheet)
// ---------------------------------------------------------------------------

/**
 * What the patient owes.
 *
 * A credit is shown as a credit rather than a negative debt — someone who prepaid should not be
 * chased, and "owes -200" is exactly the kind of thing that gets misread at a busy desk.
 */
@Composable
private fun BalanceCard(file: PatientFile, arabic: Boolean) {
    val balance = file.balance
    val settled = !balance.inCredit && balance.owed <= 0.0

    Surface(
        shape = Alpha.CardShape,
        color = when {
            balance.owed > 0 -> Alpha.WarnBg
            balance.inCredit -> Alpha.GreenSoft
            else -> Alpha.Slate50
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    when {
                        balance.owed > 0 && arabic -> "المستحق"
                        balance.owed > 0 -> "Outstanding"
                        balance.inCredit && arabic -> "رصيد دائن"
                        balance.inCredit -> "In credit"
                        arabic -> "الحساب مسدد"
                        else -> "Settled"
                    },
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Alpha.Slate500,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    when {
                        balance.owed > 0 -> "${balance.owed.toInt()} EGP"
                        balance.inCredit -> "${balance.creditAmount.toInt()} EGP"
                        else -> if (arabic) "لا شيء" else "Nothing owed"
                    },
                    fontSize = 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = when {
                        balance.owed > 0 -> Alpha.WarnText
                        balance.inCredit -> Alpha.Green
                        else -> Alpha.Slate600
                    },
                )
            }
            if (!settled) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${if (arabic) "إجمالي" else "Charged"} ${balance.charged.toInt()}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                    )
                    Text(
                        "${if (arabic) "مدفوع" else "Paid"} ${balance.paid.toInt()}",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                    )
                }
            }
        }
    }
}

/**
 * One recorded procedure.
 *
 * A cost with no ledger link is called out, because that is precisely what the website's Collect
 * Dues screen reports as treated-but-never-invoiced — money the clinic has earned and not asked
 * for. Better seen here, on the patient, than discovered in a report weeks later.
 */
@Composable
private fun NoteRow(
    note: ClinicalNote,
    arabic: Boolean,
    onSetStatus: ((noteId: String, status: String) -> Unit)? = null,
) {
    // Correcting a status is the one edit worth having on a phone: a procedure marked Planned that
    // was actually finished is the difference between a treatment plan that reflects the mouth and
    // one nobody trusts. Deeper edits stay on the website, where there is room to do them safely.
    var expanded by remember { mutableStateOf(false) }

    Surface(
        shape = Alpha.CardShape,
        color = Alpha.Card,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .then(if (onSetStatus != null) Modifier.clickable { expanded = !expanded } else Modifier),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    note.procedure.ifBlank { "—" },
                    fontSize = 14.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Alpha.Slate900,
                    modifier = Modifier.weight(1f),
                )
                NoteStatusPill(note.status, arabic)
            }

            val detail = listOfNotNull(
                note.tooth.takeIf { it.isNotBlank() && it != "Gen" }?.let { (if (arabic) "سن " else "Tooth ") + it },
                note.date.takeIf { it.isNotBlank() },
                note.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
            ).joinToString("  ·  ")
            if (detail.isNotBlank()) {
                Text(detail, fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
            }

            if (note.note.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(note.note, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate600)
            }

            if (note.cost > 0) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${note.cost.toInt()} EGP",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate700,
                    )
                    if (note.ledgerId.isBlank()) {
                        Spacer(Modifier.size(8.dp))
                        Surface(shape = Alpha.PillShape, color = Alpha.DangerSoft) {
                            Text(
                                if (arabic) "لم يُفوتر" else "not invoiced",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Alpha.DangerText,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            if (expanded && onSetStatus != null) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    NOTE_STATUSES.forEach { status ->
                        val current = note.status == status
                        Surface(
                            shape = Alpha.PillShape,
                            color = if (current) Alpha.Ink else Alpha.Slate100,
                            modifier = Modifier.clickable(enabled = !current) {
                                onSetStatus(note.id, status)
                                expanded = false
                            },
                        ) {
                            Text(
                                noteStatusLabel(status, arabic),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = if (current) Color.White else Alpha.Slate600,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NoteStatusPill(status: String, arabic: Boolean) {
    val (bg, fg) = when (status) {
        "Completed" -> Alpha.GreenSoft to Alpha.Green
        "Ongoing" -> Alpha.WarnBg to Alpha.WarnText
        else -> Alpha.Slate100 to Alpha.Slate600
    }
    Surface(shape = Alpha.PillShape, color = bg) {
        Text(
            noteStatusLabel(status, arabic),
            fontSize = 10.sp,
            fontWeight = FontWeight.ExtraBold,
            color = fg,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun VisitRow(visit: Appointment, arabic: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                prettyVisitDate(visit.date, arabic),
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate800,
            )
            val detail = listOfNotNull(
                visit.time.takeIf { it.isNotBlank() },
                visit.treatment.takeIf { it.isNotBlank() },
                visit.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
            ).joinToString(" · ")
            if (detail.isNotBlank()) {
                Text(detail, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate400)
            }
        }
        StatusPill(visit.status, arabic)
    }
}

private fun prettyVisitDate(dateKey: String, arabic: Boolean): String {
    if (dateKey.isBlank()) return "—"
    val parsed = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey) }.getOrNull()
        ?: return dateKey
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    return SimpleDateFormat("d MMM yyyy", locale).format(parsed)
}

private fun prettyFileDate(millis: Long, arabic: Boolean): String? {
    if (millis <= 0) return null
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    return SimpleDateFormat("d MMM yyyy", locale).format(java.util.Date(millis))
}

private fun Context.dialNumber(phone: String) {
    runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.trim()}"))) }
}

private fun Context.openWhatsApp(phone: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))) }
}
