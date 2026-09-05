package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import com.alphadental.clinic.data.SourceLine

/** The periods an owner actually asks about. */
enum class ReportRange { WEEK, MONTH, LAST_MONTH }

/**
 * The clinic's numbers, as a full page.
 *
 * Four questions an owner asks, in the order they ask them: how are we doing (collected, charged,
 * expenses), what earns the money (top treatments), who earns it (per dentist), and where do
 * patients come from (new patients by source). The Money tab answers "what happened today"; this
 * answers "how is the clinic doing" — the question asked from a sofa, not a front desk.
 *
 * Collected and charged stay apart here as everywhere else. Adding them would flatter every
 * period by counting treatment nobody has paid for.
 */
@Composable
fun ReportsScreen(
    range: ReportRange,
    rangeLabel: String,
    summary: ReportSummary?,
    sources: List<SourceLine>,
    newPatients: Int,
    loading: Boolean,
    arabic: Boolean,
    onRange: (ReportRange) -> Unit,
    onClose: () -> Unit,
    /** The last read failed; the summary is null when this is set. */
    error: String? = null,
    onRefresh: () -> Unit = {},
) {
    BackHandler { onClose() }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {

            Row(
                Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Column {
                    Text(
                        if (arabic) "التقارير" else "Reports",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                    )
                    Text(
                        rangeLabel,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate400,
                    )
                }
            }

            RefreshBox(
                refreshing = loading && summary != null,
                onRefresh = onRefresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp),
                ) {
                    error?.let {
                        LoadErrorBanner(it, arabic, onRefresh, Modifier.padding(bottom = 10.dp))
                    }
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

                    Spacer(Modifier.height(14.dp))

                    when {
                        loading && summary == null -> Box(
                            Modifier.fillMaxWidth().padding(vertical = 44.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(
                                color = Alpha.Slate400,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(26.dp),
                            )
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
                                    tint = if (summary.expenses > 0) Alpha.Danger else Alpha.Slate900,
                                    modifier = Modifier.weight(1f),
                                )
                            }

                            // Said in words rather than shown as a tile, because it is a difference
                            // between two flows in one window and not a debt anyone owes — a patient
                            // can pay in March for work charged in February.
                            if (summary.gap > 0) {
                                Spacer(Modifier.height(10.dp))
                                Surface(
                                    shape = Alpha.CardShape,
                                    color = Alpha.WarnBg,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        if (arabic)
                                            "فُوتر ${summary.gap.toInt()} ج.م أكثر مما حُصّل في هذه الفترة. قد يكون بعضه دفعات قادمة."
                                        else
                                            "${summary.gap.toInt()} EGP more was billed than collected in this period. Some of it may simply be paid later.",
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.WarnText,
                                        modifier = Modifier.padding(12.dp),
                                    )
                                }
                            }

                            // The shape of the period: money in, day by day. Bars rather than
                            // numbers, because the question here is "how were we trending",
                            // and the exact figures already sit in the tiles above.
                            if (summary.dailyCollected.size > 1) {
                                Spacer(Modifier.height(18.dp))
                                SectionHeading(if (arabic) "التحصيل يوماً بيوم" else "COLLECTED DAY BY DAY")
                                Spacer(Modifier.height(8.dp))
                                AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                                    Column(Modifier.padding(14.dp)) {
                                        TrendStrip(summary.dailyCollected)
                                        Spacer(Modifier.height(6.dp))
                                        Row {
                                            Text(
                                                shortDay(summary.dailyCollected.first().date, arabic),
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                color = Alpha.Slate400,
                                                modifier = Modifier.weight(1f),
                                            )
                                            Text(
                                                shortDay(summary.dailyCollected.last().date, arabic),
                                                fontSize = 10.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                color = Alpha.Slate400,
                                            )
                                        }
                                    }
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

                            // Where patients come from — the marketing question. Counted from
                            // patients REGISTERED in the period, grouped by the same referral field
                            // the website's Sources report reads.
                            Spacer(Modifier.height(18.dp))
                            SectionHeading(if (arabic) "مرضى جدد ومصادرهم" else "NEW PATIENTS AND SOURCES")
                            Spacer(Modifier.height(8.dp))
                            StatTile(
                                value = "$newPatients",
                                caption = if (arabic) "مريض جديد في الفترة" else "New patients this period",
                                tint = if (newPatients > 0) Alpha.Green else Alpha.Slate900,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Spacer(Modifier.height(8.dp))
                            if (sources.isEmpty()) {
                                Text(
                                    if (arabic) "لا يوجد مرضى جدد في هذه الفترة."
                                    else "No new patients in this period.",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate400,
                                )
                            } else {
                                val topSources = sources.take(10)
                                val maxCount = topSources.maxOf { it.count }.coerceAtLeast(1)
                                topSources.forEach { line ->
                                    Surface(
                                        shape = Alpha.CardShape,
                                        color = Alpha.Card,
                                        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
                                    ) {
                                        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    line.label,
                                                    fontSize = 13.5.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    color = Alpha.Slate900,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    modifier = Modifier.weight(1f),
                                                )
                                                Text(
                                                    "${line.count}",
                                                    fontSize = 14.sp,
                                                    fontWeight = FontWeight.ExtraBold,
                                                    color = Alpha.Slate800,
                                                )
                                            }
                                            Spacer(Modifier.height(7.dp))
                                            MiniBar(
                                                fraction = line.count.toFloat() / maxCount,
                                                color = Alpha.Mint,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

/** A thin horizontal bar filled to a fraction — the charts on this page. */
@Composable
private fun MiniBar(fraction: Float, color: Color) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(6.dp)
            .background(Alpha.Slate100, Alpha.PillShape)
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0.02f, 1f))
                .height(6.dp)
                .background(color, Alpha.PillShape)
        )
    }
}

/** Collections day by day as upright bars, tallest day = full height. */
@Composable
private fun TrendStrip(points: List<com.alphadental.clinic.data.DayPoint>) {
    val max = points.maxOf { it.collected }.coerceAtLeast(1.0)
    Row(
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        modifier = Modifier.fillMaxWidth().height(56.dp),
    ) {
        points.forEach { point ->
            val fraction = (point.collected / max).toFloat()
            Box(
                Modifier
                    .weight(1f)
                    .height((4 + 52 * fraction).dp)
                    .background(
                        if (point.collected > 0) Alpha.Green else Alpha.Slate100,
                        Alpha.PillShape,
                    )
            )
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

    // Capped at ten. A phone-sized list of every service a clinic has ever billed is a wall of
    // numbers nobody reads; the tail belongs on the website where it can be sorted and exported.
    val top = lines.take(10)
    val max = top.maxOf { it.total }.coerceAtLeast(1.0)
    top.forEach { line ->
        Surface(
            shape = Alpha.CardShape,
            color = Alpha.Card,
            modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        line.label,
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate900,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        if (arabic) "${line.count} مرة" else "${line.count}×",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate400,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(
                        "${line.total.toInt()}",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate800,
                    )
                }
                Spacer(Modifier.height(7.dp))
                // The bar is the chart: how this line compares with the biggest one.
                MiniBar(fraction = (line.total / max).toFloat(), color = Alpha.Green)
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

/** "12 Aug" under the trend strip's first and last bar. */
private fun shortDay(dateKey: String, arabic: Boolean): String {
    if (dateKey.isBlank()) return ""
    val locale = if (arabic) java.util.Locale("ar", "EG") else java.util.Locale.US
    val parsed = runCatching {
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).parse(dateKey)
    }.getOrNull() ?: return dateKey
    return java.text.SimpleDateFormat("d MMM", locale).format(parsed)
}

private fun rangeName(range: ReportRange, arabic: Boolean): String = when (range) {
    ReportRange.WEEK -> if (arabic) "آخر ٧ أيام" else "Last 7 days"
    ReportRange.MONTH -> if (arabic) "هذا الشهر" else "This month"
    ReportRange.LAST_MONTH -> if (arabic) "الشهر الماضي" else "Last month"
}
