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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material.icons.filled.MapsHomeWork
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.RotateLeft
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Source
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicSettings
import com.alphadental.clinic.data.LabCases
import com.alphadental.clinic.data.Session
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Settings, on the phone.
 *
 * The clinic is run from this app, so "change it at the desk" was never a real answer: a price
 * that moved, a lab that opened, a new receptionist and a bot that needs quieting all happen
 * while somebody is standing up. Every section here writes the same document the matching web
 * panel writes, so the two screens are two windows onto one clinic rather than two opinions.
 *
 * Sections are gated the way the website gates them — admins, or the settings permission — and
 * the ones that are read-only here (the activity log) are read-only there too.
 */
enum class SettingsSection(val id: String) {
    HUB("hub"),
    PROFILE("clinic_profile"),
    HOURS("clinical"),
    BRANCHES("locations"),
    LABS("labs"),
    PRICES("services"),
    VISIT_REASONS("visit_reasons"),
    SOURCES("sources"),
    ATTENDANCE("attendance"),
    TEAM("users"),
    JOIN_REQUESTS("join_requests"),
    ALERTS("notifications"),
    BOT("whatsapp"),
    RECALL("recall"),
    ONLINE_BOOKING("online_booking"),
    LOGS("logs"),
    APPEARANCE("appearance"),
}

/** What the hub lists: an icon, a name, a line saying what it is for, and where it goes. */
private data class SectionRow(
    val section: SettingsSection,
    val icon: ImageVector,
    val en: String,
    val ar: String,
    val enHint: String,
    val arHint: String,
    /** Admin-only sections are hidden outright rather than shown and refused. */
    val adminOnly: Boolean = false,
)

private val SECTION_GROUPS: List<Triple<String, String, List<SectionRow>>> = listOf(
    Triple(
        "THE CLINIC", "العيادة",
        listOf(
            SectionRow(SettingsSection.PROFILE, Icons.Filled.Business, "Clinic profile", "بيانات العيادة", "Name, phone, address, what prints on a receipt", "الاسم والهاتف والعنوان وما يُطبع على الإيصال", adminOnly = true),
            SectionRow(SettingsSection.HOURS, Icons.Filled.Schedule, "Working hours", "ساعات العمل", "When the clinic is open and how long a slot is", "مواعيد الفتح وطول الموعد", adminOnly = true),
            SectionRow(SettingsSection.BRANCHES, Icons.Filled.MapsHomeWork, "Branches", "الفروع", "Each branch and the code its lab cases carry", "كل فرع والرمز الذي تحمله حالات معمله", adminOnly = true),
            SectionRow(SettingsSection.ATTENDANCE, Icons.Filled.Fingerprint, "Clocking in", "تسجيل الحضور", "Where staff are allowed to clock in from", "من أين يُسمح بتسجيل الحضور", adminOnly = true),
        ),
    ),
    Triple(
        "WHAT YOU CHARGE", "الأسعار والمعامل",
        listOf(
            SectionRow(SettingsSection.PRICES, Icons.Filled.LocalOffer, "Prices", "الأسعار", "The treatment list, its prices and lab fees", "قائمة العلاجات وأسعارها ورسوم المعمل", adminOnly = true),
            SectionRow(SettingsSection.LABS, Icons.Filled.Science, "Dental labs", "المعامل", "The labs you send work to, and what they charge", "المعامل التي ترسل لها الشغل وأسعارها"),
        ),
    ),
    Triple(
        "THE TEAM", "الفريق",
        listOf(
            SectionRow(SettingsSection.TEAM, Icons.Filled.Group, "Team and access", "الفريق والصلاحيات", "Who works here and what each person may do", "من يعمل هنا وماذا يستطيع كل شخص", adminOnly = true),
            SectionRow(SettingsSection.JOIN_REQUESTS, Icons.Filled.PersonAdd, "Join requests", "طلبات الانضمام", "People asking to join the clinic", "أشخاص يطلبون الانضمام للعيادة", adminOnly = true),
        ),
    ),
    Triple(
        "TALKING TO PATIENTS", "التواصل مع المرضى",
        listOf(
            SectionRow(SettingsSection.BOT, Icons.Filled.Chat, "The WhatsApp bot", "بوت واتساب", "Whether it answers, who it answers, what it knows", "هل يرد، ولمن، وماذا يعرف", adminOnly = true),
            SectionRow(SettingsSection.ALERTS, Icons.Filled.Notifications, "Alerts", "التنبيهات", "Which events ring the bell", "أي الأحداث تُطلق التنبيه", adminOnly = true),
            SectionRow(SettingsSection.RECALL, Icons.Filled.RotateLeft, "Recall", "المتابعة الدورية", "How long until a patient is due back", "متى يصبح المريض مستحقاً للمتابعة", adminOnly = true),
            SectionRow(SettingsSection.ONLINE_BOOKING, Icons.Filled.Language, "Online booking", "الحجز الإلكتروني", "The public page patients book from", "الصفحة العامة التي يحجز منها المرضى", adminOnly = true),
        ),
    ),
    Triple(
        "LISTS AND THE REST", "القوائم وغيرها",
        listOf(
            SectionRow(SettingsSection.VISIT_REASONS, Icons.Filled.Bolt, "Visit reasons", "أسباب الزيارة", "What reception picks from when booking", "ما يختاره الاستقبال عند الحجز"),
            SectionRow(SettingsSection.SOURCES, Icons.Filled.Source, "How patients hear of you", "مصادر المرضى", "The list behind “how did you hear about us”", "قائمة “كيف عرفت عنا”"),
            SectionRow(SettingsSection.APPEARANCE, Icons.Filled.Palette, "Appearance", "المظهر", "Light, dark, and the app's language", "الفاتح والداكن ولغة التطبيق"),
            SectionRow(SettingsSection.LOGS, Icons.Filled.History, "Activity log", "سجل النشاط", "What people did, in order", "ما فعله الناس بالترتيب", adminOnly = true),
        ),
    ),
)

