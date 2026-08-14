package com.alphadental.clinic.data

/**
 * A clinic stock item.
 *
 * `isPercentage` exists because some materials are tracked as "how much of the bottle is left"
 * rather than as a count, and mixing the two units in one total would be meaningless.
 */
data class InventoryItem(
    val id: String = "",
    val name: String = "",
    val stock: Double = 0.0,
    val minStock: Double = 0.0,
    val isPercentage: Boolean = false,
    val costPerUnit: Double = 0.0,
)

/**
 * Does this item have a reorder threshold at all?
 *
 * A threshold of 0 means nobody ever set one — it is the field's old default, not a deliberate
 * "tell me when it hits empty". The website learned this the hard way: treating 0 as a real
 * threshold made every unconfigured item permanently "in stock", so a low-stock check reported
 * all-clear over a shelf nobody had configured.
 */
fun hasThreshold(item: InventoryItem): Boolean = item.minStock > 0

fun isLowStock(item: InventoryItem): Boolean = hasThreshold(item) && item.stock <= item.minStock

/** Items with no threshold set, counted separately so they are visible rather than assumed fine. */
fun unconfiguredCount(items: List<InventoryItem>): Int = items.count { !hasThreshold(it) }

fun lowStockCount(items: List<InventoryItem>): Int = items.count { isLowStock(it) }
