package com.alphadental.clinic.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.ai.MarketingClient

/**
 * The clinic's content studio, on the phone.
 *
 * The idea for a post turns up in the surgery, looking at a result somebody is proud of — not at
 * a desk an hour later when it has gone. So this asks the four questions the website asks (what
 * the post is for, what it is about, how it should sound, and in which language), has the same
 * server route write it, and hands back something to copy.
 *
 * Nothing is published from here. What comes back is text: copy it, or share it into Instagram
 * or Facebook with the phone's own share sheet. A clinic's account stays in the clinic's hands.
 */
@Composable
fun MarketingScreen(
    variants: List<MarketingClient.Variant>,
    library: List<MarketingClient.SavedItem>,
    services: List<String>,
    generating: Boolean,
    savingId: String,
    error: String?,
    arabic: Boolean,
    onGenerate: (kind: String, language: String, goal: String, service: String, occasion: String, tone: String, offer: String, notes: String) -> Unit,
    onSave: (MarketingClient.Variant, kind: String, language: String, goal: String, service: String, occasion: String, tone: String) -> Unit,
    onClose: () -> Unit,
) {
    BackHandler { onClose() }
    val context = LocalContext.current

    var tab by rememberSaveable { mutableStateOf("write") }
    var kind by rememberSaveable { mutableStateOf("post") }
    // The language of the POST, not of the app: a clinic read in English still writes in Arabic.
    var language by rememberSaveable { mutableStateOf(if (arabic) "ar" else "en") }
    var goal by rememberSaveable { mutableStateOf("awareness") }
    var service by rememberSaveable { mutableStateOf("") }
    var occasion by rememberSaveable { mutableStateOf("") }
    var tone by rememberSaveable { mutableStateOf("friendly") }
    var offer by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
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
                        if (arabic) "المحتوى" else "Content studio",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "اكتب منشوراً وانسخه للمنصة" else "Write a post, then copy it to the platform",
                        fontSize = 12.sp,
                        color = Alpha.Slate500,
                    )
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                StudioTab(if (arabic) "اكتب" else "Write", tab == "write", Modifier.weight(1f)) { tab = "write" }
                StudioTab(if (arabic) "المكتبة" else "Library", tab == "library", Modifier.weight(1f)) { tab = "library" }
            }

            error?.let {
                Text(
                    it,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.DangerText,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }

            if (tab == "library") {
                LibraryTab(library, arabic) { context.copy(it) }
                return@Column
            }

            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
            ) {
                Field(if (arabic) "النوع" else "What are you making") {
                    ChoiceRow(MarketingClient.KINDS.map { it.id to it.label(arabic) }, kind) { kind = it }
                }
                Field(if (arabic) "لغة المنشور" else "Language of the post") {
                    ChoiceRow(
                        listOf("ar" to (if (arabic) "عربي" else "Arabic"), "en" to (if (arabic) "إنجليزي" else "English")),
                        language,
                    ) { language = it }
                }
                Field(if (arabic) "الهدف" else "What it is for") {
                    ChoiceRow(MarketingClient.GOALS.map { it.id to it.label(arabic) }, goal) { goal = it }
                }
                if (services.isNotEmpty()) {
                    Field(if (arabic) "الخدمة" else "About which treatment") {
                        ChoiceRow(services.map { it to it }, service) { service = if (service == it) "" else it }
                    }
                }
                Field(if (arabic) "المناسبة" else "Occasion") {
                    ChoiceRow(MarketingClient.OCCASIONS.map { it.id to it.label(arabic) }, occasion) { occasion = it }
                }
                Field(if (arabic) "النبرة" else "How it should sound") {
                    ChoiceRow(MarketingClient.TONES.map { it.id to it.label(arabic) }, tone) { tone = it }
                }
                SettingsField(
                    if (arabic) "العرض، إن وُجد" else "The offer, if there is one",
                    offer,
                    { offer = it },
                    hint = if (arabic) "خصم ٢٠٪ حتى آخر الشهر" else "20% off until the end of the month",
                )
                SettingsField(
                    if (arabic) "أي شيء آخر" else "Anything else to say",
                    notes,
                    { notes = it },
                    hint = if (arabic) "اختياري" else "optional",
                    lines = 3,
                )

                Spacer(Modifier.height(18.dp))
                Button(
                    onClick = { onGenerate(kind, language, goal, service, occasion, tone, offer, notes) },
                    enabled = !generating,
                    shape = Alpha.PillShape,
                    colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    if (generating) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    else Text(if (arabic) "اكتبه" else "Write it", fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    if (arabic) "يستهلك رصيد ذكاء. لا يُنشر شيء — النص يُنسخ ويُلصق."
                    else "Uses AI credit. Nothing is published — the text is yours to copy and paste.",
                    fontSize = 11.sp,
                    color = Alpha.Slate400,
                )

                variants.forEach { variant ->
                    Spacer(Modifier.height(14.dp))
                    AlphaCard(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            if (variant.title.isNotBlank()) {
                                Text(variant.title, fontSize = 15.sp, fontWeight = FontWeight.ExtraBold, color = Alpha.Slate900)
                                Spacer(Modifier.height(6.dp))
                            }
                            Text(variant.asText(), fontSize = 13.5.sp, color = Alpha.Slate800, lineHeight = 20.sp)
                            Spacer(Modifier.height(12.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { context.copy(variant.asText()) }, shape = Alpha.PillShape) {
                                    Icon(Icons.Filled.ContentCopy, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (arabic) "نسخ" else "Copy", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                                }
                                OutlinedButton(onClick = { context.share(variant.asText()) }, shape = Alpha.PillShape) {
                                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Green)
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (arabic) "مشاركة" else "Share", color = Alpha.Green, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                                }
                                OutlinedButton(
                                    onClick = { onSave(variant, kind, language, goal, service, occasion, tone) },
                                    enabled = savingId != variant.title,
                                    shape = Alpha.PillShape,
                                ) {
                                    Icon(Icons.Filled.Save, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                                    Spacer(Modifier.width(5.dp))
                                    Text(if (arabic) "احفظ" else "Keep", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
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

@Composable
private fun LibraryTab(library: List<MarketingClient.SavedItem>, arabic: Boolean, onCopy: (String) -> Unit) {
    if (library.isEmpty()) {
        Box(Modifier.fillMaxSize().padding(16.dp)) {
            EmptyState(if (arabic) "لا يوجد محتوى محفوظ بعد." else "Nothing kept yet.")
        }
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(library, key = { it.id }) { item ->
            AlphaCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            item.title.ifBlank { item.kind },
                            fontSize = 14.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate900,
                            modifier = Modifier.weight(1f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Surface(shape = Alpha.PillShape, color = Alpha.Slate100) {
                            Text(
                                item.kind,
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.Bold,
                                color = Alpha.Slate600,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(item.body, fontSize = 12.5.sp, color = Alpha.Slate600, maxLines = 4, overflow = TextOverflow.Ellipsis, lineHeight = 18.sp)
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = {
                            onCopy(
                                buildString {
                                    append(item.body)
                                    if (item.hashtags.isNotEmpty()) {
                                        append("\n\n")
                                        append(item.hashtags.joinToString(" ") { if (it.startsWith("#")) it else "#$it" })
                                    }
                                }
                            )
                        },
                        shape = Alpha.PillShape,
                    ) {
                        Icon(Icons.Filled.ContentCopy, contentDescription = null, modifier = Modifier.size(15.dp), tint = Alpha.Slate900)
                        Spacer(Modifier.width(5.dp))
                        Text(if (arabic) "نسخ" else "Copy", color = Alpha.Slate900, fontWeight = FontWeight.Bold, fontSize = 12.5.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun StudioTab(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = Alpha.PillShape,
        color = if (selected) Alpha.Ink else Alpha.Card,
        border = if (selected) null else BorderStroke(1.dp, Alpha.Slate200),
        modifier = modifier,
    ) {
        Text(
            label,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Color.White else Alpha.Slate700,
            modifier = Modifier.padding(vertical = 10.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
private fun Field(label: String, content: @Composable () -> Unit) {
    Spacer(Modifier.height(14.dp))
    Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate600)
    Spacer(Modifier.height(6.dp))
    content()
}

@Composable
private fun ChoiceRow(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    ) {
        options.forEach { (id, label) ->
            val on = selected == id
            Surface(
                onClick = { onPick(id) },
                shape = Alpha.PillShape,
                color = if (on) Alpha.Ink else Alpha.Card,
                border = if (on) null else BorderStroke(1.dp, Alpha.Slate200),
            ) {
                Text(
                    label,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (on) Color.White else Alpha.Slate700,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                )
            }
        }
    }
}

private fun Context.copy(text: String) {
    runCatching {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Alpha Dental", text))
    }
}

/** The phone's own share sheet, which is how the post reaches Instagram or Facebook. */
private fun Context.share(text: String) {
    runCatching {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
