package com.alphadental.clinic.next

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.alphadental.clinic.data.InventoryItem
import com.alphadental.clinic.data.Repository
import com.alphadental.clinic.data.hasThreshold
import com.alphadental.clinic.data.isLowStock
import com.alphadental.clinic.next.data.ClinicSource
import com.alphadental.clinic.next.data.Who
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class StockFilter(val label: String) {
    Low("Running out"),
    Out("Gone"),
    Unset("No threshold"),
    All("Everything"),
}

/** One item, with the judgements the shelf is coloured by. */
data class StockRow(val item: InventoryItem) {
    /** A threshold of 0 is the field's old default, not "tell me when it hits empty". */
    val configured: Boolean get() = hasThreshold(item)

    val low: Boolean get() = isLowStock(item)

    /** Actually gone. Worth its own colour: low is a reminder, empty is a problem now. */
    val out: Boolean get() = item.stock <= 0.0

    /** "12 boxes", "40%" — what one of these is counted in. */
    val quantity: String
        get() = if (item.isPercentage) "${trim(item.stock)}%"
        else "${trim(item.stock)} ${item.unit.ifBlank { "pcs" }}"

    val thresholdLabel: String
        get() = if (!configured) "no threshold set"
        else if (item.isPercentage) "reorder at ${trim(item.minStock)}%"
        else "reorder at ${trim(item.minStock)}"

    /** What the shelf is worth, when somebody bothered to record a cost. */
    val value: Double get() = item.stock * item.costPerUnit
}

data class Stock(
    val loading: Boolean = true,
    val who: Who? = null,
    val items: List<StockRow> = emptyList(),
    val filter: StockFilter = StockFilter.Low,
    val open: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val search: String = "",
) {
    val canAdd: Boolean get() = who?.can("inventory.add") == true
    val canEdit: Boolean get() = who?.can("inventory.edit") == true

    val openItem: StockRow? get() = items.firstOrNull { it.item.id == open }

    val low: List<StockRow> get() = items.filter { it.low }
    val out: List<StockRow> get() = items.filter { it.out && it.configured }

    /**
     * Items nobody ever gave a reorder level.
     *
     * Counted out loud rather than folded in with the healthy ones. The website
     * learned this the hard way: treating an unset threshold as "fine" made a
     * low-stock check report all-clear over a shelf nobody had configured.
     */
    val unset: List<StockRow> get() = items.filterNot { it.configured }

    val shown: List<StockRow>
        get() {
            val base = when (filter) {
                StockFilter.Low -> low
                StockFilter.Out -> out
                StockFilter.Unset -> unset
                StockFilter.All -> items
            }
            val term = search.trim().lowercase()
            val matched = if (term.isBlank()) base else base.filter {
                it.item.name.lowercase().contains(term) ||
                    it.item.category.lowercase().contains(term) ||
                    it.item.subCategory.lowercase().contains(term)
            }
            return matched.sortedWith(
                // Empty first, then low, then the rest by name. A shelf list is
                // read to find out what to buy, not to admire what is in stock.
                compareBy<StockRow>(
                    { if (it.out && it.configured) 0 else if (it.low) 1 else 2 },
                    { it.item.name.lowercase() },
                )
            )
        }

    /** Every category in use, for the editor's suggestions. */
    val categories: List<String>
        get() = items.map { it.item.category.trim() }.filter { it.isNotBlank() }
            .distinct().sorted()
}

/**
 * The clinic's shelf.
 *
 * Ordered by what has run out, because a stock list is read to find out what to
 * buy. The two writes it offers are the two things that happen at a shelf: a box
 * was used, and a delivery arrived.
 *
 * `Repository` does the writing, and its two rules are worth keeping: a stock
 * level is clamped at zero, because a negative count is a miscount rather than a
 * state, and editing an item never writes the running quantity — an edit that
 * carried the figure would silently undo every adjustment made since the form
 * was opened.
 */
class StockModel : ViewModel() {

    private val _state = MutableStateFlow(Stock())
    val state: StateFlow<Stock> = _state.asStateFlow()

