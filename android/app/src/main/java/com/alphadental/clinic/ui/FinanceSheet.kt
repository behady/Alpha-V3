package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
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
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * A manual ledger line — the same five fields as the website's "Manual Ledger
 * Entry" form: income or expense, day, description, amount and category.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FinanceSheet(
    defaultDate: String,
    saving: Boolean,
    arabic: Boolean,
    onSave: (income: Boolean, amount: Double, description: String, category: String, dateKey: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var income by remember { mutableStateOf(false) }
    var amountText by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("General") }
    var dateKey by remember { mutableStateOf(defaultDate) }

    val amount = amountText.toDoubleOrNull() ?: 0.0
    val canSave = amount > 0 && description.isNotBlank() && !saving

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
        ) {
            Text(
                if (arabic) "قيد يدوي" else "Manual entry",
                fontSize = 19.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Text(
                if (arabic) "مصروف أو دخل خارج ملفات المرضى — فاتورة كهرباء، إيجار، دخل آخر."
                else "Money outside patient files — an electricity bill, rent, other income.",
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate500,
            )

            Spacer(Modifier.height(16.dp))

            // Expense first: it is what this form exists for nine times out of ten.
            Surface(shape = Alpha.PillShape, color = Alpha.Slate100, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(3.dp)) {
                    SheetToggle(
                        label = if (arabic) "مصروف" else "Expense",
                        selected = !income,
                        selectedColor = Alpha.Danger,
                        modifier = Modifier.weight(1f),
                    ) { income = false }
                    SheetToggle(
                        label = if (arabic) "دخل" else "Income",
                        selected = income,
                        selectedColor = Alpha.Green,
                        modifier = Modifier.weight(1f),
                    ) { income = true }
                }
            }

            Spacer(Modifier.height(14.dp))

            SectionHeading(if (arabic) "اليوم" else "DAY")
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { dateKey = shiftKey(dateKey, -1) }, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Earlier", tint = Alpha.Slate500)
                }
                Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.weight(1f)) {
                    Text(
                        prettyEntryDate(dateKey, arabic),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate800,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(vertical = 10.dp),
                    )
                }
                IconButton(
                    onClick = { if (dateKey < AppViewModel.today()) dateKey = shiftKey(dateKey, 1) },
                    modifier = Modifier.size(34.dp),
                ) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Later", tint = Alpha.Slate500)
                }
            }

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = description,
                onValueChange = { description = it },
                label = { Text(if (arabic) "الوصف" else "Description") },
                placeholder = { Text(if (arabic) "مثال: فاتورة كهرباء" else "e.g. Electricity bill", color = Alpha.Slate400) },
                singleLine = true,
                shape = Alpha.CardShape,
                colors = financeFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(10.dp))

            OutlinedTextField(
                value = amountText,
                onValueChange = { new -> amountText = new.filter { it.isDigit() || it == '.' } },
                label = { Text(if (arabic) "المبلغ (ج.م)" else "Amount (EGP)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                shape = Alpha.CardShape,
                colors = financeFieldColors(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(14.dp))

            SectionHeading(if (arabic) "الفئة" else "CATEGORY")
            Spacer(Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CATEGORIES.forEach { (value, en, ar) ->
                    val selected = category == value
                    Surface(
                        onClick = { category = value },
                        shape = Alpha.PillShape,
                        color = if (selected) Alpha.Ink else Alpha.Slate50,
                    ) {
                        Text(
                            if (arabic) ar else en,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (selected) Color.White else Alpha.Slate600,
                            modifier = Modifier.padding(horizontal = 13.dp, vertical = 7.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = { onSave(income, amount, description.trim(), category, dateKey) },
                enabled = canSave,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(10.dp))
                }
                Text(
                    when {
                        arabic && income -> "حفظ الدخل"
                        arabic -> "حفظ المصروف"
                        income -> "Save income"
                        else -> "Save expense"
                    },
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/** Value stored in the ledger, English label, Arabic label. Matches the website's list. */
private val CATEGORIES = listOf(
    Triple("General", "General", "عام"),
    Triple("Supplies", "Supplies", "مستلزمات"),
    Triple("Rent", "Rent", "إيجار"),
    Triple("Salary", "Salary", "رواتب"),
    Triple("Lab", "Lab", "معمل"),
)

@Composable
private fun SheetToggle(
    label: String,
    selected: Boolean,
    selectedColor: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Card else Color.Transparent,
        shadowElevation = if (selected && !Alpha.dark) 1.dp else 0.dp,
        modifier = modifier,
    ) {
        Text(
            label,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) selectedColor else Alpha.Slate500,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(vertical = 8.dp),
        )
    }
}

@Composable
private fun financeFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Alpha.Green,
    unfocusedBorderColor = Alpha.Slate200,
    focusedContainerColor = Alpha.Card,
    unfocusedContainerColor = Alpha.Slate50,
    focusedLabelColor = Alpha.Green,
    unfocusedLabelColor = Alpha.Slate400,
    cursorColor = Alpha.Ink,
)

private fun shiftKey(dateKey: String, delta: Int): String {
    val cal = Calendar.getInstance()
    cal.time = AppViewModel.parseDate(dateKey)
    cal.add(Calendar.DAY_OF_YEAR, delta)
    return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)
}

private fun prettyEntryDate(dateKey: String, arabic: Boolean): String {
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    val label = SimpleDateFormat("EEE, d MMM yyyy", locale).format(AppViewModel.parseDate(dateKey))
    return if (dateKey == AppViewModel.today()) {
        (if (arabic) "اليوم — " else "Today — ") + label
    } else label
}
