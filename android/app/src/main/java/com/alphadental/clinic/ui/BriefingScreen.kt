package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.BriefingClient

/**
 * Today at a glance: the shape of the day, then the money nobody has chased.
 *
 * The schedule half repeats what the dashboard already shows, and is here only
 * so the page is a whole thought. The half that earns the screen is the aged
 * balances — a ledger walk the phone has no other way to do, and the one thing
 * on it that is genuinely news.
 *
 * The server's own caveat is printed at the foot rather than paraphrased: "no
 * recent activity" is not "overdue", this system records no due dates, and a
 * figure that arrives with a qualification should not be repeated without it.
 */
@Composable
fun BriefingScreen(
    briefing: BriefingClient.Briefing?,
    loading: Boolean,
    error: String?,
    arabic: Boolean,
    onOpenPatient: (String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
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
                        if (arabic) "ملخص اليوم" else "Today at a glance",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                    )
                    Text(
                        if (arabic) "محسوب من السجلات، لا من تخمين" else "Computed from records, not guessed",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                    )
                }
            }

            when {
                loading && briefing == null -> Box(
                    Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Alpha.Green, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                }

                briefing == null -> Box(
                    Modifier
                        .fillMaxSize()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    EmptyState(
                        error ?: if (arabic) "تعذّر إنشاء الملخص." else "The briefing could not be built."
                    )
                }

                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            StatTile(
                                briefing.total.toString(),
                                if (arabic) "محجوز اليوم" else "Booked today",
                                modifier = Modifier.weight(1f),
                            )
                            StatTile(
                                briefing.attended.toString(),
                                if (arabic) "حضروا" else "Turned up",
                                tint = if (briefing.attended == 0) Alpha.Slate900 else Alpha.Green,
                                modifier = Modifier.weight(1f),
                            )
                            StatTile(
                                briefing.stillScheduled.toString(),
                                if (arabic) "لم يُؤكَّد" else "Not confirmed",
                                tint = if (briefing.stillScheduled == 0) Alpha.Slate900 else Alpha.WarnText,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }

                    if (briefing.cancelled > 0) {
                        item {
                            Text(
                                text = if (arabic) {
                                    "${briefing.cancelled} ملغي اليوم"
                                } else {
                                    "${briefing.cancelled} cancelled today"
                                },
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Alpha.Pink,
                            )
                        }
                    }

                    item {
                        Spacer(Modifier.height(2.dp))
                        SectionHeading(if (arabic) "أرصدة بلا حركة" else "BALANCES WITH NO RECENT ACTIVITY")
                    }

                    if (briefing.staleBalances.isEmpty()) {
                        item {
                            EmptyState(
                                if (arabic) {
                                    "لا توجد أرصدة قديمة. لا شيء يحتاج متابعة."
                                } else {
                                    "No ageing balances. Nothing needs chasing."
                                }
                            )
                        }
                    } else {
                        item {
                            AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                                Column(Modifier.padding(16.dp)) {
                                    Text(
                                        text = "${briefing.staleBalanceTotal.toInt()} EGP",
                                        fontSize = 27.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        fontFamily = FontFamily.Serif,
                                        color = Alpha.Slate900,
                                    )
                                    Spacer(Modifier.height(2.dp))
                                    Text(
                                        text = if (arabic) {
                                            "على ${briefing.staleBalances.size} مريض"
                                        } else {
                                            "across ${briefing.staleBalances.size} patient" +
                                                if (briefing.staleBalances.size == 1) "" else "s"
                                        },
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Alpha.Slate600,
                                    )
                                }
                            }
                        }
                        items(briefing.staleBalances, key = { it.patientId }) { row ->
                            StaleBalanceRow(row, arabic) { onOpenPatient(row.patientId) }
                        }
                    }

                    if (briefing.notes.isNotEmpty()) {
                        item {
                            Spacer(Modifier.height(4.dp))
                            briefing.notes.forEach { note ->
                                Text(
                                    text = note,
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = Alpha.Slate400,
                                    modifier = Modifier.padding(bottom = 6.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One patient with money on the books and nothing recent against it. */
@Composable
private fun StaleBalanceRow(
    row: BriefingClient.StaleBalance,
    arabic: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = Alpha.CardShape,
        color = Alpha.Card,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    row.patientName,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate900,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = if (arabic) {
                        "بلا حركة منذ ${row.daysSinceLastActivity} يوم"
                    } else {
                        "nothing for ${row.daysSinceLastActivity} days"
                    },
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate500,
                )
            }
            Spacer(Modifier.size(10.dp))
            Text(
                text = "${row.balance.toInt()} EGP",
                fontSize = 15.sp,
                fontWeight = FontWeight.ExtraBold,
                fontFamily = FontFamily.Serif,
                color = Alpha.Slate900,
            )
        }
    }
}