    fun start() {
        if (_state.value.who != null) return
        viewModelScope.launch {
            ClinicSource.signedIn()
                .onSuccess { who ->
                    _state.value = _state.value.copy(who = who)
                    if (!who.can("access.inventory")) {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = "This account is not allowed to see the clinic's stock.",
                        )
                        return@onSuccess
                    }
                    load()
                }
                .onFailure { e -> _state.value = _state.value.copy(loading = false, error = e.message) }
        }
    }

    private fun load() {
        val who = _state.value.who ?: return
        viewModelScope.launch {
            runCatching { Repository.loadInventory(who.clinicId) }
                .onSuccess { rows ->
                    _state.value = _state.value.copy(
                        loading = false, busy = false, items = rows.map(::StockRow), error = null,
                    )
                }
                .onFailure { e ->
                    _state.value = _state.value.copy(loading = false, busy = false, error = readable(e))
                }
        }
    }

    fun refresh() = load()

    fun show(filter: StockFilter) {
        _state.value = _state.value.copy(filter = filter)
    }

    fun search(term: String) {
        _state.value = _state.value.copy(search = term)
    }

    fun open(id: String) {
        _state.value = _state.value.copy(open = id, error = null)
    }

    fun close() {
        _state.value = _state.value.copy(open = null, error = null)
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    // ------------------------------------------------------------------ writes

    /** A box was used, or a delivery arrived. Clamped at zero by the repository. */
    fun adjust(delta: Double) {
        val who = _state.value.who ?: return
        val row = _state.value.openItem ?: return
        if (!_state.value.canEdit || delta == 0.0) return
        write { Repository.adjustStock(who.clinicId, row.item, delta) }
    }

    /**
     * Save the item's details.
     *
     * Never the quantity: the repository writes `stock` only for a brand-new
     * item, so somebody editing a unit label cannot undo a count taken while the
     * form sat open.
     */
    fun save(item: InventoryItem) {
        val who = _state.value.who ?: return
        val isNew = item.id.isBlank()
        if (isNew && !_state.value.canAdd) return
        if (!isNew && !_state.value.canEdit) return
        write { Repository.saveInventoryItem(who.clinicId, item) }
    }

    private fun write(action: suspend () -> Result<Unit>) {
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            action()
                .onSuccess { load() }
                .onFailure { e -> _state.value = _state.value.copy(busy = false, error = readable(e)) }
        }
    }

    private fun readable(e: Throwable): String {
        val raw = e.message.orEmpty()
        return when {
            raw.contains("PERMISSION_DENIED", true) ->
                "This account is not allowed to change the clinic's stock."
            raw.contains("offline", true) || raw.contains("UNAVAILABLE", true) ->
                "No connection. Nothing was changed."
            else -> "That could not be saved."
        }
    }
}

/** 12.0 reads as "12", 2.5 as "2.5". A trailing ".0" on a box count looks like a fault. */
fun trim(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

/** Stock, filled with the design's example data. See [previewDashboard]. */
fun previewStock(): Stock {
    fun item(
        id: String, name: String, stock: Double, min: Double, unit: String,
        category: String, cost: Double = 0.0, percentage: Boolean = false,
    ) = StockRow(
        InventoryItem(
            id = id, name = name, stock = stock, minStock = min, isPercentage = percentage,
            costPerUnit = cost, category = category, subCategory = "", unit = unit,
        )
    )
    return Stock(
        loading = false,
        who = previewDashboard().who,
        filter = StockFilter.Low,
        items = listOf(
            item("i1", "Composite A2 syringe", 0.0, 5.0, "pcs", "Restorative", 260.0),
            item("i2", "Articaine 4%", 3.0, 10.0, "box", "Anaesthetic", 420.0),
            item("i3", "Latex gloves, medium", 4.0, 6.0, "box", "Consumables", 180.0),
            item("i4", "Bonding agent", 35.0, 40.0, "", "Restorative", 0.0, percentage = true),
            item("i5", "Impression putty", 12.0, 4.0, "box", "Prosthetics", 700.0),
            item("i6", "Suction tips", 240.0, 50.0, "pcs", "Consumables", 3.0),
            item("i7", "Endo files 25mm", 9.0, 0.0, "pack", "Endodontics", 950.0),
        ),
    )
}
