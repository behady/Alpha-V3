package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The app's design system: a slab, a row, a pill, a bar.
 *
 * This file exists because the app's old look came from having no such file.
 * Every screen drew its own card, picked its own padding and set its own font
 * size, and nineteen screens of individually reasonable decisions added up to a
 * product where nothing was louder than anything else — which is what "it looks
 * basic" actually describes. Hierarchy cannot be added a screen at a time.
 *
 * The rules, in order of how much they matter:
 *
 *  1. **One slab per screen.** [Slab] is the only place a screen is allowed to
 *     be loud: a near-black band carrying the title and the single figure the
 *     screen exists to state. Everything below it goes quiet.
 *  2. **Rows, not cards.** Lists are [RowGroup]s of hairline-divided [AlphaRow]s
 *     on white. A card is a promise that something is a separate, liftable
 *     object, so a screen gets at most one — use [AlphaCard] for it.
 *  3. **Status is an edge, not a fill.** An appointment's stage rides the 3dp
 *     `stripe` and the [StatusPill]. It never tints a whole surface.
 *  4. **The accent is a fill.** Paint with `Alpha.Accent` and put `Alpha.OnAccent`
 *     on top. For the brand colour as *type*, use `Alpha.AccentInk`.
 *
 * Ported from the web app so the two products read as one; where a value came
 * from `globals.css` or `layout.tsx` the comment says so.
 */

// ---------------------------------------------------------------------------
// Type roles
// ---------------------------------------------------------------------------

/**
 * The small uppercase label above a title or a section.
 *
 * Wide tracking is doing real work here: at 10sp and bold, letters set solid
 * read as a smudge rather than as a word.
 */
@Composable
fun Eyebrow(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Alpha.Slate500,
) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        fontFamily = AlphaType.Display,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.5.sp,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * A stated figure: money, a count, a duration.
 *
 * Montserrat with tabular numerals, against Open Sans everywhere else. The
 * contrast is what makes a number read as a figure rather than as form data,
 * and `tnum` is what stops a column of them from jittering as the digits change
 * — which matters most in Arabic, where the column runs the other way.
 */
@Composable
fun Figure(
    text: String,
    modifier: Modifier = Modifier,
    size: Int = 14,
    weight: FontWeight = FontWeight.Bold,
    color: Color = Alpha.Slate900,
) {
    Text(
        text = text,
        modifier = modifier,
        fontFamily = AlphaType.Display,
        fontSize = size.sp,
        fontWeight = weight,
        letterSpacing = (-0.2).sp,
        style = TextStyle(fontFeatureSettings = "tnum"),
        color = color,
        maxLines = 1,
    )
}

// ---------------------------------------------------------------------------
// The slab
// ---------------------------------------------------------------------------

/** One figure in the divided strip along the bottom of a [Slab]. */
data class SlabStat(
    val label: String,
    val value: String,
    /** A unit set smaller and quieter beside the figure — "EGP", "min". */
    val suffix: String? = null,
)

/**
 * The black band every screen opens on.
 *
 * This is the web app's top band, translated to a phone: the same near-black,
 * the same white-on-black hierarchy, the same habit of stating one number
 * loudly. It extends under the status bar and pads its own content clear of it,
 * so the colour runs to the top edge of the display.
 *
 * Pass [figure] only when the screen genuinely has one headline number. A slab
 * with a 46sp figure that nobody needed is just a large grey box.
 */
@Composable
fun Slab(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    subtitle: String? = null,
    /** The top row: a brand mark or a back arrow on one side, actions on the other. */
    bar: @Composable (RowScope.() -> Unit)? = null,
    /** The headline number. [SlabFigure] is the usual thing to pass. */
    figure: @Composable (RowScope.() -> Unit)? = null,
    stats: List<SlabStat> = emptyList(),
    /** Collapses the title. For screens locked to the viewport, where every dp is a row. */
    compact: Boolean = false,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(Alpha.Slab)
            .statusBarsPadding(),
    ) {
        Column(Modifier.padding(horizontal = Alpha.Gutter)) {
            if (bar != null) {
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth().height(34.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    content = bar,
                )
            }

            if (eyebrow != null) {
                Spacer(Modifier.height(if (bar != null) 18.dp else 16.dp))
                Eyebrow(eyebrow, color = Alpha.SlabInk3)
                Spacer(Modifier.height(5.dp))
            } else {
                Spacer(Modifier.height(if (bar != null) 16.dp else 18.dp))
            }

            Text(
                text = title,
                fontFamily = AlphaType.Display,
                fontSize = if (compact) 21.sp else 26.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = Alpha.SlabInk,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )

            if (subtitle != null) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = subtitle,
                    fontFamily = AlphaType.Body,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.SlabInk2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            if (figure != null) {
                Spacer(Modifier.height(16.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                    content = figure,
                )
            }

            Spacer(Modifier.height(if (stats.isEmpty()) 22.dp else 18.dp))
        }

        if (stats.isNotEmpty()) SlabStrip(stats)
    }
}

