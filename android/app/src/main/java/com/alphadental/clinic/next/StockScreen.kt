package com.alphadental.clinic.next

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.InventoryItem
import com.alphadental.clinic.next.design.Chip
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.SectionLabel
import com.alphadental.clinic.next.design.Slab
import com.alphadental.clinic.next.design.SlabIcon
import com.alphadental.clinic.next.design.Stat
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type
import java.text.NumberFormat
import java.util.Locale

/**
 * The clinic's shelf.
 *
 * Ordered by what has run out, because nobody opens a stock list to admire what
 * is in stock — they open it to find out what to buy. Empty first, then low,
 * then everything else.
 */
@Composable
fun StockScreen(state: Stock, onBack: () -> Unit, actions: StockActions) {
    if (state.open != null) {
        StockItemScreen(state, onBack = actions.close, actions = actions)
        return
    }

    var adding by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }

    if (adding) {
        ItemEditor(
            item = InventoryItem(),
            state = state,
            onBack = { adding = false },
            onSave = { actions.save(it); adding = false },
        )
        return
    }

    Column(Modifier.fillMaxSize().background(T.ground)) {

        Slab(
            title = "Stock",
            eyebrow = when {
                state.loading -> "The shelf"
                state.out.isNotEmpty() -> "${state.out.size} gone"
                state.low.isNotEmpty() -> "${state.low.size} running out"
                state.items.isEmpty() -> "Nothing on the shelf"
                else -> "Nothing to reorder"
            },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                SlabIcon(Icons.Filled.Search, "Search", onClick = { searching = !searching })
                if (state.canAdd) {
                    Spacer(Modifier.width(8.dp))
                    SlabIcon(Icons.Filled.Add, "Add an item", onClick = { adding = true })
                }
            },
            stats = if (state.loading || (state.error != null && state.items.isEmpty())) emptyList() else listOf(
                Stat("Running out", state.low.size.toString()),
                Stat("Gone", state.out.size.toString()),
                Stat("Items", state.items.size.toString()),
                Stat("No threshold", state.unset.size.toString()),
            ),
        )

        if (searching) {
            Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = state.search,
                    onValueChange = actions.search,
                    singleLine = true,
                    placeholder = { Txt("Name or category", Type.body, T.inkFaint) },
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

        Filters(state, actions.filter)

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            state.error != null && state.items.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center,
            ) { Txt(state.error, Type.body, T.inkFaint, maxLines = 3) }

            state.shown.isEmpty() -> Box(
                Modifier.fillMaxSize().padding(T.gutter), contentAlignment = Alignment.Center,
            ) { Txt(emptyFor(state.filter, state.search), Type.body, T.inkFaint, maxLines = 2) }

            else -> LazyColumn(
                Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance),
            ) {
                state.error?.let { item { Banner(it) } }
                item {
                    RowGroup {
                        state.shown.forEachIndexed { i, row ->
                            if (i > 0) Rule()
                            ItemRow(row) { actions.open(row.item.id) }
                        }
                    }
                }
                if (state.filter == StockFilter.Unset && state.unset.isNotEmpty()) {
                    item {
                        Txt(
                            "Nothing here has a reorder level, so nothing here can ever be reported " +
                                "as running out. A threshold of zero is the old default, not a " +
                                "decision to be told when it hits empty.",
                            Type.caption, T.inkMuted,
                            Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                            maxLines = 4,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Filters(state: Stock, onFilter: (StockFilter) -> Unit) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Row(
                Modifier.horizontalScroll(rememberScrollState())
                    .padding(horizontal = T.gutter, vertical = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StockFilter.entries.forEach { f ->
                    val count = when (f) {
                        StockFilter.Low -> state.low.size
                        StockFilter.Out -> state.out.size
                        StockFilter.Unset -> state.unset.size
                        StockFilter.All -> state.items.size
                    }
                    val on = f == state.filter
                    Surface(
                        shape = T.pill,
                        color = if (on) T.slab else T.surface,
                        border = if (on) null else BorderStroke(1.dp, T.line),
                        modifier = Modifier.clickable { onFilter(f) },
                    ) {
                        Txt(
                            if (count > 0) "${f.label} · $count" else f.label,
                            Type.label.copy(fontSize = 12.sp),
                            if (on) T.onSlab else T.inkMuted,
                            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        )
                    }
                }
            }
            Rule()
        }
    }
}

@Composable
private fun ItemRow(row: StockRow, onOpen: () -> Unit) {
    val stripe = when {
        row.out && row.configured -> T.danger
        row.low -> T.warn
        !row.configured -> T.lineStrong
        else -> T.ok
    }

    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).height(IntrinsicSize.Min),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(stripe))
        Row(
            Modifier.padding(start = T.gutter - 3.dp, end = T.gutter, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Txt(row.item.name, Type.rowName, T.ink, maxLines = 2)
                Spacer(Modifier.height(3.dp))
                Txt(
                    listOfNotNull(
                        row.item.category.takeIf { it.isNotBlank() },
                        row.thresholdLabel,
                    ).joinToString(" · "),
                    Type.caption,
                    if (!row.configured) T.inkFaint else T.inkMuted,
                    maxLines = 1,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                Txt(
                    row.quantity,
                    Type.label.copy(fontSize = 14.sp),
                    when {
                        row.out && row.configured -> T.danger
                        row.low -> T.warn
                        else -> T.ink
                    },
                )
                if (row.out && row.configured) {
                    Spacer(Modifier.height(4.dp))
                    Chip("Gone", T.dangerTint, T.danger)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------

/**
 * One item, and the two things that happen at a shelf.
 *
 * A box was used, or a delivery arrived. The count is the whole top of the
 * screen because it is the only thing anybody standing at a cupboard wants to
 * change; the item's details are underneath, behind their own Save.
 */
@Composable
private fun StockItemScreen(state: Stock, onBack: () -> Unit, actions: StockActions) {
    BackHandler { onBack() }
    val row = state.openItem

    if (row == null) {
        Column(Modifier.fillMaxSize().background(T.ground)) {
            Slab(title = "Item", bar = { SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack) })
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = T.inkFaint, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }
        }
        return
    }

    var editing by remember(row.item.id) { mutableStateOf(false) }

    if (editing) {
        ItemEditor(
            item = row.item,
            state = state,
            onBack = { editing = false },
            onSave = { actions.save(it); editing = false },
        )
        return
    }

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = row.item.name,
            eyebrow = row.item.category.ifBlank { "Stock" },
            bar = {
                SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack)
                Spacer(Modifier.weight(1f))
                if (state.busy) {
                    CircularProgressIndicator(color = T.onSlabFaint, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                }
            },
        )

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            state.error?.let { item { Banner(it) } }

            item {
                Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 22.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Txt(
                            row.quantity,
                            Type.figure,
                            when {
                                row.out && row.configured -> T.danger
                                row.low -> T.warn
                                else -> T.ink
                            },
                        )
                        Spacer(Modifier.height(6.dp))
                        Txt(
                            when {
                                !row.configured -> "No reorder level, so this is never reported as low"
                                row.out -> row.thresholdLabel + " — it is gone"
                                row.low -> row.thresholdLabel + " — time to buy"
                                else -> row.thresholdLabel
                            },
                            Type.caption,
                            if (row.low) T.warn else T.inkMuted,
                            maxLines = 2,
                        )
                    }
                }
            }

            if (state.canEdit) {
                item { SectionLabel("Count it") }
                item { Adjust(row, actions.adjust) }
            }

            item { SectionLabel("The item") }
            item {
                RowGroup {
                    Fact("Category", row.item.category.ifBlank { "General" })
                    if (row.item.subCategory.isNotBlank()) {
                        Rule()
                        Fact("Sub-category", row.item.subCategory)
                    }
                    Rule()
                    Fact("Counted in", if (row.item.isPercentage) "Percentage of a container" else row.item.unit.ifBlank { "pcs" })
                    Rule()
                    Fact("Reorder at", if (row.configured) trim(row.item.minStock) else "Not set")
                    if (row.item.costPerUnit > 0) {
                        Rule()
                        Fact("Cost each", money(row.item.costPerUnit))
                        Rule()
                        Fact("On the shelf", money(row.value))
                    }
                    if (state.canEdit) {
                        Rule()
                        Row(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                            SettingsPill("Edit this item") { editing = true }
                        }
                    }
                }
            }

            item {
                Txt(
                    // Not an oversight: it is the repository's rule and the right
                    // one, so it is said rather than discovered.
                    "Editing an item never changes the count. A form left open while somebody " +
                        "else takes a delivery would otherwise put the old figure back.",
                    Type.caption, T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 16.dp),
                    maxLines = 3,
                )
            }
        }
    }
}

