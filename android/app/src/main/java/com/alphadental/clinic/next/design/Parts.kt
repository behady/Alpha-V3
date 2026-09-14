package com.alphadental.clinic.next.design

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The parts every screen is assembled from.
 *
 * Four rules, in the order they matter:
 *
 *  1. **One [Slab] per screen.** It is the only place a screen may be loud: a
 *     near-black band carrying the title and the single figure that screen
 *     exists to state. Everything below it goes quiet.
 *  2. **Rows, not cards.** Lists are [RowGroup]s of hairline-ruled rows on white.
 *     A card is a promise that something is a separate, liftable object, so a
 *     screen gets at most one — and it only reads as lifted while it is alone.
 *  3. **Status is an edge, not a fill.** A stage rides a 3dp stripe and a chip.
 *     Eleven statuses each tinting a whole card is confetti, and colour that is
 *     everywhere marks nothing.
 *  4. **The accent is a fill.** Paint with `T.accent`, put `T.onAccent` on it.
 *     The brand colour as type is `T.accentInk`, never `T.accent`.
 */

// ---------------------------------------------------------------------------
// The slab
// ---------------------------------------------------------------------------

/** One figure in the divided strip along the bottom of a [Slab]. */
data class Stat(val label: String, val value: String)

/**
 * The near-black band a screen opens on.
 *
 * It paints under the status bar and pads its own content clear of it, so the
 * colour runs to the very top of the display rather than starting below a white
 * strip.
 */
@Composable
fun Slab(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    /** The top row: brand or a back arrow one side, controls the other. */
    bar: @Composable (RowScope.() -> Unit)? = null,
    /** The headline number. [SlabFigure] is the usual thing to put here. */
    figure: @Composable (RowScope.() -> Unit)? = null,
    stats: List<Stat> = emptyList(),
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(T.slab)
            .statusBarsPadding(),
    ) {
        Column(Modifier.padding(horizontal = T.gutter)) {
            if (bar != null) {
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth().height(34.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    content = bar,
                )
            }
            Spacer(Modifier.height(if (bar != null) 18.dp else 16.dp))

            if (eyebrow != null) {
                Txt(eyebrow, Type.eyebrow, T.onSlabFaint, uppercase = true)
                Spacer(Modifier.height(6.dp))
            }
            Txt(title, Type.title, T.onSlab, maxLines = 2)

            if (figure != null) {
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom, content = figure)
            }
            Spacer(Modifier.height(if (stats.isEmpty()) 22.dp else 18.dp))
        }
        if (stats.isNotEmpty()) SlabStrip(stats)
    }
}

/**
 * The headline number.
 *
 * The currency sits beside the amount and a size down, because "18,450" is what
 * is being read and "EGP" is what is already assumed. The comparison goes to the
 * far end, quiet, with only its value in the accent.
 */
@Composable
fun RowScope.SlabFigure(
    amount: String,
    currency: String,
    note: String? = null,
    noteValue: String? = null,
) {
    Txt(amount, Type.figure, T.onSlab)
    Spacer(Modifier.width(9.dp))
    Txt(
        currency,
        Type.body.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
        T.onSlabSoft,
        Modifier.padding(bottom = 7.dp),
    )
    if (note != null || noteValue != null) {
        Spacer(Modifier.weight(1f))
        Column(
            Modifier.padding(bottom = 6.dp),
            horizontalAlignment = Alignment.End,
        ) {
            if (note != null) Txt(note, Type.caption, T.onSlabSoft)
            if (noteValue != null) {
                Spacer(Modifier.height(2.dp))
                Txt(noteValue, Type.label.copy(fontSize = 13.sp), T.accent)
            }
        }
    }
}

/**
 * The divided strip of secondary figures.
 *
 * Hairlines rather than gaps or boxes: these are one reading of the day split
 * four ways, not four separate objects. `IntrinsicSize.Min` is load-bearing —
 * without it the dividers ask to fill the parent and the strip swallows the
 * whole screen, which is a bug this has already shipped once.
 */
@Composable
private fun SlabStrip(stats: List<Stat>) {
    val rule = T.slabLine
    // Four across a phone is tight. Rather than truncate the fourth label into
    // nonsense, the whole strip steps down a size so all four stay words.
    val tight = stats.size >= 4
    val labelStyle = if (tight) Type.eyebrow.copy(fontSize = 9.sp, letterSpacing = 0.5.sp) else Type.eyebrow
    val valueStyle = if (tight) Type.stat.copy(fontSize = 18.sp) else Type.stat
    val pad = if (tight) 11.dp else 13.dp
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(rule))
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
            stats.forEachIndexed { i, stat ->
                if (i > 0) Box(Modifier.width(1.dp).fillMaxHeight().background(rule))
                Column(
                    Modifier.weight(1f).padding(horizontal = pad, vertical = 12.dp),
                ) {
                    Txt(stat.label, labelStyle, T.onSlabFaint, uppercase = true)
                    Spacer(Modifier.height(5.dp))
                    Txt(stat.value, valueStyle, T.onSlab)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(rule))
    }
}