/** Everything the settings screens hold, so one state object serves every section. */
data class SettingsState(
    val section: SettingsSection = SettingsSection.HUB,
    val loading: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
    val profile: ClinicSettings.ClinicProfile = ClinicSettings.ClinicProfile(),
    val attendanceRules: ClinicSettings.AttendanceRules = ClinicSettings.AttendanceRules(),
    val branches: List<LabCases.Branch> = emptyList(),
    val labs: List<LabCases.Lab> = emptyList(),
    val services: List<ClinicSettings.ServiceRow> = emptyList(),
    val visitReasons: List<String> = emptyList(),
    val sources: List<String> = emptyList(),
    val staff: List<ClinicSettings.StaffRow> = emptyList(),
    val joinRequests: List<ClinicSettings.JoinRequest> = emptyList(),
    val alerts: Map<String, Boolean> = emptyMap(),
    val bot: ClinicSettings.BotSettings = ClinicSettings.BotSettings(),
    val recall: ClinicSettings.Recall = ClinicSettings.Recall(),
    val onlineBooking: ClinicSettings.OnlineBooking = ClinicSettings.OnlineBooking(),
    val logs: List<ClinicSettings.LogRow> = emptyList(),
)

/** Every callback the sections need, gathered so the screen's signature stays readable. */
class SettingsActions(
    val onOpen: (SettingsSection) -> Unit,
    val onBack: () -> Unit,
    val onSaveProfile: (ClinicSettings.ClinicProfile) -> Unit,
    val onSaveAttendanceRules: (ClinicSettings.AttendanceRules) -> Unit,
    val onSaveBranches: (List<LabCases.Branch>) -> Unit,
    val onSaveLabs: (List<LabCases.Lab>) -> Unit,
    val onSaveService: (ClinicSettings.ServiceRow) -> Unit,
    val onDeleteService: (ClinicSettings.ServiceRow) -> Unit,
    val onSaveList: (ClinicSettings.NamedList, List<String>) -> Unit,
    val onSaveStaff: (ClinicSettings.StaffRow) -> Unit,
    val onApproveJoin: (ClinicSettings.JoinRequest, String) -> Unit,
    val onRejectJoin: (ClinicSettings.JoinRequest) -> Unit,
    val onSaveAlerts: (Map<String, Boolean>) -> Unit,
    val onSaveBot: (ClinicSettings.BotSettings) -> Unit,
    val onSaveRecall: (ClinicSettings.Recall) -> Unit,
    val onSaveOnlineBooking: (ClinicSettings.OnlineBooking) -> Unit,
    val onOpenAppearance: () -> Unit,
    val onOpenHours: () -> Unit,
)