/** Minus and plus, at the sizes a shelf actually moves in. */
@Composable
private fun Adjust(row: StockRow, onAdjust: (Double) -> Unit) {
    var custom by remember(row.item.id) { mutableStateOf("") }
    val steps = if (row.item.isPercentage) listOf(5.0, 10.0, 25.0) else listOf(1.0, 5.0, 10.0)

    RowGroup {
        steps.forEach { step ->
            Row(
                Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Txt(
                    if (row.item.isPercentage) "${trim(step)}%" else trim(step),
                    Type.rowName, T.ink, Modifier.weight(1f),
                )
                SettingsPill("− used") { onAdjust(-step) }
                Spacer(Modifier.width(8.dp))
                SettingsPill("+ in", solid = true) { onAdjust(step) }
            }
            Rule()
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                OutlinedTextField(
                    value = custom,
                    onValueChange = { custom = it.filter { c -> c.isDigit() || c == '.' } },
                    singleLine = true,
                    placeholder = { Txt("Another amount", Type.body, T.inkFaint) },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                    ),
                    shape = T.cardShape,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = T.surfaceSoft,
                        unfocusedContainerColor = T.surfaceSoft,
                        focusedTextColor = T.ink,
                        unfocusedTextColor = T.ink,
                        focusedIndicatorColor = T.lineStrong,
                        unfocusedIndicatorColor = T.line,
                        cursorColor = T.ink,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.width(10.dp))
            val amount = custom.toDoubleOrNull() ?: 0.0
            SettingsPill("−") { if (amount > 0) { onAdjust(-amount); custom = "" } }
            Spacer(Modifier.width(6.dp))
            SettingsPill("+", solid = amount > 0) { if (amount > 0) { onAdjust(amount); custom = "" } }
        }
        Rule()
        Txt(
            "A count never goes below zero. A negative shelf is a miscount, not a state, and " +
                "storing one makes every total after it wrong.",
            Type.caption, T.inkFaint,
            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
            maxLines = 3,
        )
    }
}