/** A circular control on the slab — a bell, a back arrow, an overflow. */
@Composable
fun SlabIcon(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    /** Draws the accent dot that means "there is something in here". */
    marked: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Box(
        modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(T.slabFill)
            .border(1.dp, T.slabLine, CircleShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, tint = T.onSlabSoft, modifier = Modifier.size(17.dp))
        if (marked) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 5.dp, end = 5.dp)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(T.accent)
                    .border(1.5.dp, T.slab, CircleShape),
            )
        }
    }
}

/** The brand mark: the accent as a fill, with readable ink on it. */
@Composable
fun BrandMark(size: Int = 28) {
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size / 3.5f).dp))
            .background(T.accent),
        contentAlignment = Alignment.Center,
    ) {
        Txt(
            "A",
            Type.heading.copy(
                fontSize = (size * 0.52f).sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold,
            ),
            T.onAccent,
        )
    }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** A run of rows on one white surface, ruled top and bottom. */
@Composable
fun RowGroup(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val rule = T.line
    Column(modifier.fillMaxWidth().background(T.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(rule))
        content()
        Box(Modifier.fillMaxWidth().height(1.dp).background(rule))
    }
}

/** The line between two rows. Edge to edge: it rules the surface, it does not box a row. */
@Composable
fun Rule() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(T.line))
}

/** The label above a group of rows, with an optional action at the far end. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = T.gutter, end = T.gutter, top = 20.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Txt(text, Type.eyebrow, T.inkMuted, Modifier.weight(1f), uppercase = true)
        if (action != null) {
            Txt(
                action,
                Type.label.copy(fontSize = 12.5.sp),
                // The brand as TYPE, which is never the fill colour.
                T.accentInk,
                if (onAction != null) Modifier.clickable(onClick = onAction) else Modifier,
            )
        }
    }
}

/** The small status chip. Its hues are the stage's own and never change with theme. */
@Composable
fun Chip(text: String, background: Color, content: Color) {
    Surface(shape = RoundedCornerShape(5.dp), color = background) {
        Txt(text, Type.chip, content, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), uppercase = true)
    }
}

// ---------------------------------------------------------------------------
// The floating bar
// ---------------------------------------------------------------------------

/** One destination in [FloatingBar]. */
data class BarItem(
    val icon: ImageVector,
    val label: String,
    val selected: Boolean = false,
    val badge: Int = 0,
    val onClick: () -> Unit,
)

/**
 * The navigation bar, ported from the website's own mobile view.
 *
 * Not a redesign — the same object: a pill inset from every edge, near-black
 * under a white hairline, icons carrying no labels, and the current destination
 * wearing a filled accent disc. Anyone who uses the site on their phone arrives
 * already knowing it.
 *
 * Near-opaque rather than translucent on purpose: Compose has no backdrop blur
 * (`Modifier.blur` blurs a composable's own content, not what is behind it), and
 * a half-transparent bar with no blur smears the content through it.
 */
@Composable
fun FloatingBar(items: List<BarItem>, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier
            .navigationBarsPadding()
            .padding(horizontal = T.barInset, vertical = T.barInset)
            .fillMaxWidth()
            .height(T.barHeight),
        shape = T.barShape,
        color = T.bar,
        border = BorderStroke(1.dp, T.barLine),
        shadowElevation = 14.dp,
    ) {
        Row(
            Modifier.padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            items.forEach { item ->
                Box(
                    Modifier
                        .size(if (item.selected) 46.dp else 44.dp)
                        .clip(CircleShape)
                        .background(if (item.selected) T.accent else Color.Transparent)
                        .clickable(onClick = item.onClick),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        item.icon,
                        item.label,
                        // Asked for, never hard-coded white: a white glyph on
                        // Alpha's yellow is invisible.
                        tint = if (item.selected) T.onAccent else T.barIdle,
                        modifier = Modifier.size(23.dp),
                    )
                    if (item.badge > 0) {
                        Box(
                            Modifier
                                .align(Alignment.TopEnd)
                                .size(18.dp)
                                .clip(CircleShape)
                                .background(T.badge)
                                .border(2.dp, T.bar, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Txt(
                                if (item.badge > 9) "9+" else item.badge.toString(),
                                Type.chip.copy(letterSpacing = 0.sp),
                                Color.White,
                            )
                        }
                    }
                }
            }
        }
    }
}