@Composable
fun SettingsScreen(
    state: SettingsState,
    session: Session,
    arabic: Boolean,
    actions: SettingsActions,
    onClose: () -> Unit,
) {
    BackHandler { if (state.section == SettingsSection.HUB) onClose() else actions.onBack() }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
        ) {
            val row = SECTION_GROUPS.flatMap { it.third }.firstOrNull { it.section == state.section }
            SettingsHeader(
                title = when {
                    state.section == SettingsSection.HUB -> if (arabic) "الإعدادات" else "Settings"
                    row != null -> if (arabic) row.ar else row.en
                    else -> if (arabic) "الإعدادات" else "Settings"
                },
                hint = when {
                    state.section == SettingsSection.HUB ->
                        if (arabic) "كل ما في الموقع، من هنا" else "Everything the website has, from here"
                    row != null -> if (arabic) row.arHint else row.enHint
                    else -> ""
                },
                onBack = { if (state.section == SettingsSection.HUB) onClose() else actions.onBack() },
            )

            if (state.loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Alpha.Ink)
                }
                return@Column
            }

            Box(Modifier.weight(1f)) {
                when (state.section) {
                    SettingsSection.HUB -> Hub(session, arabic, actions.onOpen)
                    SettingsSection.PROFILE -> ProfileSection(state, arabic, actions)
                    SettingsSection.ATTENDANCE -> AttendanceRulesSection(state, arabic, actions)
                    SettingsSection.BRANCHES -> BranchesSection(state, arabic, actions)
                    SettingsSection.LABS -> LabsSection(state, arabic, actions)
                    SettingsSection.PRICES -> PricesSection(state, arabic, actions)
                    SettingsSection.VISIT_REASONS -> ListSection(state.visitReasons, ClinicSettings.VISIT_REASONS, arabic, actions)
                    SettingsSection.SOURCES -> ListSection(state.sources, ClinicSettings.PATIENT_SOURCES, arabic, actions)
                    SettingsSection.TEAM -> TeamSection(state, arabic, actions)
                    SettingsSection.JOIN_REQUESTS -> JoinRequestsSection(state, arabic, actions)
                    SettingsSection.ALERTS -> AlertsSection(state, arabic, actions)
                    SettingsSection.BOT -> BotSection(state, arabic, actions)
                    SettingsSection.RECALL -> RecallSection(state, arabic, actions)
                    SettingsSection.ONLINE_BOOKING -> OnlineBookingSection(state, arabic, actions)
                    SettingsSection.LOGS -> LogsSection(state, arabic)
                    // These two already have their own screens; the hub simply opens them.
                    SettingsSection.HOURS, SettingsSection.APPEARANCE -> Unit
                }
            }

            state.error?.let {
                Text(
                    it,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.DangerText,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SettingsHeader(title: String, hint: String, onBack: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp, bottom = 4.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 19.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate900, fontFamily = AlphaType.Display)
            if (hint.isNotBlank()) Text(hint, fontSize = 12.sp, color = Alpha.Slate500, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------------------------

@Composable
private fun Hub(session: Session, arabic: Boolean, onOpen: (SettingsSection) -> Unit) {
    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        SECTION_GROUPS.forEach { (en, ar, rows) ->
            val visible = rows.filter { !it.adminOnly || session.isAdmin || session.can("settings.edit") }
            if (visible.isEmpty()) return@forEach
            item(key = "h-$en") {
                Spacer(Modifier.height(10.dp))
                SectionHeading(if (arabic) ar else en)
                Spacer(Modifier.height(4.dp))
            }
            items(visible, key = { it.section.id }) { row ->
                Surface(
                    onClick = { onOpen(row.section) },
                    shape = Alpha.CardShape,
                    color = Alpha.Card,
                    border = if (Alpha.dark) BorderStroke(1.dp, Alpha.Slate100) else null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(14.dp)) {
                        Box(
                            Modifier.size(38.dp).clip(CircleShape).background(Alpha.GreenSoft),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(row.icon, contentDescription = null, tint = Alpha.Green, modifier = Modifier.size(19.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(if (arabic) row.ar else row.en, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
                            Text(
                                if (arabic) row.arHint else row.enHint,
                                fontSize = 11.5.sp,
                                color = Alpha.Slate500,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Alpha.Slate300)
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

@Composable
internal fun SettingsField(
    label: String,
    value: String,
    onValue: (String) -> Unit,
    hint: String = "",
    numeric: Boolean = false,
    lines: Int = 1,
) {
    Spacer(Modifier.height(12.dp))
    Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate600)
    Spacer(Modifier.height(6.dp))
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        placeholder = { if (hint.isNotBlank()) Text(hint, color = Alpha.Slate400, fontSize = 13.sp) },
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

@Composable
internal fun SettingsSwitch(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
            if (hint.isNotBlank()) Text(hint, fontSize = 11.5.sp, color = Alpha.Slate500)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = Alpha.Green),
        )
    }
}

/**
 * The save button every section ends with.
 *
 * Disabled until something actually changed, so "Save" is never a button that does nothing —
 * and the discard beside it is the only way back to what was stored without leaving the screen.
 */
@Composable
internal fun SaveBar(dirty: Boolean, saving: Boolean, arabic: Boolean, onDiscard: () -> Unit, onSave: () -> Unit) {
    Spacer(Modifier.height(20.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (dirty) {
            TextButton(onClick = onDiscard, enabled = !saving) {
                Text(if (arabic) "تراجع" else "Discard", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(8.dp))
        }
        Button(
            onClick = onSave,
            enabled = dirty && !saving,
            shape = Alpha.PillShape,
            colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
            modifier = Modifier.weight(1f).height(48.dp),
        ) {
            if (saving) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            else Text(if (arabic) "حفظ" else "Save", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
        }
    }
    Spacer(Modifier.height(24.dp))
}

@Composable
private fun SectionBody(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) { content() }
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

@Composable
private fun ProfileSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var draft by remember(state.profile) { mutableStateOf(state.profile) }
    SectionBody {
        SettingsField(if (arabic) "اسم العيادة" else "Clinic name", draft.name, { draft = draft.copy(name = it) })
        SettingsField(if (arabic) "اسم الطبيب" else "Lead dentist", draft.doctorName, { draft = draft.copy(doctorName = it) })
        SettingsField(if (arabic) "الهاتف" else "Phone", draft.phone, { draft = draft.copy(phone = it) })
        SettingsField(if (arabic) "البريد" else "Email", draft.email, { draft = draft.copy(email = it) })
        SettingsField(if (arabic) "العنوان" else "Address", draft.address, { draft = draft.copy(address = it) }, lines = 3)
        SettingsField(if (arabic) "العملة" else "Currency", draft.currency, { draft = draft.copy(currency = it) }, hint = "EGP")
        SettingsField(
            if (arabic) "ترويسة الروشتة" else "Prescription header",
            draft.rxHeader,
            { draft = draft.copy(rxHeader = it) },
            hint = if (arabic) "يُطبع أعلى كل روشتة" else "printed at the top of every prescription",
            lines = 3,
        )
        SaveBar(draft != state.profile, state.saving, arabic, { draft = state.profile }) { actions.onSaveProfile(draft) }
    }
}

@Composable
private fun AttendanceRulesSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var draft by remember(state.attendanceRules) { mutableStateOf(state.attendanceRules) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        Text(
            if (arabic) "اترك خانتي الإحداثيات فارغتين ليتمكن الفريق من تسجيل الحضور من أي مكان."
            else "Leave the two coordinates blank to let staff clock in from anywhere.",
            fontSize = 12.5.sp,
            color = Alpha.Slate500,
        )
        SettingsField(if (arabic) "خط العرض" else "Latitude", draft.lat, { draft = draft.copy(lat = it) }, hint = "30.0444")
        SettingsField(if (arabic) "خط الطول" else "Longitude", draft.lng, { draft = draft.copy(lng = it) }, hint = "31.2357")
        SettingsField(if (arabic) "نطاق المسافة بالمتر" else "Allowed distance (metres)", draft.radiusMetres, { draft = draft.copy(radiusMetres = it) }, numeric = true)
        SaveBar(draft != state.attendanceRules, state.saving, arabic, { draft = state.attendanceRules }) {
            actions.onSaveAttendanceRules(draft)
        }
    }
}

@Composable
private fun BranchesSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var rows by remember(state.branches) { mutableStateOf(state.branches) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        Text(
            if (arabic) "الرمز هو ما يُطبع على أكياس المعمل: MAD-0142. إن تركته فارغاً يُشتق من الاسم."
            else "The code is what goes on a lab bag: MAD-0142. Left blank, it is derived from the name.",
            fontSize = 12.5.sp,
            color = Alpha.Slate500,
        )
        rows.forEachIndexed { index, branch ->
            Spacer(Modifier.height(12.dp))
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (arabic) "فرع ${index + 1}" else "Branch ${index + 1}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate500,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { rows = rows.filterIndexed { i, _ -> i != index } }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Remove", tint = Alpha.DangerText, modifier = Modifier.size(18.dp))
                        }
                    }
                    SettingsField(if (arabic) "الاسم" else "Name", branch.name, { value ->
                        rows = rows.mapIndexed { i, b -> if (i == index) b.copy(name = value) else b }
                    })
                    SettingsField(
                        if (arabic) "رمز المعمل" else "Lab code",
                        branch.code,
                        { value -> rows = rows.mapIndexed { i, b -> if (i == index) b.copy(code = value.uppercase()) else b } },
                        hint = LabCases.branchCodeFor(branch, index),
                    )
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = { rows = rows + LabCases.Branch(ClinicSettings.newBranchId(), "", "") }) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp), tint = Alpha.Green)
            Spacer(Modifier.width(6.dp))
            Text(if (arabic) "أضف فرعاً" else "Add a branch", color = Alpha.Green, fontWeight = FontWeight.Bold)
        }
        SaveBar(rows != state.branches, state.saving, arabic, { rows = state.branches }) {
            actions.onSaveBranches(rows.filter { it.name.isNotBlank() })
        }
    }
}

@Composable
private fun LabsSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var rows by remember(state.labs) { mutableStateOf(state.labs) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        Text(
            if (arabic) "مدة التنفيذ تملأ موعد الاستلام تلقائياً عند اختيار المعمل في طلب جديد."
            else "The turnaround fills in the due date by itself when this lab is picked on an order.",
            fontSize = 12.5.sp,
            color = Alpha.Slate500,
        )
        rows.forEachIndexed { index, lab ->
            Spacer(Modifier.height(12.dp))
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            lab.name.ifBlank { if (arabic) "معمل جديد" else "New lab" },
                            fontSize = 13.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = Alpha.Slate900,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { rows = rows.filterIndexed { i, _ -> i != index } }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Remove", tint = Alpha.DangerText, modifier = Modifier.size(18.dp))
                        }
                    }
                    fun set(block: (LabCases.Lab) -> LabCases.Lab) {
                        rows = rows.mapIndexed { i, l -> if (i == index) block(l) else l }
                    }
                    SettingsField(if (arabic) "الاسم" else "Name", lab.name, { v -> set { it.copy(name = v) } })
                    SettingsField(if (arabic) "الهاتف" else "Phone", lab.phone, { v -> set { it.copy(phone = v) } })
                    SettingsField(if (arabic) "واتساب" else "WhatsApp", lab.whatsapp, { v -> set { it.copy(whatsapp = v) } }, hint = if (arabic) "إن اختلف عن الهاتف" else "if different from the phone")
                    SettingsField(if (arabic) "اسم السائق" else "Driver", lab.driverName, { v -> set { it.copy(driverName = v) } })
                    SettingsField(
                        if (arabic) "مدة التنفيذ بالأيام" else "Turnaround (days)",
                        if (lab.turnaroundDays > 0) lab.turnaroundDays.toString() else "",
                        { v -> set { it.copy(turnaroundDays = v.filter(Char::isDigit).toIntOrNull() ?: 0) } },
                        numeric = true,
                    )
                    SettingsField(if (arabic) "ملاحظات" else "Notes", lab.notes, { v -> set { it.copy(notes = v) } }, lines = 2)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = { rows = rows + LabCases.Lab(ClinicSettings.newLabId(), "") }) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp), tint = Alpha.Green)
            Spacer(Modifier.width(6.dp))
            Text(if (arabic) "أضف معملاً" else "Add a lab", color = Alpha.Green, fontWeight = FontWeight.Bold)
        }
        SaveBar(rows != state.labs, state.saving, arabic, { rows = state.labs }) {
            actions.onSaveLabs(rows.filter { it.name.isNotBlank() })
        }
    }
}

