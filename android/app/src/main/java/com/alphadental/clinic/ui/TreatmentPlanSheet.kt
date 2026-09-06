package com.alphadental.clinic.ui

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicSettings
import com.alphadental.clinic.data.TreatmentPlans

/**
 * Treatment plans, where the conversation about them happens.
 *
 * A plan is drawn up and then shown to the person in the chair — "this is what needs doing, in
 * this order, and this is what it comes to". That is a chairside conversation, and the phone is
 * what is chairside, so this screen writes plans rather than only listing them.
 *
 * A plan is split into visits because that is how a patient understands it: not a wall of
 * treatments and one large number, but "three appointments, and here is what happens at each".
 * The running total sits at the bottom of the editor for the same reason it does on the website:
 * the number moves as the plan is built, so nobody is surprised by it at the end.
 */
@Composable
fun TreatmentPlanScreen(
    patientName: String,
    plans: List<TreatmentPlans.Plan>,
    services: List<ClinicSettings.ServiceRow>,
    loading: Boolean,
    saving: Boolean,
    error: String?,
    arabic: Boolean,
    /** Null when this account may not record treatment, which is the same key the notes use. */
    onSave: ((planId: String, title: String, description: String, visits: List<TreatmentPlans.Visit>) -> Unit)?,
    onSetStatus: (TreatmentPlans.Plan, String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }
    var editing by remember { mutableStateOf<TreatmentPlans.Plan?>(null) }
    var creating by remember { mutableStateOf(false) }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize()) {
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
                            if (arabic) "خطط العلاج" else "Treatment plans",
                            fontSize = 19.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Alpha.Slate900,
                            fontFamily = AlphaType.Display,
                        )
                        Text(patientName, fontSize = 12.sp, color = Alpha.Slate500, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }

                error?.let {
                    Text(
                        it,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.DangerText,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }

                when {
                    loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Alpha.Ink)
                    }
                    plans.isEmpty() -> Box(Modifier.fillMaxSize().padding(16.dp)) {
                        EmptyState(
                            if (onSave != null) {
                                if (arabic) "لا توجد خطط بعد. اضغط \"خطة جديدة\"." else "No plans yet. Tap New plan."
                            } else if (arabic) "لا توجد خطط علاج لهذا المريض." else "No treatment plans for this patient."
                        )
                    }
                    else -> LazyColumn(
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 90.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(plans, key = { it.id }) { plan ->
                            PlanCard(
                                plan = plan,
                                arabic = arabic,
                                onEdit = if (onSave != null) ({ editing = plan }) else null,
                                onSetStatus = { onSetStatus(plan, it) },
                            )
                        }
                    }
                }
            }

            if (onSave != null) {
                Button(
                    onClick = { creating = true },
                    shape = Alpha.PillShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                    modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(20.dp),
                ) {
                    Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (arabic) "خطة جديدة" else "New plan", fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }

    val open = editing
    if (creating || open != null) {
        PlanEditor(
            plan = open,
            services = services,
            saving = saving,
            arabic = arabic,
            onSave = { title, description, visits ->
                onSave?.invoke(open?.id.orEmpty(), title, description, visits)
                editing = null
                creating = false
            },
            onDismiss = { editing = null; creating = false },
        )
    }
}

