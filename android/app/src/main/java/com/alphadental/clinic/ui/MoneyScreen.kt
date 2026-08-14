package com.alphadental.clinic.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.Repository
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * What money moved on one day.
 *
 * The dashboard gives a single takings figure; this is what that figure is made of. A number an
 * owner cannot break down is a number they end up re-counting by hand, which is the thing the
 * system is supposed to replace.
 *
 * Collected and charged are shown side by side and never added together — they answer different
 * questions, and a combined "today's money" would flatter the day by counting work that has been
 * billed but not paid for.
 */
@Composable
fun MoneyScreen(
    date: String,
    rows: List<Repository.DayLedgerRow>,
    loading: Boolean,
    arabic: Boolean,
    isToday: Boolean,
    onShiftDay: (Int) -> Unit,
    onToday: () -> Unit,
) {
    val collected = rows.filter { it.isPayment }.sumOf { it.amount }
    val charged = rows.filterNot { it.isPayment || it.type == "expense" }.sumOf { it.amount }

    Column(Modifier.fillMaxSize()) {
        Surface(color = Alpha.Ground, modifier = Modifier.fillMaxWidth()) {
            Column {
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { onShiftDay(-1) }) {
                        Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous day", tint = Alpha.Slate600)
                    }
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            if (arabic) "الحسابات" else "Money",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Black,
                            color = Alpha.Slate900,
                        )
                        Text(
                            prettyMoneyDate(date, arabic),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate500,
                        )
                    }
                    IconButton(onClick = { onShiftDay(1) }) {
                        Icon(Icons.Filled.ChevronRight, contentDescription = "Next day", tint = Alpha.Slate600)
                    }
                }

                if (!isToday) {
                    TextButton(onClick = onToday, modifier = Modifier.padding(start = 12.dp)) {
                        Text(
                            if (arabic) "العودة إلى اليوم" else "Back to today",
                            fontWeight = FontWeight.Black,
                            fontSize = 13.sp,
                            color = Alpha.Green,
                        )
                    }
                }

                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    StatTile(
                        value = "${collected.toInt()} EGP",
                        caption = if (arabic) "تم تحصيله" else "Collected",
                        tint = if (collected > 0) Alpha.Green else Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                    StatTile(
                        value = "${charged.toInt()} EGP",
                        caption = if (arabic) "تمت فوترته" else "Charged",
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(6.dp))
            }
        }

        when {
            loading -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            rows.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(32.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (arabic) "لا توجد حركات مالية في هذا اليوم."
                    else "No money moved on this day.",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate400,
                )
            }

            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(rows, key = { it.id }) { row ->
                    AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    row.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" },
                                    fontSize = 14.5.sp,
                                    fontWeight = FontWeight.Black,
                                    color = Alpha.Slate900,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (row.description.isNotBlank()) {
                                    Text(
                                        row.description,
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Alpha.Slate400,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                if (row.addedBy.isNotBlank()) {
                                    Text(
                                        (if (arabic) "بواسطة " else "by ") + row.addedBy,
                                        fontSize = 10.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate300,
                                    )
                                }
                            }

                            Column(horizontalAlignment = Alignment.End) {
                                Text(
                                    // Signed, so a charge and a payment of the same size never
                                    // read as the same event at a glance.
                                    (if (row.isPayment) "+" else "") + "${row.amount.toInt()}",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (row.isPayment) Alpha.Green else Alpha.Slate600,
                                )
                                Surface(
                                    shape = Alpha.PillShape,
                                    color = if (row.isPayment) Color(0xFFD1FAE5) else Color(0xFFE2E8F0),
                                ) {
                                    Text(
                                        text = when {
                                            row.isPayment && arabic -> "دفعة"
                                            row.isPayment -> "paid"
                                            arabic -> "فاتورة"
                                            else -> "charged"
                                        },
                                        fontSize = 9.5.sp,
                                        fontWeight = FontWeight.Black,
                                        color = if (row.isPayment) Color(0xFF065F46) else Alpha.Slate600,
                                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
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

private fun prettyMoneyDate(dateKey: String, arabic: Boolean): String {
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    return SimpleDateFormat("EEE, d MMM", locale).format(AppViewModel.parseDate(dateKey))
}
