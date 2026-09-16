package com.alphadental.clinic.next

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.alphadental.clinic.ai.MarketingClient
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/** What the studio can do. */
data class StudioActions(
    val show: (StudioTab) -> Unit,
    val setKind: (String) -> Unit,
    val setLanguage: (String) -> Unit,
    val setGoal: (String) -> Unit,
    val setService: (String) -> Unit,
    val setOccasion: (String) -> Unit,
    val setTone: (String) -> Unit,
    val setOffer: (String) -> Unit,
    val setNotes: (String) -> Unit,
    val generate: () -> Unit,
    val save: (MarketingClient.Variant) -> Unit,
)

/**
 * The content studio.
 *
 * Four questions and a button: what to write, what about, how it should sound,
 * and in which language. What comes back is words on a screen with Copy and
 * Share under them — nothing here posts anything anywhere, because the clinic's
 * accounts are the clinic's.
 */
@Composable
fun MarketingScreen(state: Studio, onBack: () -> Unit, actions: StudioActions) {
    val context = LocalContext.current

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Content",
            eyebrow = if (state.variants.isEmpty()) "Write a post" else "Copy it where it is going",
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
            },
        )

        if (!state.canUse && !state.loading) {
            Txt(
                "This account does not have marketing switched on.",
                Type.body, T.inkMuted,
                Modifier.padding(T.gutter),
                maxLines = 3,
            )
            return@Column
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            StudioTab.entries.forEach { t ->
                SettingsPill(t.label, solid = state.tab == t) { actions.show(t) }
            }
        }

        state.error?.let { message ->
            Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                Txt(message, Type.caption, T.danger, Modifier.padding(T.gutter), maxLines = 4)
            }
        }
        state.saved?.let { message ->
            Txt(
                message, Type.caption, T.inkMuted,
                Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
            )
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            if (state.tab == StudioTab.Library) {
                if (state.library.isEmpty()) {
                    item { SettingsEmpty("Nothing saved yet. Anything you keep turns up here.") }
                }
                items(state.library.size) { i ->
                    val row = state.library[i]
                    RowGroup {
                        Txt(
                            row.title.ifBlank { row.kind },
                            Type.rowName, T.ink,
                            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp),
                            maxLines = 2,
                        )
                        Txt(
                            row.body, Type.body, T.inkMuted,
                            Modifier.padding(start = T.gutter, end = T.gutter, top = 4.dp),
                            maxLines = 6,
                        )
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            SettingsPill("Copy") { context.copy(row.body) }
                            SettingsPill("Share") { context.share(row.body) }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                }
                return@LazyColumn
            }

            item { SectionLabel("What to write") }
            item {
                Pills(MarketingClient.KINDS.map { it.id to it.en }, state.kind, actions.setKind)
            }
            item {
                Pills(
                    listOf("ar" to "In Arabic", "en" to "In English"),
                    state.language,
                    actions.setLanguage,
                )
            }

            item { SectionLabel("What it is for") }
            item {
                Pills(MarketingClient.GOALS.map { it.id to it.en }, state.goal, actions.setGoal)
            }

            if (state.services.isNotEmpty()) {
                item { SectionLabel("Which treatment") }
                item {
                    Pills(
                        listOf("" to "None in particular") + state.services.map { it to it },
                        state.service,
                        actions.setService,
                    )
                }
            }

            item { SectionLabel("Occasion") }
            item {
                Pills(MarketingClient.OCCASIONS.map { it.id to it.en }, state.occasion, actions.setOccasion)
            }

            item { SectionLabel("How it should sound") }
            item {
                Pills(MarketingClient.TONES.map { it.id to it.en }, state.tone, actions.setTone)
            }

            item {
                RowGroup {
                    SettingsField("The offer, if there is one", state.offer, actions.setOffer, hint = "20% this month")
                    Rule()
                    SettingsField("Anything else", state.notes, actions.setNotes, lines = 2, hint = "")
                }
            }

            item {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Txt(
                        // Said plainly, once, next to the button that spends them.
                        "Writing a piece uses AI credits.",
                        Type.caption, T.inkFaint, Modifier.weight(1f), maxLines = 2,
                    )
                    Spacer(Modifier.width(10.dp))
                    if (state.generating) {
                        CircularProgressIndicator(
                            color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(20.dp),
                        )
                    } else {
                        SettingsPill("Write it", solid = true, onClick = actions.generate)
                    }
                }
            }

            items(state.variants.size) { i ->
                val variant = state.variants[i]
                val text = variant.asText()
                RowGroup {
                    if (variant.title.isNotBlank()) {
                        Txt(
                            variant.title, Type.rowName, T.ink,
                            Modifier.padding(start = T.gutter, end = T.gutter, top = 14.dp),
                            maxLines = 2,
                        )
                    }
                    Txt(
                        text, Type.body, T.ink,
                        Modifier.padding(start = T.gutter, end = T.gutter, top = 8.dp),
                        maxLines = 40,
                    )
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SettingsPill("Copy") { context.copy(text) }
                        SettingsPill("Share") { context.share(text) }
                        SettingsPill(
                            if (state.savingTitle == variant.title) "Saving…" else "Keep",
                            solid = true,
                        ) { actions.save(variant) }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }

            if (state.loading) {
                item {
                    Box(Modifier.fillMaxWidth().padding(30.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
    }
}

/** A scrolling row of choices, stored by id and shown by label. */
@Composable
private fun Pills(options: List<Pair<String, String>>, chosen: String, onPick: (String) -> Unit) {
    Row(
        Modifier
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = T.gutter, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { (id, label) ->
            SettingsPill(label, solid = chosen == id) { onPick(id) }
        }
    }
}

private fun Context.copy(text: String) {
    val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    clip.setPrimaryClip(ClipData.newPlainText("Alpha Dental", text))
}

/**
 * Hand the words to whatever the phone can post with.
 *
 * A share sheet rather than a direct Instagram call: the clinic signs into its
 * own accounts on its own phone, and this app never holds those credentials.
 */
private fun Context.share(text: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    runCatching { startActivity(Intent.createChooser(intent, "Share")) }
}
