package com.alphadental.clinic.next

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * The sheets the clinic types into.
 *
 * Every one of them is a bottom sheet rather than a pushed screen, and that is
 * not decoration: a receptionist adding a patient is halfway through something
 * else — a phone call, a queue at the desk — and a sheet keeps what they were
 * looking at behind it. A full screen would lose their place.
 *
 * They share a frame so the Save is always in the same corner, and so no sheet
 * has to invent its own idea of what a disabled button looks like.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun Sheet(
    title: String,
    caption: String = "",
    busy: Boolean = false,
    error: String? = null,
    action: String,
    ready: Boolean,
    onAction: () -> Unit,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = T.surface,
        dragHandle = null,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(start = T.gutter, end = T.gutter, top = 20.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Txt(title, Type.heading, T.ink, maxLines = 2)
                    if (caption.isNotBlank()) {
                        Spacer(Modifier.height(3.dp))
                        Txt(caption, Type.caption, T.inkMuted, maxLines = 2)
                    }
                }
                Spacer(Modifier.width(12.dp))
                Txt(
                    "Close", Type.label.copy(fontSize = 12.sp), T.inkMuted,
                    Modifier.clickable(enabled = !busy, onClick = onDismiss),
                )
            }
            Rule()

            error?.let {
                Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
                    Txt(
                        it, Type.caption, T.danger,
                        Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                        maxLines = 4,
                    )
                }
            }

            Column(
                Modifier
                    .heightIn(max = 520.dp)
                    .verticalScroll(rememberScrollState()),
            ) { content() }

            Rule()
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    shape = T.pill,
                    color = if (ready && !busy) T.accent else T.line,
                    modifier = Modifier.clickable(enabled = ready && !busy, onClick = onAction),
                ) {
                    Box(
                        Modifier.padding(horizontal = 26.dp, vertical = 13.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (busy) {
                            CircularProgressIndicator(
                                color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(17.dp),
                            )
                        } else {
                            Txt(
                                action, Type.label.copy(fontSize = 14.sp),
                                if (ready) T.onAccent else T.inkFaint,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** A labelled box inside a sheet. */
@Composable
fun SheetField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    hint: String = "",
    numeric: Boolean = false,
    lines: Int = 1,
    enabled: Boolean = true,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp)) {
        Txt(label, Type.eyebrow, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            enabled = enabled,
            singleLine = lines == 1,
            minLines = lines,
            placeholder = if (hint.isBlank()) null else ({ Txt(hint, Type.body, T.inkFaint) }),
            keyboardOptions = KeyboardOptions(
                keyboardType = if (numeric) KeyboardType.Number else KeyboardType.Text,
            ),
            shape = T.cardShape,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = T.surfaceSoft,
                unfocusedContainerColor = T.surfaceSoft,
                disabledContainerColor = T.surfaceSoft,
                focusedTextColor = T.ink,
                unfocusedTextColor = T.ink,
                disabledTextColor = T.inkMuted,
                focusedIndicatorColor = T.lineStrong,
                unfocusedIndicatorColor = T.line,
                disabledIndicatorColor = T.line,
                cursorColor = T.ink,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** A row of choices. Scrolls sideways rather than wrapping, so the row stays one line. */
@Composable
fun SheetChoices(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp)) {
        Txt(label, Type.eyebrow, T.inkFaint, uppercase = true)
        Spacer(Modifier.height(8.dp))
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) { content() }
    }
}

@Composable
fun SheetChoice(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        shape = T.pill,
        color = if (selected) T.slab else T.surface,
        border = if (selected) null else BorderStroke(1.dp, T.line),
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Txt(
            label, Type.label.copy(fontSize = 12.sp),
            if (selected) T.onSlab else T.inkMuted,
            Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
        )
    }
}

/**
 * Find a patient, or name a new one.
 *
 * Used by booking. Typing searches the register; if nobody matches, the same
 * text becomes the new patient's name — because at a desk "Hana is here, she has
 * never been before" and "Hana is here" are the same sentence until the search
 * comes back empty.
 */
@Composable
fun PatientPicker(
    query: String,
    results: List<Person>,
    searching: Boolean,
    chosen: Person?,
    allowNew: Boolean,
    onQuery: (String) -> Unit,
    onChoose: (Person?) -> Unit,
) {
    if (chosen != null) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt(chosen.name, Type.rowName, T.ink)
                if (chosen.phone.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Txt(chosen.phone, Type.caption, T.inkMuted)
                }
            }
            Spacer(Modifier.width(10.dp))
            Txt(
                "Change", Type.label.copy(fontSize = 12.sp), T.inkMuted,
                Modifier.clickable { onChoose(null) },
            )
        }
        return
    }

    SheetField(
        label = "Patient",
        value = query,
        onChange = onQuery,
        hint = if (allowNew) "Name or phone" else "Search the register",
    )

    if (searching) {
        Box(Modifier.fillMaxWidth().padding(vertical = 14.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        }
    }

    results.forEach { person ->
        Rule()
        Row(
            Modifier.fillMaxWidth().clickable { onChoose(person) }
                .padding(horizontal = T.gutter, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt(person.name, Type.rowName, T.ink, maxLines = 1)
                if (person.phone.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Txt(person.phone, Type.caption, T.inkMuted)
                }
            }
            if (person.balance > 0) {
                Spacer(Modifier.width(10.dp))
                Txt("owes ${person.balance.toLong()}", Type.chip, T.warn, uppercase = true)
            }
        }
    }

    if (allowNew && query.trim().length >= 2 && !searching && results.isEmpty()) {
        Rule()
        Txt(
            "Nobody on the register matches. Booking will open a new file for " +
                "\"${query.trim()}\" and give it the next number.",
            Type.caption, T.inkMuted,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}
