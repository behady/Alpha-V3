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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ReportLine
import com.alphadental.clinic.data.ReportSummary

/** The periods an owner actually asks about. */
enum class ReportRange { WEEK, MONTH, LAST_MONTH }

/**
 * The clinic's numbers over a stretch of days.
 *
 * The Money tab answers "what happened today". This answers "how are we doing", which is the
 * question that gets asked away from the clinic — on a sofa, at the end of a month — and which
 * previously meant opening a laptop.
 *
 * Collected and charged stay apart, as they do everywhere else in the system. Adding them would
 * flatter every period by counting treatment nobody has paid for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsSheet(
    range: ReportRange,
    rangeLabel: String,
    summary: ReportSummary?,
    loading: Boolean,
    arabic: Boolean,
    onRange: (ReportRange) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                if (arabic) "التقارير" else "Reports",
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                color = Alpha.Slate900,
            )
            Text(
                rangeLabel,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate500,
                modifier = Modifier.padding(top = 4.dp),
            )

            Spacer(Modifier.height(14.dp))

            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ReportRange.entries.toList()) { option ->
                    FilterChip(
                        selected = range == option,
                        onClick = { onRange(option) },
                        label = {
                            Text(
                                rangeName(option, arabic),
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

            Spacer(Modifier.height(16.dp))

            when {
                loading -> Box(
                    Modifier.fillMaxWidth().padding(vertical = 44.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                }

                summary == null -> Text(
                    if (arabic) "لا توجد بيانات في هذه الفترة." else "Nothing recorded in this period.",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate400,
                )

                else -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile(
                            value = "${summary.collected.toInt()}",
                            caption = if (arabic) "تم تحصيله" else "Collected",
                            tint = if (summary.collected > 0) Alpha.Green else Alpha.Slate900,
                            modifier = Modifier.weight(1f),
                        )
                        StatTile(
                            value = "${summary.charged.toInt()}",
                            caption = if (arabic) "تمت فوترته" else "Charged",
                            modifier = Modifier.weight(1f),
                        )
                    }

                    Spacer(Modifier.height(10.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile(
                            value = "${summary.payingPatients}",
                            caption = if (arabic) "مريض دفع" else "Patients paid",
                            modifier = Modifier.weight(1f),
                        )
                        StatTile(
                            value = "${summary.expenses.toInt()}",
                            caption = if (arabic) "مصروفات" else "Expenses",
                            tint = if (summary.expenses > 0) Color(0xFFE11D48) else Alpha.Slate900,
                            modifier = Modifier.weight(1f),
                        )
                    }

                    // Said in words rather than shown as a third tile, because it is a difference
                    // between two flows in one window and not a debt anyone owes — a patient can
                    // pay in March for work charged in February.
                    if (summary.gap > 0) {
                        Spacer(Modifier.height(10.dp))
                        Surface(shape = Alpha.CardShape, color = Color(0xFFFEF3C7), modifier = Modifier.fillMaxWidth()) {
                            Text(
                                if (arabic)
                                    "فُوتر ${summary.gap.toInt()} ج.م أكثر مما حُصّل في هذه الفترة. قد يكون بعضه دفعات قادمة."
                                else
                                    "${summary.gap.toInt()} EGP more was billed than collected in this period. Some of it may simply be paid later.",
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF92400E),
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    }

                    ReportList(
                        title = if (arabic) "الأكثر دخلاً" else "TOP TREATMENTS",
                        lines = summary.byService,
                        emptyText = if (arabic) "لا توجد فواتير." else "Nothing billed.",
                        arabic = arabic,
                    )

                    ReportList(
                        title = if (arabic) "حسب الطبيب" else "BY DENTIST",
                        lines = summary.byDoctor,
                        emptyText = if (arabic)
                            "لا توجد دفعات منسوبة لطبيب."
                        else
                            "No payments credited to a dentist.",
                        arabic = arabic,
                    )
                }
            }
        }
    }
}

@Composable
private fun ReportList(title: String, lines: List<ReportLine>, emptyText: String, arabic: Boolean) {
    Spacer(Modifier.height(18.dp))
    SectionHeading(title)
    Spacer(Modifier.height(8.dp))

    if (lines.isEmpty()) {
        Text(emptyText, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate400)
        return
    }

    Column(
        Modifier.heightIn(max = 260.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // Capped at ten. A phone-sized list of every service a clinic has ever billed is a wall of
        // numbers nobody reads; the tail belongs on the website where it can be sorted and exported.
        lines.take(10).forEach { line ->
            Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
                Row(
                    Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            line.label,
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate900,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (arabic) "${line.count} مرة" else "${line.count}×",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
                    }
                    Text(
                        "${line.total.toInt()}",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate800,
                    )
                }
            }
        }
        if (lines.size > 10) {
            Text(
                if (arabic) "و${lines.size - 10} أخرى — افتح النظام لعرضها كاملة."
                else "and ${lines.size - 10} more — open the full system to see them all.",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }
}

private fun rangeName(range: ReportRange, arabic: Boolean): String = when (range) {
    ReportRange.WEEK -> if (arabic) "آخر ٧ أيام" else "Last 7 days"
    ReportRange.MONTH -> if (arabic) "هذا الشهر" else "This month"
    ReportRange.LAST_MONTH -> if (arabic) "الشهر الماضي" else "Last month"
}