/**
 * The headline number, for [Slab]'s `figure` slot.
 *
 * The currency sits beside the amount rather than inside it, and a size down,
 * because "18,450" is the thing being read and "EGP" is the thing being
 * assumed.
 */
@Composable
fun RowScope.SlabFigure(
    amount: String,
    currency: String? = null,
    /** A comparison, quiet, at the far end — "vs. Sat avg". */
    note: String? = null,
    /** The part of [note] worth colouring: "+22%". */
    noteValue: String? = null,
    size: Int = 46,
) {
    Text(
        text = amount,
        fontFamily = AlphaType.Display,
        fontSize = size.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-1).sp,
        style = TextStyle(fontFeatureSettings = "tnum"),
        color = Alpha.SlabInk,
        maxLines = 1,
    )
    if (currency != null) {
        Spacer(Modifier.width(8.dp))
        Text(
            text = currency,
            modifier = Modifier.padding(bottom = 6.dp),
            fontFamily = AlphaType.Body,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = Alpha.SlabInk2,
            maxLines = 1,
        )
    }
    if (note != null || noteValue != null) {
        Spacer(Modifier.weight(1f))
        Row(
            Modifier.padding(bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (note != null) {
                Text(
                    text = note,
                    fontFamily = AlphaType.Body,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Alpha.SlabInk2,
                    maxLines = 1,
                )
                Spacer(Modifier.width(4.dp))
            }
            if (noteValue != null) {
                Figure(noteValue, size = 12, color = Alpha.Accent)
            }
        }
    }
}

/**
 * The divided strip of secondary figures along the bottom of the slab.
 *
 * Hairlines rather than gaps or boxes: these are one reading of the day split
 * four ways, not four separate objects, and boxing them would say otherwise.
 */