@Composable
private fun ListSection(values: List<String>, list: ClinicSettings.NamedList, arabic: Boolean, actions: SettingsActions) {
    var rows by remember(values) { mutableStateOf(values) }
    var adding by remember { mutableStateOf("") }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        rows.forEachIndexed { index, value ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                Text(value, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Alpha.Slate900, modifier = Modifier.weight(1f))
                IconButton(onClick = { rows = rows.filterIndexed { i, _ -> i != index } }) {
                    Icon(Icons.Filled.Delete, contentDescription = "Remove", tint = Alpha.Slate400, modifier = Modifier.size(18.dp))
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Box(Modifier.weight(1f)) {
                SettingsField(if (arabic) "إضافة" else "Add one", adding, { adding = it })
            }
            Spacer(Modifier.width(8.dp))
            TextButton(
                onClick = {
                    if (adding.isNotBlank()) { rows = rows + adding.trim(); adding = "" }
                },
                enabled = adding.isNotBlank(),
                modifier = Modifier.padding(bottom = 4.dp),
            ) {
                Text(if (arabic) "أضف" else "Add", fontWeight = FontWeight.ExtraBold, color = Alpha.Green)
            }
        }
        SaveBar(rows != values, false, arabic, { rows = values }) { actions.onSaveList(list, rows) }
    }
}

