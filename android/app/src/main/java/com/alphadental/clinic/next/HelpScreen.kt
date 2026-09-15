package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.alphadental.clinic.BuildConfig
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * How the thing works, on the thing itself.
 *
 * The articles are written for the whole system rather than for the phone, and
 * that is on purpose: somebody asking "how do commissions work" wants the answer
 * about commissions, not the answer about commissions on Android. Where a screen
 * genuinely differs, the app says so at the point of use instead.
 */
@Composable
fun HelpScreen(state: Help, onBack: () -> Unit, onSearch: (String) -> Unit, onOpen: (Article?) -> Unit) {
    val article = state.open

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = article?.title ?: "Help",
            eyebrow = article?.roles?.takeIf { it.isNotBlank() }
                ?: "${state.articles.size} articles",
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back") {
                    if (article != null) onOpen(null) else onBack()
                }
                Spacer(Modifier.weight(1f))
            },
        )

        state.error?.let { message ->
            Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                Txt(message, Type.caption, T.danger, Modifier.padding(T.gutter), maxLines = 3)
            }
        }

        if (state.loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
            return@Column
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            if (article != null) {
                markdown(article.body)
                item { Spacer(Modifier.height(20.dp)) }
                return@LazyColumn
            }

            item {
                Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = state.query,
                        onValueChange = onSearch,
                        singleLine = true,
                        placeholder = { Txt("What are you trying to do?", Type.body, T.inkFaint) },
                        shape = T.pill,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = T.surfaceSoft,
                            unfocusedContainerColor = T.surfaceSoft,
                            focusedTextColor = T.ink,
                            unfocusedTextColor = T.ink,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                            cursorColor = T.ink,
                        ),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp),
                    )
                }
            }

            val sections = state.sections
            if (sections.isEmpty()) {
                item { SettingsEmpty("Nothing matches that.") }
            }

            sections.forEach { (title, rows) ->
                item(key = "h-$title") { SectionLabel(title) }
                item(key = "s-$title") {
                    RowGroup {
                        rows.forEachIndexed { i, row ->
                            if (i > 0) Rule()
                            Column(
                                Modifier
                                    .fillMaxWidth()
                                    .clickable { onOpen(row) }
                                    .padding(horizontal = T.gutter, vertical = 13.dp),
                            ) {
                                Txt(row.title, Type.rowName, T.ink, maxLines = 2)
                                if (row.summary.isNotBlank()) {
                                    Spacer(Modifier.height(2.dp))
                                    Txt(row.summary, Type.caption, T.inkMuted, maxLines = 3)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Enough markdown for these articles, and no more.
 *
 * Headings, bullets, numbered steps, quotes, images and bold. A full parser
 * would be a dependency and a week; what the articles actually use is this, and
 * anything unrecognised falls through as a paragraph rather than as markup
 * printed on the screen.
 */
private fun LazyListScope.markdown(body: String) {
    val blocks = body.replace("\r\n", "\n").split("\n\n")

    blocks.forEachIndexed { index, raw ->
        val block = raw.trim()
        if (block.isEmpty()) return@forEachIndexed

        item(key = "md-$index") {
            when {
                block.startsWith("### ") -> Txt(
                    block.removePrefix("### ").inline(),
                    Type.label, T.ink,
                    Modifier.padding(start = T.gutter, end = T.gutter, top = 18.dp, bottom = 4.dp),
                    maxLines = 3,
                )

                block.startsWith("## ") -> Txt(
                    block.removePrefix("## ").inline(),
                    Type.heading, T.ink,
                    Modifier.padding(start = T.gutter, end = T.gutter, top = 22.dp, bottom = 6.dp),
                    maxLines = 3,
                )

                block.startsWith("# ") -> Txt(
                    block.removePrefix("# ").inline(),
                    Type.title, T.ink,
                    Modifier.padding(start = T.gutter, end = T.gutter, top = 18.dp, bottom = 6.dp),
                    maxLines = 3,
                )

                block.startsWith("![") -> {
                    // The screenshots are served by the website. Absent without
                    // a connection, which is the right way round: the words are
                    // the help and the picture is the illustration.
                    val url = block.substringAfter("](").substringBefore(")")
                    val full = if (url.startsWith("http")) url else BuildConfig.WEB_URL.trimEnd('/') + url
                    AsyncImage(
                        model = full,
                        contentDescription = block.substringAfter("![").substringBefore("]"),
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = T.gutter, vertical = 10.dp)
                            .clip(T.cardShape),
                    )
                }

                block.startsWith("|") -> Table(block)

                block.startsWith("> ") -> Surface(
                    color = T.surfaceSoft,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 8.dp),
                ) {
                    Txt(
                        block.lines().joinToString(" ") { it.removePrefix("> ").trim() }.inline(),
                        Type.body, T.inkMuted,
                        Modifier.padding(T.gutter),
                        maxLines = 20,
                    )
                }

                block.startsWith("- ") || block.startsWith("* ") || block.firstOrNull()?.isDigit() == true ->
                    Column(Modifier.padding(horizontal = T.gutter, vertical = 4.dp)) {
                        block.lines().forEach { line ->
                            val clean = line.trim()
                            if (clean.isEmpty()) return@forEach
                            val numbered = clean.firstOrNull()?.isDigit() == true && clean.contains(". ")
                            Row(Modifier.padding(vertical = 4.dp)) {
                                Txt(
                                    if (numbered) clean.substringBefore(". ") + "." else "·",
                                    Type.body, T.inkFaint,
                                    Modifier.width(22.dp),
                                )
                                Txt(
                                    (if (numbered) clean.substringAfter(". ") else clean.removePrefix("- ").removePrefix("* ")).inline(),
                                    Type.body, T.ink, maxLines = 12,
                                )
                            }
                        }
                    }

                block.startsWith("---") -> Rule()

                else -> Txt(
                    block.replace("\n", " ").inline(),
                    Type.body, T.ink,
                    Modifier.padding(horizontal = T.gutter, vertical = 8.dp),
                    maxLines = 40,
                )
            }
        }
    }
}

/**
 * A markdown table, turned on its side.
 *
 * Four columns of "| Field | Required | Notes |" is unreadable at phone width
 * and was, until this, printed as the pipes themselves. Each row becomes a small
 * block instead — the first cell as its name, the rest as labelled lines — which
 * is the same information in the shape a narrow screen can hold.
 */
@Composable
private fun Table(block: String) {
    val rows = block.lines()
        .map { it.trim().trim('|').split("|").map(String::trim) }
        // The |---|---| rule under the header carries nothing to show.
        .filterNot { cells -> cells.all { it.isEmpty() || it.all { c -> c == '-' || c == ':' } } }
    if (rows.isEmpty()) return

    val header = rows.first()
    val body = rows.drop(1)

    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 8.dp)) {
        body.forEach { cells ->
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Txt(cells.firstOrNull().orEmpty().inline(), Type.rowName, T.ink, maxLines = 3)
                cells.drop(1).forEachIndexed { i, cell ->
                    if (cell.isBlank()) return@forEachIndexed
                    Spacer(Modifier.height(3.dp))
                    Row {
                        header.getOrNull(i + 1)?.takeIf { it.isNotBlank() }?.let { label ->
                            Txt(
                                label.inline() + ": ",
                                Type.caption, T.inkFaint,
                            )
                        }
                        Txt(cell.inline(), Type.caption, T.inkMuted, maxLines = 6)
                    }
                }
            }
            Rule()
        }
    }
}

/**
 * Inline markers, removed rather than rendered.
 *
 * `**Press New Patient**` reads perfectly well as "Press New Patient"; it reads
 * badly as "**Press New Patient**". Bold within a line is a nicety this screen
 * can do without — leaving the asterisks in is the one outcome that is actually
 * wrong.
 */
private fun String.inline(): String = this
    .replace("**", "")
    .replace("`", "")
    // A link becomes its own words. The destinations are website routes, which a
    // phone cannot usefully open in place anyway.
    .replace(Regex("""\[([^\]]+)]\([^)]*\)"""), "$1")
    .trim()
