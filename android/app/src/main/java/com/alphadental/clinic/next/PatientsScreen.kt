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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.Person
import com.alphadental.clinic.next.design.BrandMark
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.NumberFormat
import java.util.Locale

/**
 * The patient register: browse it, or search it.
 *
 * One screen rather than two. With the box empty this is the whole register in
 * name order, because a clinic often wants to look *through* patients rather
 * than already know the name — a screen that opens on a blank prompt makes you
 * remember something before it will help.
 *
 * It reads like a contacts list, because that is what it is: ruled rows on
 * white, one line of identity each, and no card anywhere.
 */
@Composable
fun PatientsScreen(
    state: Patients,
    onSearch: (String) -> Unit,
    onLoadMore: () -> Unit,
    onOpen: (Person) -> Unit = {},
    onAdd: (() -> Unit)? = null,
) {
    Box(Modifier.fillMaxSize().background(T.ground)) {

        Column(Modifier.fillMaxSize()) {

            Slab(
                title = "Patients",
                eyebrow = registerSize(state),
                bar = {
                    BrandMark()
                    Spacer(Modifier.weight(1f))
                    if (onAdd != null) {
                        // The accent, spent once: adding a patient is what this
                        // screen is for beyond looking someone up.
                        Surface(
                            shape = CircleShape,
                            color = T.accent,
                            modifier = Modifier.clickable(onClick = onAdd),
                        ) {
                            Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Filled.Add,
                                    "Add a patient",
                                    tint = T.onAccent,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                },
            )

            SearchField(
                value = state.query,
                searching = state.searching,
                onChange = onSearch,
            )

            when {
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                }

                state.people.isEmpty() && state.debtors.isEmpty() -> Empty(state)

                else -> LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = T.barClearance),
                ) {
                    state.groups.forEach { group ->
                        if (group.label.isNotBlank()) {
                            item(key = "h-${group.label}") { SectionLabel(group.label) }
                        }
                        item(key = "g-${group.label}") {
                            RowGroup {
                                group.people.forEachIndexed { i, person ->
                                    if (i > 0) Rule()
                                    PersonRow(person) { onOpen(person) }
                                }
                            }
                        }
                    }

                    if (state.more) {
                        item(key = "more") { LoadMore(state.loadingMore, onLoadMore) }
                    } else if (!state.isSearching) {
                        // The end of a directory is worth stating: a list that
                        // simply stops looks like one that is still loading.
                        item(key = "end") {
                            Box(
                                Modifier.fillMaxWidth().padding(vertical = 22.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Txt(registerSize(state), Type.caption, T.inkFaint)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The search box.
 *
 * On white, directly under the slab, where it reads as the top of the list
 * rather than a control stranded on the ground.
 */
@Composable
private fun SearchField(value: String, searching: Boolean, onChange: (String) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier
                    .padding(horizontal = T.gutter, vertical = 12.dp)
                    .fillMaxWidth()
                    .clip(T.pill)
                    .background(T.surfaceSoft)
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Search, null, tint = T.inkFaint, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Txt("Search name or phone number", Type.body, T.inkFaint)
                    }
                    BasicTextField(
                        value = value,
                        onValueChange = onChange,
                        singleLine = true,
                        textStyle = LocalTextStyle.current.merge(Type.body).copy(color = T.ink),
                        cursorBrush = SolidColor(T.ink),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                            imeAction = ImeAction.Search,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (searching) {
                    CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                } else if (value.isNotEmpty()) {
                    Icon(
                        Icons.Filled.Close,
                        "Clear",
                        tint = T.inkMuted,
                        modifier = Modifier.size(18.dp).clickable { onChange("") },
                    )
                }
            }
            Rule()
        }
    }
}

/**
 * One patient.
 *
 * The initials disc is achromatic on purpose. It was the success green in the
 * old app, which put a colour meaning "paid" beside every name in the register —
 * colour here marks something to act on, and a person existing is not that. What
 * does get colour is a balance owed, at the far end, where it is the one thing
 * on the row anybody has to do something about.
 */
@Composable
private fun PersonRow(person: Person, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(38.dp).clip(CircleShape).background(T.surfaceSoft),
            contentAlignment = Alignment.Center,
        ) {
            Txt(person.initials, Type.label.copy(fontSize = 13.sp), T.inkMuted)
        }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Txt(person.name.ifBlank { "No name" }, Type.rowName, T.ink)
            if (person.phone.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Txt(person.phone, Type.caption, T.inkMuted)
            }
        }
        Spacer(Modifier.width(10.dp))
        if (person.balance > 0) {
            Column(horizontalAlignment = Alignment.End) {
                Txt(money(person.balance), Type.label.copy(fontSize = 13.sp), T.danger)
                Txt("EGP", Type.chip, T.inkFaint, uppercase = true)
            }
        } else {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                null,
                tint = T.lineStrong,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun LoadMore(loading: Boolean, onLoadMore: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = !loading, onClick = onLoadMore)
            .padding(vertical = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
            Txt("Load more", Type.label.copy(fontSize = 13.sp), T.accentInk)
        }
    }
}

@Composable
private fun Empty(state: Patients) {
    val message = when {
        state.error != null -> state.error
        state.isSearching -> "No patient matches that name or number."
        else -> "No patients on the register yet."
    }
    Box(Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center) {
        Txt(message, Type.body, T.inkFaint, maxLines = 3)
    }
}

/** "1,482 records", or what the search turned up. */
private fun registerSize(state: Patients): String {
    if (state.isSearching) {
        val n = state.people.size
        return if (n == 1) "1 match" else "$n matches"
    }
    val n = state.people.size
    val shown = if (state.more) "$n+" else n.toString()
    return if (n == 1 && !state.more) "1 record" else "$shown records"
}

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())