@Composable
private fun AlertsSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var values by remember(state.alerts) { mutableStateOf(state.alerts) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        Text(
            if (arabic) "هذه تُطلق الجرس داخل التطبيق وعلى الموقع معاً."
            else "These ring the bell in the app and on the website alike.",
            fontSize = 12.5.sp,
            color = Alpha.Slate500,
        )
        Spacer(Modifier.height(6.dp))
        ClinicSettings.ALERT_KEYS.forEach { (key, label) ->
            val on = values[key] ?: ClinicSettings.alertDefault(key)
            SettingsSwitch(
                when (key) {
                    "patientArrival" -> if (arabic) "وصول مريض" else label
                    "labReady" -> if (arabic) "رجوع حالة من المعمل" else label
                    else -> label
                },
                "",
                on,
            ) { values = values + (key to it) }
        }
        SaveBar(values != state.alerts, state.saving, arabic, { values = state.alerts }) { actions.onSaveAlerts(values) }
    }
}

@Composable
private fun RecallSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var draft by remember(state.recall) { mutableStateOf(state.recall) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        SettingsField(
            if (arabic) "المتابعة كل (شهور)" else "Due back after (months)",
            draft.intervalMonths.toString(),
            { draft = draft.copy(intervalMonths = it.filter(Char::isDigit).toIntOrNull() ?: 6) },
            numeric = true,
        )
        SettingsField(
            if (arabic) "يُعتبر المريض منقطعاً بعد (شهور)" else "Counts as dormant after (months)",
            draft.reactivationMonths.toString(),
            { draft = draft.copy(reactivationMonths = it.filter(Char::isDigit).toIntOrNull() ?: 12) },
            numeric = true,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            if (arabic) "الأول يبني قائمة المتابعة، والثاني يغذّي فحص المنقطعين."
            else "The first builds the recall list; the second feeds the dormant-patient scan.",
            fontSize = 12.sp,
            color = Alpha.Slate500,
        )
        SaveBar(draft != state.recall, state.saving, arabic, { draft = state.recall }) { actions.onSaveRecall(draft) }
    }
}

@Composable
private fun OnlineBookingSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var draft by remember(state.onlineBooking) { mutableStateOf(state.onlineBooking) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        SettingsSwitch(
            if (arabic) "الحجز الإلكتروني مفعّل" else "Online booking is on",
            if (arabic) "صفحة عامة يحجز منها أي شخص" else "A public page anyone can book from",
            draft.enabled,
        ) { draft = draft.copy(enabled = it) }
        SettingsSwitch(
            if (arabic) "اختيار الطبيب" else "Let them choose a dentist",
            if (arabic) "وإلا يُوزَّع الحجز على المتاح" else "Otherwise the booking goes to whoever is free",
            draft.enableDoctorSelection,
        ) { draft = draft.copy(enableDoctorSelection = it) }
        SettingsField(
            if (arabic) "مدة الموعد الافتراضية (دقيقة)" else "Default appointment length (minutes)",
            draft.defaultDurationMinutes,
            { draft = draft.copy(defaultDurationMinutes = it) },
            numeric = true,
        )
        SaveBar(draft != state.onlineBooking, state.saving, arabic, { draft = state.onlineBooking }) {
            actions.onSaveOnlineBooking(draft)
        }
    }
}