@Composable
private fun PlanCard(
    plan: TreatmentPlans.Plan,
    arabic: Boolean,
    onEdit: (() -> Unit)?,
    onSetStatus: (String) -> Unit,
) {
    val (bg, fg) = when (plan.status) {
        "accepted" -> Alpha.GreenSoft to Alpha.Green
        "presented" -> Alpha.WarnBg to Alpha.WarnText
        "declined" -> Alpha.DangerSoft to Alpha.DangerText
        else -> Alpha.Slate100 to Alpha.Slate600
    }
    AlphaCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        plan.title.ifBlank { if (arabic) "خطة علاج" else "Treatment plan" },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        buildString {
                            append(if (arabic) "${plan.visits.size} زيارة" else "${plan.visits.size} visit${if (plan.visits.size == 1) "" else "s"}")
                            val steps = plan.visits.sumOf { it.steps.size }
                            append(" · ")
                            append(if (arabic) "$steps خطوة" else "$steps step${if (steps == 1) "" else "s"}")
                            if (plan.source == "ai") append(if (arabic) " · اقتراح ذكي" else " · AI proposed")
                        },
                        fontSize = 11.5.sp,
                        color = Alpha.Slate500,
                    )
                }
                Surface(shape = Alpha.PillShape, color = bg) {
                    Text(
                        TreatmentPlans.statusLabel(plan.status, arabic),
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = fg,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }

            if (plan.description.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(plan.description, fontSize = 12.5.sp, color = Alpha.Slate600, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }

            Spacer(Modifier.height(10.dp))
            plan.visits.forEachIndexed { index, visit ->
                Row(modifier = Modifier.padding(vertical = 3.dp)) {
                    Box(
                        Modifier.size(20.dp).clip(CircleShape).background(Alpha.Slate100),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("${index + 1}", fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate600)
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            visit.label.ifBlank { if (arabic) "زيارة ${index + 1}" else "Visit ${index + 1}" },
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate800,
                        )
                        visit.steps.forEach { step ->
                            Text(
                                buildString {
                                    append(step.serviceName)
                                    if (step.teeth.isNotBlank()) append(" · ").append(step.teeth)
                                    if (step.quantity > 1) append(" × ").append(step.quantity)
                                },
                                fontSize = 11.5.sp,
                                color = Alpha.Slate500,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${plan.total.toInt()} ${if (arabic) "ج.م" else plan.currency}",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                    modifier = Modifier.weight(1f),
                )
                onEdit?.let {
                    TextButton(onClick = it) {
                        Text(if (arabic) "تعديل" else "Edit", fontWeight = FontWeight.Bold, color = Alpha.Slate600)
                    }
                }
            }

            // Where the plan has got to with the patient, changed in one tap.
            Spacer(Modifier.height(4.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                TreatmentPlans.STATUSES.forEach { status ->
                    val on = plan.status == status
                    Surface(
                        onClick = { if (!on) onSetStatus(status) },
                        shape = Alpha.PillShape,
                        color = if (on) Alpha.Ink else Alpha.Ground,
                        border = if (on) null else BorderStroke(1.dp, Alpha.Slate200),
                    ) {
                        Text(
                            TreatmentPlans.statusLabel(status, arabic),
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (on) Color.White else Alpha.Slate600,
                            modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Building the plan.
 *
 * Steps are added from the clinic's own price list, never typed free-hand with a made-up figure —
 * the price a patient is quoted has to be the price the clinic charges, and the ledger later
 * agrees with it. A step can still have its price corrected afterwards, because a discount is a
 * real thing, but it starts from the list.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanEditor(
    plan: TreatmentPlans.Plan?,
    services: List<ClinicSettings.ServiceRow>,
    saving: Boolean,
    arabic: Boolean,
    onSave: (title: String, description: String, visits: List<TreatmentPlans.Visit>) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember(plan?.id) { mutableStateOf(plan?.title.orEmpty()) }
    var description by remember(plan?.id) { mutableStateOf(plan?.description.orEmpty()) }
    var visits by remember(plan?.id) {
        mutableStateOf(
            plan?.visits?.ifEmpty { null } ?: listOf(TreatmentPlans.Visit(TreatmentPlans.newId("visit")))
        )
    }
    var pickingFor by remember { mutableStateOf<String?>(null) }

    val total = visits.sumOf { it.total }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Alpha.Card,
    ) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
        ) {
            Text(
                if (plan == null) (if (arabic) "خطة جديدة" else "New plan") else (if (arabic) "تعديل الخطة" else "Edit plan"),
                fontSize = 19.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = AlphaType.Display,
                color = Alpha.Slate900,
            )

            SettingsField(
                if (arabic) "عنوان الخطة" else "Plan title",
                title,
                { title = it },
                hint = if (arabic) "مثال: تركيبات الفك العلوي" else "e.g. Upper arch crowns",
            )
            SettingsField(
                if (arabic) "شرح للمريض" else "What to tell the patient",
                description,
                { description = it },
                hint = if (arabic) "اختياري" else "optional",
                lines = 3,
            )

            visits.forEachIndexed { vIndex, visit ->
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (arabic) "زيارة ${vIndex + 1}" else "Visit ${vIndex + 1}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                    if (visits.size > 1) {
                        IconButton(onClick = { visits = visits.filterIndexed { i, _ -> i != vIndex } }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Remove visit", tint = Alpha.Slate400, modifier = Modifier.size(18.dp))
                        }
                    }
                }
                SettingsField(
                    if (arabic) "وصف الزيارة" else "What happens at this visit",
                    visit.label,
                    { value -> visits = visits.mapIndexed { i, v -> if (i == vIndex) v.copy(label = value) else v } },
                    hint = if (arabic) "اختياري" else "optional",
                )

                visit.steps.forEach { step ->
                    Spacer(Modifier.height(8.dp))
                    Surface(shape = Alpha.CardShape, color = Alpha.Ground, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    step.serviceName,
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate900,
                                    modifier = Modifier.weight(1f),
                                )
                                IconButton(onClick = {
                                    visits = visits.mapIndexed { i, v ->
                                        if (i == vIndex) v.copy(steps = v.steps.filter { it.id != step.id }) else v
                                    }
                                }) {
                                    Icon(Icons.Filled.Delete, contentDescription = "Remove", tint = Alpha.Slate400, modifier = Modifier.size(16.dp))
                                }
                            }
                            fun update(block: (TreatmentPlans.Step) -> TreatmentPlans.Step) {
                                visits = visits.mapIndexed { i, v ->
                                    if (i != vIndex) v
                                    else v.copy(steps = v.steps.map { if (it.id == step.id) block(it) else it })
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.weight(1f)) {
                                    SettingsField(
                                        if (arabic) "الأسنان" else "Teeth",
                                        step.teeth,
                                        { v -> update { it.copy(teeth = v) } },
                                        hint = "16, 11",
                                    )
                                }
                                Box(Modifier.weight(0.6f)) {
                                    SettingsField(
                                        if (arabic) "العدد" else "Qty",
                                        step.quantity.toString(),
                                        { v -> update { it.copy(quantity = v.filter(Char::isDigit).toIntOrNull() ?: 1) } },
                                        numeric = true,
                                    )
                                }
                                Box(Modifier.weight(0.9f)) {
                                    SettingsField(
                                        if (arabic) "السعر" else "Price",
                                        if (step.unitPrice > 0) step.unitPrice.toInt().toString() else "",
                                        { v -> update { it.copy(unitPrice = v.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) } },
                                        numeric = true,
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(6.dp))
                TextButton(onClick = { pickingFor = visit.id }) {
                    Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(16.dp), tint = Alpha.Green)
                    Spacer(Modifier.width(6.dp))
                    Text(if (arabic) "أضف علاجاً" else "Add a treatment", color = Alpha.Green, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }

            Spacer(Modifier.height(10.dp))
            TextButton(onClick = { visits = visits + TreatmentPlans.Visit(TreatmentPlans.newId("visit")) }) {
                Text(if (arabic) "＋ زيارة أخرى" else "＋ Another visit", color = Alpha.Slate600, fontWeight = FontWeight.Bold)
            }

            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (arabic) "الإجمالي" else "Total",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate600,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${total.toInt()} ${if (arabic) "ج.م" else "EGP"}",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                )
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { onSave(title, description, visits) },
                enabled = !saving && visits.any { v -> v.steps.any { it.serviceName.isNotBlank() } },
                shape = Alpha.PillShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (saving) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                else Text(if (arabic) "احفظ الخطة" else "Save the plan", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
            }
        }
    }

    pickingFor?.let { visitId ->
        ServicePicker(
            services = services,
            arabic = arabic,
            onPick = { service ->
                visits = visits.map { v ->
                    if (v.id != visitId) v
                    else v.copy(
                        steps = v.steps + TreatmentPlans.Step(
                            id = TreatmentPlans.newId("step"),
                            serviceId = service.id,
                            serviceName = service.name,
                            quantity = 1,
                            unitPrice = service.price,
                            estimatedMinutes = service.durationMinutes,
                        )
                    )
                }
                pickingFor = null
            },
            onDismiss = { pickingFor = null },
        )
    }
}

/** The clinic's price list, as a picker. The price comes from here, never from thin air. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServicePicker(
    services: List<ClinicSettings.ServiceRow>,
    arabic: Boolean,
    onPick: (ClinicSettings.ServiceRow) -> Unit,
    onDismiss: () -> Unit,
) {
    var q by remember { mutableStateOf("") }
    val needle = q.trim().lowercase()
    val shown = if (needle.isBlank()) services else services.filter { it.name.lowercase().contains(needle) }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Alpha.Card) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
            Text(
                if (arabic) "اختر علاجاً" else "Pick a treatment",
                fontSize = 18.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = AlphaType.Display,
                color = Alpha.Slate900,
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = q,
                onValueChange = { q = it },
                singleLine = true,
                placeholder = { Text(if (arabic) "ابحث" else "Search", color = Alpha.Slate400) },
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
            if (shown.isEmpty()) {
                Text(
                    if (services.isEmpty()) {
                        if (arabic) "قائمة الأسعار فارغة. أضف علاجات من الإعدادات ← الأسعار."
                        else "The price list is empty. Add treatments under Settings → Prices."
                    } else if (arabic) "لا يوجد علاج بهذا الاسم." else "No treatment matches that.",
                    fontSize = 13.sp,
                    color = Alpha.Slate400,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
            } else {
                LazyColumn(Modifier.heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(shown, key = { it.id }) { service ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(Alpha.CardShape)
                                .clickable { onPick(service) }
                                .padding(horizontal = 10.dp, vertical = 11.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(service.name, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
                                if (service.durationMinutes > 0) {
                                    Text("${service.durationMinutes} min", fontSize = 11.5.sp, color = Alpha.Slate500)
                                }
                            }
                            Text(
                                service.price.toInt().toString(),
                                fontSize = 15.sp,
                                fontWeight = FontWeight.ExtraBold,
                                fontFamily = AlphaType.Display,
                                color = Alpha.Slate900,
                            )
                        }
                    }
                }
            }
        }
    }
}