@Composable
fun SlabStrip(stats: List<SlabStat>, modifier: Modifier = Modifier) {
    // Read out here: a draw scope is not a composition, so `Alpha.…` cannot be
    // reached from inside drawBehind.
    val slabLine = Alpha.SlabLine
    Row(
        modifier
            .fillMaxWidth()
            .drawBehind {
                drawRect(
                    color = slabLine,
                    size = Size(size.width, 1.dp.toPx()),
                )
            },
    ) {
        stats.forEachIndexed { index, stat ->
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .then(
                        if (index == 0) Modifier else Modifier.drawBehind {
                            drawRect(
                                color = slabLine,
                                size = Size(1.dp.toPx(), size.height),
                            )
                        },
                    )
                    .padding(horizontal = Alpha.Gutter, vertical = 13.dp),
            ) {
                Eyebrow(stat.label, color = Alpha.SlabInk3)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(
                        text = stat.value,
                        fontFamily = AlphaType.Display,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.4).sp,
                        style = TextStyle(fontFeatureSettings = "tnum"),
                        color = Alpha.SlabInk,
                        maxLines = 1,
                    )
                    if (stat.suffix != null) {
                        Spacer(Modifier.width(3.dp))
                        Text(
                            text = stat.suffix,
                            modifier = Modifier.padding(bottom = 2.dp),
                            fontFamily = AlphaType.Body,
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Alpha.SlabInk2,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

/** A circular control on the slab — a back arrow, a bell, an overflow. */
@Composable
fun SlabIcon(
    icon: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    /** Draws the accent dot that means "there is something here". */
    marked: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Box(
        modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(Alpha.SlabFill)
            .border(1.dp, Alpha.SlabLine, CircleShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, tint = Alpha.SlabInk2, modifier = Modifier.size(16.dp))
        if (marked) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 4.dp, end = 4.dp)
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(Alpha.Accent)
                    .border(1.5.dp, Alpha.Slab, CircleShape),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A run of rows on one white surface, hairlined top and bottom.
 *
 * Dividers are drawn between children rather than under each one, so the group
 * reads as a single surface that has been ruled — not as a stack of things that
 * each happen to have a line.
 */
@Composable
fun <T> RowGroup(
    items: List<T>,
    modifier: Modifier = Modifier,
    row: @Composable (T) -> Unit,
) {
    if (items.isEmpty()) return
    RowGroup(modifier) {
        items.forEachIndexed { index, item ->
            if (index > 0) RowHairline()
            row(item)
        }
    }
}

/** The same surface, for a group whose rows are not all one type. Insert [RowHairline] yourself. */
@Composable
fun RowGroup(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val lineColor = Alpha.Line
    Column(
        modifier
            .fillMaxWidth()
            .background(Alpha.Card)
            .drawBehind {
                val px = 1.dp.toPx()
                drawRect(color = lineColor, size = Size(size.width, px))
                drawRect(
                    color = lineColor,
                    topLeft = Offset(0f, size.height - px),
                    size = Size(size.width, px),
                )
            },
        content = content,
    )
}

/** The line between two rows. Inset to nothing on purpose: it rules the surface, edge to edge. */
@Composable
fun RowHairline(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Alpha.Line),
    )
}

/**
 * One line in a list: a stage stripe, something leading, a name, a caption, a value.
 *
 * The stripe is painted rather than laid out so it cannot push the content
 * around, and it takes the layout direction into account — in Arabic the edge a
 * row is read from is the right one.
 */
@Composable
fun AlphaRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    /** The appointment stage's colour. Null for rows that have no stage. */
    stripe: Color? = null,
    titleColor: Color = Alpha.Slate900,
    background: Color = Color.Transparent,
    onClick: (() -> Unit)? = null,
    leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
) {
    val ltr = LocalLayoutDirection.current == LayoutDirection.Ltr
    val stripeWidth = Alpha.StripeWidth

    Row(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .background(background)
            .drawBehind {
                if (stripe != null) {
                    val w = stripeWidth.toPx()
                    drawRect(
                        color = stripe,
                        topLeft = Offset(if (ltr) 0f else size.width - w, 0f),
                        size = Size(w, size.height),
                    )
                }
            }
            .padding(horizontal = Alpha.Gutter, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        if (leading != null) leading()

        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                fontFamily = AlphaType.Body,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = titleColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(1.dp))
                Text(
                    text = subtitle,
                    fontFamily = AlphaType.Body,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Normal,
                    color = Alpha.Slate600,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (trailing != null) trailing()
    }
}

/**
 * The time at the head of a scheduled row.
 *
 * The meridiem goes underneath at half the size rather than beside it, so every
 * row's times start at the same x and the column scans as a column.
 */
@Composable
fun RowTime(time: String, meridiem: String? = null, color: Color = Alpha.Slate900) {
    Column(Modifier.width(46.dp)) {
        Figure(time, size = 13, color = color)
        if (meridiem != null) {
            Text(
                text = meridiem.uppercase(),
                fontFamily = AlphaType.Display,
                fontSize = 9.5.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.4.sp,
                color = Alpha.Slate500,
                maxLines = 1,
            )
        }
    }
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
            .padding(start = Alpha.Gutter, end = Alpha.Gutter, top = 24.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Eyebrow(text, Modifier.weight(1f))
        if (action != null) {
            Text(
                text = action,
                modifier = if (onAction != null) Modifier.clickable(onClick = onAction) else Modifier,
                fontFamily = AlphaType.Display,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Bold,
                // The brand colour as TYPE, which is never the fill colour.
                color = Alpha.AccentInk,
                maxLines = 1,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// The floating bar
// ---------------------------------------------------------------------------

/** One destination in [FloatingBar]. A null [onClick] renders it disabled. */
data class BarItem(
    val icon: ImageVector,
    val label: String,
    val selected: Boolean = false,
    val badge: Int = 0,
    val onClick: () -> Unit,
)

/**
 * The navigation bar, ported from the web app's mobile view.
 *
 * Not a redesign — the same object: a pill inset 16dp from every edge, 64dp
 * tall, near-black under a white hairline, icons with no labels, and the active
 * destination wearing a filled accent disc scaled up slightly
 * (`src/app/(dashboard)/layout.tsx`). Anyone who uses the site on their phone
 * already knows this bar.
 *
 * It floats over the content, so whatever scrolls underneath needs bottom
 * padding of [Alpha.BarHeight] plus both insets — [BarClearance] is that sum.
 */
@Composable
fun FloatingBar(items: List<BarItem>, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier
            .navigationBarsPadding()
            .padding(horizontal = Alpha.BarInset, vertical = Alpha.BarInset)
            .fillMaxWidth()
            .height(Alpha.BarHeight),
        shape = Alpha.BarShape,
        color = Alpha.Bar,
        border = androidx.compose.foundation.BorderStroke(1.dp, Alpha.BarLine),
        shadowElevation = 12.dp,
    ) {
        Row(
            Modifier.padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            items.forEach { item -> BarGlyph(item) }
        }
    }
}

@Composable
private fun RowScope.BarGlyph(item: BarItem) {
    Box(
        Modifier
            .size(42.dp)
            .clip(CircleShape)
            .background(if (item.selected) Alpha.Accent else Color.Transparent)
            .clickable(onClick = item.onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            item.icon,
            contentDescription = item.label,
            // Asked for, never hard-coded: white on Alpha's own yellow is invisible.
            tint = if (item.selected) Alpha.OnAccent else Alpha.BarIdle,
            modifier = Modifier.size(23.dp),
        )
        if (item.badge > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .clip(CircleShape)
                    // The ring is the bar's opaque twin, so the badge reads as
                    // punched out of the bar rather than floating on it.
                    .background(Alpha.BarSolid)
                    .padding(2.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(Alpha.Badge),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (item.badge > 99) "99+" else item.badge.toString(),
                        fontFamily = AlphaType.Display,
                        fontSize = 9.5.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color.White,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

/**
 * How much room the floating bar needs under a scrolling list.
 *
 * One number, used as the bottom `contentPadding` on every screen's list, so no
 * screen ends with its last row hidden behind the pill.
 */
val BarClearance = 104.dp