@Composable
private fun BotSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var draft by remember(state.bot) { mutableStateOf(state.bot) }
    SectionBody {
        Spacer(Modifier.height(8.dp))
        SettingsSwitch(
            if (arabic) "البوت يرد على واتساب" else "The bot answers WhatsApp",
            if (arabic) "أوقفه ليصمت تماماً" else "Turn it off and it says nothing at all",
            draft.enabled,
        ) { draft = draft.copy(enabled = it) }
        SettingsSwitch(
            if (arabic) "يرد على أرقام غير مسجلة" else "Answer unknown numbers",
            if (arabic) "الرد على المجهولين يعني الرد على الأرقام الخطأ والإعلانات أيضاً"
            else "Answering strangers means answering wrong numbers and spam too",
            draft.answerStrangers,
        ) { draft = draft.copy(answerStrangers = it) }
        SettingsSwitch(
            if (arabic) "يؤكد الحجوزات تلقائياً" else "Confirm bookings automatically",
            if (arabic) "وإلا ينتظر موافقة من الاستقبال" else "Otherwise reception approves each one",
            draft.autoConfirmBookings,
        ) { draft = draft.copy(autoConfirmBookings = it) }
        SettingsSwitch(
            if (arabic) "الذكاء الاصطناعي يرد أولاً" else "The model answers first",
            if (arabic) "بدلاً من الردود المكتوبة" else "instead of the scripted answers",
            draft.mode == "ai_first",
        ) { draft = draft.copy(mode = if (it) "ai_first" else "", aiEnabled = it) }
        SettingsSwitch(
            if (arabic) "أسئلة الطبيب للأعراض" else "A symptom gets a dentist's questions",
            if (arabic) "وإلا يُحوَّل للاستقبال" else "rather than a call-back from reception",
            draft.clinicalMode == "dentist",
        ) { draft = draft.copy(clinicalMode = if (it) "dentist" else "") }
        SettingsField(
            if (arabic) "اسم البوت" else "The bot's name",
            draft.personaName,
            { draft = draft.copy(personaName = it) },
            hint = if (arabic) "اختياري" else "optional",
        )
        SettingsField(
            if (arabic) "يصمت بعد رد الموظف (دقائق)" else "Stands back after a staff reply (minutes)",
            draft.humanClaimMinutes.toString(),
            { draft = draft.copy(humanClaimMinutes = it.filter(Char::isDigit).toIntOrNull() ?: 15) },
            numeric = true,
        )

        Spacer(Modifier.height(18.dp))
        SectionHeading(if (arabic) "الإجابات الجاهزة" else "READY ANSWERS")
        Spacer(Modifier.height(4.dp))
        Text(
            if (arabic) "البوت يقتبس هذه حرفياً، وتظهر أيضاً كردود جاهزة في المحادثات."
            else "The bot quotes these verbatim, and they show as quick replies in Chats too.",
            fontSize = 12.sp,
            color = Alpha.Slate500,
        )
        ClinicSettings.BOT_FACT_KEYS.forEach { (key, label) ->
            SettingsField(label, draft.facts[key].orEmpty(), { value ->
                draft = draft.copy(facts = draft.facts + (key to value))
            }, lines = 2)
        }
        SaveBar(draft != state.bot, state.saving, arabic, { draft = state.bot }) { actions.onSaveBot(draft) }
    }
}

@Composable
private fun LogsSection(state: SettingsState, arabic: Boolean) {
    if (state.logs.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(16.dp)) {
            EmptyState(if (arabic) "لا يوجد نشاط مسجل بعد." else "Nothing recorded yet.")
        }
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(state.logs, key = { it.id }) { row ->
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(row.action, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
                    if (row.details.isNotBlank()) {
                        Text(row.details, fontSize = 12.sp, color = Alpha.Slate600, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                    Text(
                        listOf(row.by, stamp(row.atMillis)).filter { it.isNotBlank() }.joinToString(" · "),
                        fontSize = 11.sp,
                        color = Alpha.Slate400,
                    )
                }
            }
        }
    }
}

private fun stamp(millis: Long): String =
    if (millis <= 0L) "" else SimpleDateFormat("d MMM, h:mm a", Locale.ENGLISH).format(Date(millis))

// ---------------------------------------------------------------------------------------------
// Prices, team and join requests
// ---------------------------------------------------------------------------------------------

