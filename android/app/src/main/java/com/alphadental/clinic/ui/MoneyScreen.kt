package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.withDoctorTitle
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * The clinic's money, the way the website's Finance page shows it.
 *
 * Cash basis throughout: what actually moved, not what was billed. The four
 * numbers on top are the website's KPI row — cash in, expenses, commissions and
 * net — and they always describe the filtered view, so "Dr Ahmed, this month"
 * reads as Dr Ahmed's month and not the clinic's.
 */
@Composable
fun MoneyScreen(
    view: String,
    anchor: String,
    rows: List<Repository.FinanceRow>,
    loading: Boolean,
    arabic: Boolean,
    isCurrentPeriod: Boolean,
    onSetView: (String) -> Unit,
    onShift: (Int) -> Unit,
    onToday: () -> Unit,
    onAdd: () -> Unit,
    onDelete: (Repository.FinanceRow) -> Unit,
    onOpenRow: (Repository.FinanceRow) -> Unit,
) {
    var typeFilter by remember { mutableStateOf("all") } // all | in | out
    var doctorFilter by remember { mutableStateOf("") } // blank = all
    var query by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf<Repository.FinanceRow?>(null) }

    val doctors = rows.mapNotNull { it.doctorName.trim().takeIf(String::isNotBlank) }.distinct()

    val filtered = rows.filter { row ->
        if (doctorFilter.isNotBlank() && row.doctorName.trim() != doctorFilter) return@filter false
        when (typeFilter) {
            "in" -> if (row.isExpense) return@filter false
            "out" -> if (!row.isExpense) return@filter false
        }
        if (query.isNotBlank()) {
            val q = query.trim()
            return@filter row.description.contains(q, ignoreCase = true) ||
                row.patientName.contains(q, ignoreCase = true)
        }
        true
    }

    // The KPI row describes the doctor-filtered set (like the website), but not
    // the type filter — hiding income must not make the income card read zero.
    val kpiRows = rows.filter { doctorFilter.isBlank() || it.doctorName.trim() == doctorFilter }
    val income = kpiRows.filterNot { it.isExpense }
    val cashIn = income.sumOf { it.cash }
    val expenses = kpiRows.filter { it.isExpense }.sumOf { it.cash }
    val commissions = income.sumOf { it.commission }
    val labFees = income.sumOf { it.labFee }
    val clinicNet = income.sumOf { it.clinicProfit ?: (it.cash - it.commission - it.labFee) }
    val finalNet = clinicNet - expenses

    confirmDelete?.let { target ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            containerColor = Alpha.Card,
            title = {
                Text(
                    if (arabic) "حذف هذا القيد؟" else "Delete this entry?",
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate900,
                )
            },
            text = {
                Text(
                    "${target.description.ifBlank { target.category }} — ${target.cash.toInt()} EGP",
                    color = Alpha.Slate600,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onDelete(target)
                    confirmDelete = null
                }) {
                    Text(if (arabic) "حذف" else "Delete", color = Alpha.Danger, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) {
                    Text(if (arabic) "إلغاء" else "Cancel", color = Alpha.Slate500, fontWeight = FontWeight.Bold)
                }
            },
        )
    }

    Column(Modifier.fillMaxSize()) {
        Surface(color = Alpha.Ground, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 16.dp)) {

                // Title, period toggle, and the add button.
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                    Text(
                        if (arabic) "الحسابات" else "Finance",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                    PeriodToggle(view, arabic, onSetView)
                    Spacer(Modifier.width(8.dp))
                    Surface(onClick = onAdd, shape = CircleShape, color = Alpha.Ink) {
                        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Filled.Add,
                                contentDescription = if (arabic) "إضافة قيد" else "Add entry",
                                tint = Color.White,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }

                // Period stepper.
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    IconButton(onClick = { onShift(-1) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Filled.ChevronLeft, contentDescription = "Back", tint = Alpha.Slate500)
                    }
                    Text(
                        periodLabel(view, anchor, arabic),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate700,
                        modifier = Modifier.weight(1f),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    IconButton(onClick = { onShift(1) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Filled.ChevronRight, contentDescription = "Forward", tint = Alpha.Slate500)
                    }
                }
                if (!isCurrentPeriod) {
                    Surface(
                        onClick = onToday,
                        shape = Alpha.PillShape,
                        color = Alpha.GreenSoft,
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    ) {
                        Text(
                            if (arabic) "العودة إلى اليوم" else "Back to today",
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.5.sp,
                            color = Alpha.Green,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))

                // The website's KPI row.
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(
                        value = "+${cashIn.toInt()}",
                        caption = if (arabic) "المدخول" else "Cash in",
                        tint = if (cashIn > 0) Alpha.Green else Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = "-${expenses.toInt()}",
                        caption = if (arabic) "المصروفات" else "Expenses",
                        tint = if (expenses > 0) Alpha.Danger else Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(
                        value = "-${commissions.toInt()}",
                        caption = if (arabic) "عمولات الأطباء" else "Commissions",
                        tint = if (commissions > 0) Alpha.WarnText else Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = "${finalNet.toInt()}",
                        caption = (if (arabic) "صافي الربح" else "Net profit") +
                            if (labFees > 0) (if (arabic) " (بعد المعمل)" else " (after lab)") else "",
                        tint = if (finalNet >= 0) Alpha.Slate900 else Alpha.Danger,
                        modifier = Modifier.weight(1f),
                    )
                }

                Spacer(Modifier.height(10.dp))

                // Search, then the filter chips.
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = {
                        Text(
                            if (arabic) "ابحث في الوصف أو اسم المريض" else "Search description or patient",
                            color = Alpha.Slate400,
                            fontSize = 13.sp,
                        )
                    },
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Filled.Search, null, tint = Alpha.Slate400, modifier = Modifier.size(18.dp)) },
                    shape = Alpha.PillShape,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Alpha.Green,
                        unfocusedBorderColor = if (Alpha.dark) Alpha.Slate100 else Color.Transparent,
                        focusedContainerColor = Alpha.Card,
                        unfocusedContainerColor = Alpha.Card,
                        cursorColor = Alpha.Ink,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(8.dp))

                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    item {
                        FilterPill(if (arabic) "الكل" else "All", typeFilter == "all") { typeFilter = "all" }
                    }
                    item {
                        FilterPill(if (arabic) "دخل" else "In", typeFilter == "in") { typeFilter = "in" }
                    }
                    item {
                        FilterPill(if (arabic) "مصروف" else "Out", typeFilter == "out") { typeFilter = "out" }
                    }
                    if (doctors.isNotEmpty()) {
                        item {
                            Box(
                                Modifier
                                    .padding(horizontal = 2.dp)
                                    .size(width = 1.dp, height = 22.dp)
                                    .background(Alpha.Slate200)
                            )
                        }
                        items(doctors) { doctor ->
                            FilterPill(withDoctorTitle(doctor), doctorFilter == doctor) {
                                doctorFilter = if (doctorFilter == doctor) "" else doctor
                            }
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
            }
        }

        when {
            loading -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            filtered.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (arabic) "لا توجد حركات مالية في هذه الفترة."
                    else "No money moved in this period.",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.Slate400,
                )
            }

            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(filtered, key = { it.id }) { row ->
                    FinanceRowCard(
                        row = row,
                        arabic = arabic,
                        showDate = view == "month",
                        onOpen = { onOpenRow(row) },
                        onDelete = if (row.isManual) ({ confirmDelete = row }) else null,
                    )
                }
            }
        }
    }
}

