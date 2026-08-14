package com.alphadental.clinic.ui

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.UnpaidProcedure

/**
 * Take a payment.
 *
 * Two kinds, matching the website: against a specific treatment, or as a general payment on the
 * account. The distinction is not cosmetic — a payment tied to a treatment carries the doctor's
 * commission and the lab's fee, and a general one does not, so choosing wrongly quietly
 * misreports who earned what.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentSheet(
    patientName: String,
    outstanding: List<UnpaidProcedure>,
    owed: Double,
    loading: Boolean,
    saving: Boolean,
    arabic: Boolean,
    onSave: (procedure: UnpaidProcedure?, amount: Double) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // null means the general-account option rather than "nothing chosen yet", so the sheet is
    // usable the moment it opens even for a patient with no itemised treatments.
    var selected by remember { mutableStateOf<UnpaidProcedure?>(null) }
    var chosenGeneral by remember { mutableStateOf(false) }
    var amountText by remember { mutableStateOf("") }

    val amount = amountText.replace(",", "").toDoubleOrNull() ?: 0.0
    val hasChoice = selected != null || chosenGeneral
    val tooMuch = selected?.let { amount > it.remaining + 0.001 } ?: false
    val canSave = hasChoice && amount > 0 && !tooMuch && !saving

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        DismissKeyboardBeforeSheet()
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.AccountBalanceWallet, null, tint = Alpha.Green, modifier = Modifier.size(22.dp))
                Spacer(Modifier.size(10.dp))
                Column {
                    Text(
                        if (arabic) "تسجيل دفعة" else "Take a payment",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate900,
                    )
                    Text(patientName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate500)
                }
            }

            if (owed > 0) {
                Spacer(Modifier.height(12.dp))
                Surface(shape = Alpha.CardShape, color = Color(0xFFFEF3C7), modifier = Modifier.fillMaxWidth()) {
                    Text(
                        (if (arabic) "المستحق حالياً: " else "Currently outstanding: ") + "${owed.toInt()} EGP",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Black,
                        color = Color(0xFF92400E),
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            Spacer(Modifier.height(18.dp))
            SectionHeading(if (arabic) "الدفعة مقابل" else "PAYMENT FOR")
            Spacer(Modifier.height(8.dp))

            if (loading) {
                Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                }
            } else {
                Column(Modifier.heightIn(max = 260.dp).verticalScroll(rememberScrollState())) {
                    outstanding.forEach { procedure ->
                        val isSelected = selected?.id == procedure.id
                        ChoiceRow(
                            title = procedure.description,
                            subtitle = buildString {
                                append(if (arabic) "متبقٍ " else "Remaining ")
                                append("${procedure.remaining.toInt()} EGP")
                                if (procedure.paidSoFar > 0) {
                                    append(if (arabic) " · مدفوع " else " · paid ")
                                    append("${procedure.paidSoFar.toInt()}")
                                }
                            },
                            selected = isSelected,
                        ) {
                            selected = procedure
                            chosenGeneral = false
                            // Pre-fill the balance: settling in full is the common case, and
                            // retyping a number already on screen is the sort of friction that
                            // gets a payment recorded as a round number instead of the real one.
                            amountText = procedure.remaining.toInt().toString()
                        }
                    }

                    ChoiceRow(
                        title = if (arabic) "دفعة عامة على الحساب" else "General payment on account",
                        subtitle = if (arabic) "دفعة مقدمة أو رصيد تحت الحساب"
                        else "An advance or deposit, not tied to one treatment",
                        selected = chosenGeneral,
                    ) {
                        chosenGeneral = true
                        selected = null
                        amountText = ""
                    }
                }
            }

            Spacer(Modifier.height(18.dp))

            OutlinedTextField(
                value = amountText,
                onValueChange = { input -> amountText = input.filter { it.isDigit() || it == '.' } },
                label = { Text(if (arabic) "المبلغ (جنيه)" else "Amount (EGP)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                isError = tooMuch,
                supportingText = if (tooMuch) {
                    {
                        Text(
                            if (arabic) "أكبر من المتبقي على هذا العلاج."
                            else "More than what is still owed on this treatment.",
                            fontSize = 12.sp,
                            color = Color(0xFFE11D48),
                        )
                    }
                } else null,
                shape = Alpha.CardShape,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Alpha.Green,
                    unfocusedBorderColor = Alpha.Slate200,
                    focusedContainerColor = Color.White,
                    unfocusedContainerColor = Alpha.Slate50,
                    focusedLabelColor = Alpha.Green,
                    unfocusedLabelColor = Alpha.Slate400,
                    cursorColor = Alpha.Ink,
                ),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(18.dp))

            Button(
                onClick = { onSave(selected, amount) },
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
                        if (arabic) "تسجيل الدفعة" else "Record payment",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                    )
                }
            }

            // The website messages the patient a receipt through the server, which this app does
            // not call. Said out loud so nobody assumes the patient was notified.
            Spacer(Modifier.height(10.dp))
            Text(
                if (arabic) "تُسجَّل الدفعة فوراً. لا تُرسل رسالة إيصال للمريض من التطبيق."
                else "The payment is recorded immediately. No receipt message is sent to the patient from the app.",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }
}

@Composable
private fun ChoiceRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        shape = Alpha.CardShape,
        color = if (selected) Alpha.GreenSoft else Alpha.Slate50,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
    ) {
        TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (selected) Alpha.Slate900 else Alpha.Slate800,
                )
                Text(subtitle, fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Alpha.Slate500)
            }
            if (selected) {
                Text("✓", fontSize = 16.sp, fontWeight = FontWeight.Black, color = Alpha.Green)
            }
        }
    }
}