@Composable
private fun PricesSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var editing by remember { mutableStateOf<ClinicSettings.ServiceRow?>(null) }
    var confirmDelete by remember { mutableStateOf<ClinicSettings.ServiceRow?>(null) }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 90.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (state.services.isEmpty()) {
                item { EmptyState(if (arabic) "لا توجد علاجات مسعّرة بعد." else "No priced treatments yet.") }
            }
            items(state.services, key = { it.id }) { row ->
                AlphaCard(modifier = Modifier.fillMaxWidth().clickable { editing = row }) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(14.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(row.name, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
                            Text(
                                buildString {
                                    if (row.durationMinutes > 0) append("${row.durationMinutes} min")
                                    if (row.estimatedLabFee > 0) {
                                        if (isNotEmpty()) append(" · ")
                                        append(if (arabic) "معمل ${row.estimatedLabFee.toInt()}" else "lab ${row.estimatedLabFee.toInt()}")
                                    }
                                    if (row.category.isNotBlank()) {
                                        if (isNotEmpty()) append(" · ")
                                        append(row.category)
                                    }
                                },
                                fontSize = 11.5.sp,
                                color = Alpha.Slate500,
                            )
                        }
                        Text(
                            "${row.price.toInt()}",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.ExtraBold,
                            fontFamily = AlphaType.Display,
                            color = Alpha.Slate900,
                        )
                    }
                }
            }
        }
        Button(
            onClick = { editing = ClinicSettings.ServiceRow("", "", 0.0, 0, 0.0, "", "", "") },
            shape = Alpha.PillShape,
            colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (arabic) "علاج جديد" else "New treatment", fontWeight = FontWeight.ExtraBold)
        }
    }

    editing?.let { row ->
        ServiceEditor(
            row = row,
            saving = state.saving,
            arabic = arabic,
            onSave = { actions.onSaveService(it); editing = null },
            onDelete = if (row.id.isNotBlank()) ({ confirmDelete = row; editing = null }) else null,
            onDismiss = { editing = null },
        )
    }

    confirmDelete?.let { row ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            containerColor = Alpha.Card,
            title = { Text(if (arabic) "حذف ${row.name}؟" else "Delete ${row.name}?", fontWeight = FontWeight.Bold, color = Alpha.Slate900) },
            text = {
                Text(
                    if (arabic) "يُحذف من قائمة الأسعار فقط. الفواتير السابقة تحتفظ باسمها ومبلغها."
                    else "It leaves the price list only. Past charges keep their own name and amount.",
                    color = Alpha.Slate600,
                )
            },
            confirmButton = {
                TextButton(onClick = { actions.onDeleteService(row); confirmDelete = null }) {
                    Text(if (arabic) "حذف" else "Delete", color = Alpha.DangerText, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) {
                    Text(if (arabic) "إلغاء" else "Cancel", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            },
        )
    }
}

@Composable
private fun ServiceEditor(
    row: ClinicSettings.ServiceRow,
    saving: Boolean,
    arabic: Boolean,
    onSave: (ClinicSettings.ServiceRow) -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    var draft by remember(row.id) { mutableStateOf(row) }
    EditorSheet(
        title = if (row.id.isBlank()) (if (arabic) "علاج جديد" else "New treatment") else draft.name,
        saving = saving,
        canSave = draft.name.isNotBlank(),
        arabic = arabic,
        onSave = { onSave(draft) },
        onDelete = onDelete,
        onDismiss = onDismiss,
    ) {
        SettingsField(if (arabic) "الاسم" else "Name", draft.name, { draft = draft.copy(name = it) })
        SettingsField(
            if (arabic) "السعر" else "Price",
            if (draft.price > 0) draft.price.toInt().toString() else "",
            { draft = draft.copy(price = it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
            numeric = true,
        )
        SettingsField(
            if (arabic) "المدة بالدقائق" else "Duration (minutes)",
            if (draft.durationMinutes > 0) draft.durationMinutes.toString() else "",
            { draft = draft.copy(durationMinutes = it.filter(Char::isDigit).toIntOrNull() ?: 0) },
            numeric = true,
        )
        SettingsField(
            if (arabic) "رسوم المعمل" else "Lab fee",
            if (draft.estimatedLabFee > 0) draft.estimatedLabFee.toInt().toString() else "",
            { draft = draft.copy(estimatedLabFee = it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
            hint = if (arabic) "تُخصم قبل حساب نسبة الطبيب" else "comes off before the dentist's commission",
            numeric = true,
        )
        SettingsField(if (arabic) "التصنيف" else "Category", draft.category, { draft = draft.copy(category = it) })
    }
}

@Composable
private fun TeamSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var editing by remember { mutableStateOf<ClinicSettings.StaffRow?>(null) }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 90.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (state.staff.isEmpty()) {
                item { EmptyState(if (arabic) "لا يوجد فريق مسجل بعد." else "Nobody on the team list yet.") }
            }
            items(state.staff, key = { it.id }) { row ->
                AlphaCard(modifier = Modifier.fillMaxWidth().clickable { editing = row }) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(14.dp)) {
                        Box(
                            Modifier.size(38.dp).clip(CircleShape)
                                .background(if (row.active) Alpha.GreenSoft else Alpha.Slate100),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                row.name.trim().firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                fontSize = 15.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = if (row.active) Alpha.Green else Alpha.Slate400,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(row.name.ifBlank { row.email }, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOf(row.role, if (row.active) "" else (if (arabic) "موقوف" else "inactive"))
                                    .filter { it.isNotBlank() }.joinToString(" · "),
                                fontSize = 11.5.sp,
                                color = Alpha.Slate500,
                            )
                        }
                        if (row.permissions.isNotEmpty()) {
                            Text(
                                if (arabic) "${row.permissions.size} صلاحية" else "${row.permissions.size} granted",
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate400,
                            )
                        }
                    }
                }
            }
        }
        Button(
            onClick = {
                editing = ClinicSettings.StaffRow("", "", "", "", "Assistant", "", true, emptyList(), 0.0, 0.0)
            },
            shape = Alpha.PillShape,
            colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (arabic) "إضافة شخص" else "Add someone", fontWeight = FontWeight.ExtraBold)
        }
    }

    editing?.let { row ->
        StaffEditor(
            row = row,
            saving = state.saving,
            arabic = arabic,
            onSave = { actions.onSaveStaff(it); editing = null },
            onDismiss = { editing = null },
        )
    }
}