@Composable
private fun PeriodToggle(view: String, arabic: Boolean, onSetView: (String) -> Unit) {
    Surface(shape = Alpha.PillShape, color = Alpha.Slate100) {
        Row(Modifier.padding(3.dp)) {
            TogglePill(if (arabic) "يوم" else "Day", view == "day") { onSetView("day") }
            TogglePill(if (arabic) "شهر" else "Month", view == "month") { onSetView("month") }
        }
    }
}

@Composable
private fun TogglePill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Card else Color.Transparent,
        shadowElevation = if (selected && !Alpha.dark) 1.dp else 0.dp,
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Alpha.Slate900 else Alpha.Slate500,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
        )
    }
}

@Composable
private fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Ink else Alpha.Card,
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color.White else Alpha.Slate600,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            maxLines = 1,
        )
    }
}

@Composable
private fun FinanceRowCard(
    row: Repository.FinanceRow,
    arabic: Boolean,
    showDate: Boolean,
    onOpen: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    AlphaCard(
        modifier = Modifier
            .fillMaxWidth()
            .clip(Alpha.CardShape)
            .clickable(onClick = onOpen),
        shape = Alpha.CardShape,
    ) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    row.description.ifBlank { row.patientName.ifBlank { row.category.ifBlank { "—" } } },
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate900,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val detail = listOfNotNull(
                    row.patientName.takeIf { it.isNotBlank() },
                    row.doctorName.takeIf { it.isNotBlank() }?.let { withDoctorTitle(it) },
                    row.category.takeIf { it.isNotBlank() },
                    if (showDate) prettyShortDate(row.date, arabic) else null,
                ).joinToString("  ·  ")
                if (detail.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        detail,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (row.commission > 0 || row.labFee > 0) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        listOfNotNull(
                            row.commission.takeIf { it > 0 }?.let {
                                (if (arabic) "عمولة " else "commission ") + it.toInt()
                            },
                            row.labFee.takeIf { it > 0 }?.let {
                                (if (arabic) "معمل " else "lab ") + it.toInt()
                            },
                        ).joinToString("  ·  "),
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate400,
                    )
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    // Signed, so income and spending never read as the same event.
                    (if (row.isExpense) "-" else "+") + row.cash.toInt(),
                    fontSize = 15.5.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = if (row.isExpense) Alpha.Danger else Alpha.Green,
                )
                Surface(
                    shape = Alpha.PillShape,
                    color = if (row.isExpense) Alpha.DangerSoft else Alpha.GreenSoft,
                ) {
                    Text(
                        text = when {
                            row.isExpense && arabic -> "مصروف"
                            row.isExpense -> "expense"
                            row.type == "income" && arabic -> "دخل"
                            row.type == "income" -> "income"
                            arabic -> "دفعة"
                            else -> "payment"
                        },
                        fontSize = 9.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (row.isExpense) Alpha.DangerText else Alpha.Green,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                    )
                }
            }

            if (onDelete != null) {
                IconButton(onClick = onDelete, modifier = Modifier.size(34.dp)) {
                    Icon(
                        Icons.Filled.DeleteOutline,
                        contentDescription = if (arabic) "حذف" else "Delete",
                        tint = Alpha.Slate300,
                        modifier = Modifier.size(18.dp),
                    )
                }
            } else {
                Spacer(Modifier.width(8.dp))
            }
        }
    }
}

private fun periodLabel(view: String, anchor: String, arabic: Boolean): String {
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    val date = AppViewModel.parseDate(anchor)
    return if (view == "month") {
        SimpleDateFormat("MMMM yyyy", locale).format(date)
    } else {
        SimpleDateFormat("EEE, d MMM yyyy", locale).format(date)
    }
}

private fun prettyShortDate(dateKey: String, arabic: Boolean): String {
    if (dateKey.isBlank()) return ""
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    return SimpleDateFormat("d MMM", locale).format(AppViewModel.parseDate(dateKey))
}