/** Add or change an item. Never its count — see the note on the item screen. */
@Composable
private fun ItemEditor(
    item: InventoryItem,
    state: Stock,
    onBack: () -> Unit,
    onSave: (InventoryItem) -> Unit,
) {
    BackHandler { onBack() }
    val isNew = item.id.isBlank()

    var name by remember(item.id) { mutableStateOf(item.name) }
    var category by remember(item.id) { mutableStateOf(item.category) }
    var sub by remember(item.id) { mutableStateOf(item.subCategory) }
    var unit by remember(item.id) { mutableStateOf(item.unit) }
    var min by remember(item.id) { mutableStateOf(if (item.minStock > 0) trim(item.minStock) else "") }
    var cost by remember(item.id) { mutableStateOf(if (item.costPerUnit > 0) trim(item.costPerUnit) else "") }
    var opening by remember(item.id) { mutableStateOf(if (isNew) "" else trim(item.stock)) }
    var percentage by remember(item.id) { mutableStateOf(item.isPercentage) }

    val edited = item.copy(
        name = name,
        category = category,
        subCategory = sub,
        unit = unit,
        minStock = min.toDoubleOrNull() ?: 0.0,
        costPerUnit = cost.toDoubleOrNull() ?: 0.0,
        stock = if (isNew) (opening.toDoubleOrNull() ?: 0.0) else item.stock,
        isPercentage = percentage,
    )

    Column(Modifier.fillMaxSize().background(T.ground)) {
        Slab(
            title = if (isNew) "New item" else name.ifBlank { "Item" },
            eyebrow = if (isNew) "Not saved yet" else "On the shelf",
            bar = { SlabIcon(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClick = onBack) },
        )
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = T.barClearance)) {
            item {
                RowGroup {
                    SettingsField("Name", name, { name = it }, hint = "Composite A2 syringe")
                    SettingsField("Category", category, { category = it }, hint = "Restorative")
                    SettingsField("Sub-category", sub, { sub = it })
                }
            }

            if (state.categories.isNotEmpty()) {
                item {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState())
                            .padding(horizontal = T.gutter, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        state.categories.forEach { c ->
                            SettingsPill(c, solid = category == c) { category = c }
                        }
                    }
                }
            }

            item { SectionLabel("How it is counted") }
            item {
                RowGroup {
                    SettingsToggle(
                        title = "Count as a percentage",
                        caption = if (percentage) {
                            "How much of the container is left, rather than how many there are."
                        } else {
                            "A plain count of whole things."
                        },
                        checked = percentage,
                        enabled = true,
                    ) { percentage = it }
                    if (!percentage) {
                        Rule()
                        SettingsField("One of these is a", unit, { unit = it }, hint = "pcs, box, ml")
                    }
                    Rule()
                    SettingsField(
                        "Tell me when it drops to", min, { min = it.filter { c -> c.isDigit() || c == '.' } },
                        numeric = true, hint = "0 means never",
                    )
                    Rule()
                    Txt(
                        "Left at zero, this item is never reported as running out. That is the old " +
                            "default rather than a decision, and it is why a shelf can look healthy " +
                            "while half of it is unconfigured.",
                        Type.caption, T.inkMuted,
                        Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                        maxLines = 4,
                    )
                }
            }

            item { SectionLabel("Money") }
            item {
                RowGroup {
                    SettingsField(
                        "Cost of one", cost, { cost = it.filter { c -> c.isDigit() || c == '.' } },
                        numeric = true, hint = "0",
                    )
                }
            }

            if (isNew) {
                item { SectionLabel("Opening count") }
                item {
                    RowGroup {
                        SettingsField(
                            "How many there are now", opening,
                            { opening = it.filter { c -> c.isDigit() || c == '.' } },
                            numeric = true, hint = "0",
                        )
                        Rule()
                        Txt(
                            "Only asked once. After this the count changes by adjustment, so two " +
                                "people cannot overwrite each other's counts with a stale form.",
                            Type.caption, T.inkFaint,
                            Modifier.padding(horizontal = T.gutter, vertical = 12.dp),
                            maxLines = 3,
                        )
                    }
                }
            }

            item {
                SettingsSave(
                    dirty = edited != item,
                    enabled = name.isNotBlank() && (if (isNew) state.canAdd else state.canEdit),
                ) { onSave(edited) }
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(label, Type.body, T.inkMuted, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Txt(value, Type.label.copy(fontSize = 13.sp), T.ink, maxLines = 2)
    }
}

@Composable
private fun Banner(text: String) {
    Surface(color = T.dangerTint, modifier = Modifier.fillMaxWidth()) {
        Txt(text, Type.caption, T.danger, Modifier.padding(horizontal = T.gutter, vertical = 13.dp), maxLines = 3)
    }
}

private fun emptyFor(filter: StockFilter, search: String): String = when {
    search.isNotBlank() -> "Nothing matches \"$search\"."
    filter == StockFilter.Low -> "Nothing is running out."
    filter == StockFilter.Out -> "Nothing has run out."
    filter == StockFilter.Unset -> "Every item has a reorder level."
    else -> "Nothing on the shelf yet."
}

private fun money(value: Double): String =
    NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())

/** Everything the stock screens can ask for. */
data class StockActions(
    val filter: (StockFilter) -> Unit,
    val search: (String) -> Unit,
    val open: (String) -> Unit,
    val close: () -> Unit,
    val adjust: (Double) -> Unit,
    val save: (InventoryItem) -> Unit,
)