@Composable
private fun StaffEditor(
    row: ClinicSettings.StaffRow,
    saving: Boolean,
    arabic: Boolean,
    onSave: (ClinicSettings.StaffRow) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember(row.id) { mutableStateOf(row) }
    val fullAccess = draft.role == "Owner" || draft.role == "Admin"

    EditorSheet(
        title = if (row.id.isBlank()) (if (arabic) "شخص جديد" else "Someone new") else draft.name.ifBlank { draft.email },
        saving = saving,
        canSave = draft.name.isNotBlank() && draft.email.isNotBlank(),
        arabic = arabic,
        onSave = { onSave(draft) },
        onDelete = null,
        onDismiss = onDismiss,
    ) {
        SettingsField(if (arabic) "الاسم" else "Name", draft.name, { draft = draft.copy(name = it) })
        SettingsField(
            if (arabic) "البريد" else "Email",
            draft.email,
            { draft = draft.copy(email = it) },
            hint = if (arabic) "نفس البريد الذي يسجل به الدخول" else "the address they sign in with",
        )
        SettingsField(if (arabic) "الهاتف" else "Phone", draft.phone, { draft = draft.copy(phone = it) })

        Spacer(Modifier.height(14.dp))
        Text(if (arabic) "الدور" else "Role", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate600)
        Spacer(Modifier.height(6.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        ) {
            ClinicSettings.ROLES.forEach { role ->
                val on = draft.role == role
                Surface(
                    onClick = { draft = draft.copy(role = role) },
                    shape = Alpha.PillShape,
                    color = if (on) Alpha.Ink else Alpha.Card,
                    border = if (on) null else BorderStroke(1.dp, Alpha.Slate200),
                ) {
                    Text(
                        role,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (on) Color.White else Alpha.Slate700,
                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                    )
                }
            }
        }

        SettingsSwitch(
            if (arabic) "يعمل هنا حالياً" else "Works here",
            if (arabic) "أوقفه بدلاً من حذفه ليبقى سجله" else "Switch off rather than delete, so their history stays",
            draft.active,
        ) { draft = draft.copy(active = it) }

        SettingsField(
            if (arabic) "نسبة الطبيب %" else "Commission %",
            if (draft.commissionPercentage > 0) draft.commissionPercentage.toInt().toString() else "",
            { draft = draft.copy(commissionPercentage = it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
            numeric = true,
        )
        SettingsField(
            if (arabic) "الراتب الأساسي" else "Base salary",
            if (draft.baseSalary > 0) draft.baseSalary.toInt().toString() else "",
            { draft = draft.copy(baseSalary = it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
            numeric = true,
        )

        Spacer(Modifier.height(18.dp))
        SectionHeading(if (arabic) "الصلاحيات" else "WHAT THEY MAY DO")
        Spacer(Modifier.height(4.dp))
        if (fullAccess) {
            Text(
                if (arabic) "المالك والمدير لديهما كل الصلاحيات دون تحديد."
                else "An Owner or Admin holds everything without any of these being ticked.",
                fontSize = 12.sp,
                color = Alpha.Slate500,
            )
        } else {
            ClinicSettings.PERMISSION_GROUPS.forEach { (group, keys) ->
                Spacer(Modifier.height(10.dp))
                Text(group, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate400)
                keys.forEach { (id, label) ->
                    val on = draft.permissions.contains(id)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                draft = draft.copy(
                                    permissions = if (on) draft.permissions - id else draft.permissions + id
                                )
                            }
                            .padding(vertical = 7.dp),
                    ) {
                        Box(
                            Modifier.size(20.dp).clip(Alpha.CardShape)
                                .background(if (on) Alpha.Green else Alpha.Slate100),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (on) Text("✓", fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
                        }
                        Spacer(Modifier.width(10.dp))
                        Text(label, fontSize = 13.sp, color = Alpha.Slate800, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun JoinRequestsSection(state: SettingsState, arabic: Boolean, actions: SettingsActions) {
    var deciding by remember { mutableStateOf<ClinicSettings.JoinRequest?>(null) }

    if (state.joinRequests.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(16.dp)) {
            EmptyState(if (arabic) "لا توجد طلبات انضمام." else "Nobody is waiting to join.")
        }
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(state.joinRequests, key = { it.id }) { req ->
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text(req.name.ifBlank { req.email }, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate900)
                    Text(req.email, fontSize = 12.sp, color = Alpha.Slate500)
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { deciding = req },
                            shape = Alpha.PillShape,
                            colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                        ) { Text(if (arabic) "قبول" else "Approve", fontWeight = FontWeight.Bold) }
                        TextButton(onClick = { actions.onRejectJoin(req) }) {
                            Text(if (arabic) "رفض" else "Refuse", color = Alpha.DangerText, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }

    deciding?.let { req ->
        var role by remember(req.id) { mutableStateOf(req.role.ifBlank { "Assistant" }) }
        AlertDialog(
            onDismissRequest = { deciding = null },
            containerColor = Alpha.Card,
            title = { Text(if (arabic) "قبول ${req.name}" else "Approve ${req.name}", fontWeight = FontWeight.Bold, color = Alpha.Slate900) },
            text = {
                Column {
                    Text(
                        if (arabic) "بأي دور ينضم؟" else "Joining as what?",
                        fontSize = 13.sp,
                        color = Alpha.Slate600,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                    ) {
                        ClinicSettings.ROLES.filter { it != "Owner" }.forEach { option ->
                            val on = role == option
                            Surface(
                                onClick = { role = option },
                                shape = Alpha.PillShape,
                                color = if (on) Alpha.Ink else Alpha.Ground,
                                border = if (on) null else BorderStroke(1.dp, Alpha.Slate200),
                            ) {
                                Text(
                                    option,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (on) Color.White else Alpha.Slate700,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { actions.onApproveJoin(req, role); deciding = null }) {
                    Text(if (arabic) "قبول" else "Approve", color = Alpha.Green, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { deciding = null }) {
                    Text(if (arabic) "إلغاء" else "Cancel", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            },
        )
    }
}

/**
 * The sheet every "edit one row" form lives in.
 *
 * A sheet rather than a page because these are short forms opened from a list and closed back
 * onto it, and losing the list's scroll position on every edit is the thing that makes a settings
 * screen tiring to work through.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun EditorSheet(
    title: String,
    saving: Boolean,
    canSave: Boolean,
    arabic: Boolean,
    onSave: () -> Unit,
    onDelete: (() -> Unit)?,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
) {
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Alpha.Card,
    ) {
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title.ifBlank { if (arabic) "تعديل" else "Edit" },
                    fontSize = 19.sp,
                    fontWeight = FontWeight.ExtraBold,
                    fontFamily = AlphaType.Display,
                    color = Alpha.Slate900,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                onDelete?.let {
                    IconButton(onClick = it) {
                        Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = Alpha.DangerText, modifier = Modifier.size(20.dp))
                    }
                }
            }

            content()

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onSave,
                enabled = canSave && !saving,
                shape = Alpha.PillShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (saving) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                else Text(if (arabic) "حفظ" else "Save", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
            }
        }
    }
}
