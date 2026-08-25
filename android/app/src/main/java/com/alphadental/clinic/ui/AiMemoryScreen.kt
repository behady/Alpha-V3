package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * What the assistant has taught itself about this clinic.
 *
 * Its `learn_fact` tool saves a rule whenever someone corrects it or states a
 * clinic policy — "Dr. Ahmed doesn't work Tuesdays" — and every answer it gives
 * afterwards is shaped by that list. Until this screen there was no way to read
 * it, so a rule recorded wrongly, or one that used to be true, kept quietly
 * steering answers with nobody able to find it.
 *
 * Deliberately plain: a list and a way to remove a line. Nothing here can add a
 * rule, because rules are meant to be learned from conversation rather than
 * typed into a settings form — the point of the screen is oversight, not entry.
 */
@Composable
fun AiMemoryScreen(
    facts: List<String>,
    loading: Boolean,
    error: String?,
    arabic: Boolean,
    onForget: (String) -> Unit,
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
                        if (arabic) "ما تعلّمه المساعد" else "What Alpha has learned",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                    )
                    Text(
                        if (arabic) "قواعد يستخدمها في كل إجابة" else "Rules it applies to every answer",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                    )
                }
            }

            if (error != null) {
                Spacer(Modifier.height(8.dp))
                Surface(
                    shape = Alpha.CardShape,
                    color = Alpha.DangerSoft,
                    modifier = Modifier
                        .padding(horizontal = 16.dp)
                        .fillMaxWidth(),
                ) {
                    Text(
                        error,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.DangerText,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            when {
                loading -> Box(
                    Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Alpha.Green, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                }

                facts.isEmpty() -> Box(
                    Modifier
                        .fillMaxSize()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    EmptyState(
                        if (arabic) {
                            "لم يحفظ المساعد أي قاعدة بعد. عندما تصحّح له معلومة أو تخبره بسياسة العيادة، ستظهر هنا."
                        } else {
                            "The assistant hasn't saved any rules yet. When you correct it, " +
                                "or tell it how the clinic works, what it remembers appears here."
                        }
                    )
                }

                else -> LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        Text(
                            if (arabic) {
                                "المساعد يقرأ هذه القواعد قبل كل إجابة. احذف أي قاعدة لم تعد صحيحة."
                            } else {
                                "The assistant reads these before answering anything. " +
                                    "Remove any that is no longer true."
                            },
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate500,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }
                    items(facts, key = { it }) { fact ->
                        FactRow(fact = fact, arabic = arabic, onForget = { onForget(fact) })
                    }
                }
            }
        }
    }
}

/**
 * One learned rule, numbered the way the assistant is shown them, with a single
 * tap to forget it.
 *
 * The tap arms rather than deletes: the list is small and the rows are close
 * together, and a rule removed by a mis-tap is invisible afterwards — there is
 * no undo once the assistant has stopped believing something.
 */
@Composable
private fun FactRow(fact: String, arabic: Boolean, onForget: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }

    AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    text = fact,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate800,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.size(8.dp))
                IconButton(onClick = { confirming = !confirming }, modifier = Modifier.size(28.dp)) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = if (arabic) "نسيان" else "Forget",
                        tint = if (confirming) Alpha.Danger else Alpha.Slate400,
                        modifier = Modifier.size(17.dp),
                    )
                }
            }

            if (confirming) {
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (arabic) "ينسى المساعد هذه القاعدة؟" else "Have the assistant forget this?",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate600,
                        modifier = Modifier.weight(1f),
                    )
                    Surface(
                        onClick = onForget,
                        shape = Alpha.PillShape,
                        color = Alpha.DangerSoft,
                    ) {
                        Text(
                            if (arabic) "انسَ" else "Forget",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Default,
                            color = Alpha.DangerText,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                        )
                    }
                }
            }
        }
    }
}
