package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.InventoryItem
import com.alphadental.clinic.data.hasThreshold
import com.alphadental.clinic.data.isLowStock
import com.alphadental.clinic.data.lowStockCount
import com.alphadental.clinic.data.unconfiguredCount

/**
 * Clinic stock.
 *
 * Built for the one thing stock is actually used for on a phone: standing at the cupboard,
 * noticing something is running out, and adjusting the count without walking back to a computer.
 * Adding and removing items stays on the website, where names, costs and thresholds can be set
 * properly.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventorySheet(
    items: List<InventoryItem>,
    loading: Boolean,
    canEdit: Boolean,
    arabic: Boolean,
    onAdjust: (InventoryItem, Double) -> Unit,
    onDismiss: () -> Unit,
    /** The last read failed. A bottom sheet has no pull to refresh, so the banner carries Retry. */
    error: String? = null,
    onRetry: () -> Unit = {},
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val low = lowStockCount(items)
    val unset = unconfiguredCount(items)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Text(
                if (arabic) "المخزون" else "Stock",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )

            if (!loading) {
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(
                        value = low.toString(),
                        caption = if (arabic) "أوشك على النفاد" else "Running low",
                        tint = if (low > 0) Alpha.Danger else Alpha.Slate900,
                        modifier = Modifier.weight(1f),
                    )
                    // Shown as its own number rather than folded into "fine". An item with no
                    // reorder level set can never trigger a low-stock alert, so counting it as
                    // healthy is how a clinic runs out of something it was never watching.
                    StatTile(
                        value = unset.toString(),
                        caption = if (arabic) "بدون حد أدنى" else "No reorder level",
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            error?.let {
                LoadErrorBanner(it, arabic, onRetry, Modifier.padding(bottom = 10.dp))
            }

            when {
                loading && items.isEmpty() -> Box(
                    Modifier.fillMaxWidth().padding(vertical = 40.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                }

                items.isEmpty() -> Text(
                    if (error != null) "" else if (arabic) "لا توجد أصناف في المخزون." else "No stock items yet.",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Slate400,
                )

                else -> LazyColumn(
                    Modifier.heightIn(max = 460.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(items, key = { it.id }) { item ->
                        val low = isLowStock(item)
                        Surface(
                            shape = Alpha.CardShape,
                            color = if (low) Alpha.DangerSoft else Alpha.Slate50,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                Modifier.padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        item.name,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Alpha.Slate900,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        text = buildString {
                                            append(formatStock(item))
                                            if (hasThreshold(item)) {
                                                append(if (arabic) "  ·  الحد " else "  ·  min ")
                                                append(item.minStock.toInt())
                                            } else {
                                                append(if (arabic) "  ·  بدون حد" else "  ·  no reorder level")
                                            }
                                        },
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = if (low) Alpha.DangerText else Alpha.Slate400,
                                    )
                                }

                                if (canEdit) {
                                    IconButton(onClick = { onAdjust(item, -1.0) }, enabled = item.stock > 0) {
                                        Icon(
                                            Icons.Filled.Remove,
                                            contentDescription = if (arabic) "إنقاص" else "Decrease",
                                            tint = if (item.stock > 0) Alpha.Slate600 else Alpha.Slate300,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    }
                                    IconButton(onClick = { onAdjust(item, 1.0) }) {
                                        Icon(
                                            Icons.Filled.Add,
                                            contentDescription = if (arabic) "زيادة" else "Increase",
                                            tint = Alpha.Green,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Text(
                if (arabic) "لإضافة صنف أو تعديل الحد الأدنى، استخدم النظام على المتصفح."
                else "To add an item or set a reorder level, use the full system in a browser.",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }
}

/** Percentage-tracked materials read as "60% left"; counted ones as a plain number. */
private fun formatStock(item: InventoryItem): String =
    if (item.isPercentage) "${item.stock.toInt()}%" else item.stock.toInt().toString()
