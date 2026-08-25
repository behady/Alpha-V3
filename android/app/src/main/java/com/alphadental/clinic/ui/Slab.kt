package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The dark band a screen opens on.
 *
 * One screen having a dark header is a header; every screen having one is the
 * app's face, which is the whole point of moving this out of the dashboard. The
 * rule it encodes: spend the contrast budget once, at the top, and let
 * everything below stay quiet — so the only colour left further down the screen
 * is the appointment statuses, where a colour marks something to act on.
 *
 * Not every screen gets one. A slab suits a screen that opens on something worth
 * stating — the day's takings, whose day it is, what a period came to. A list
 * with nothing to announce is better off plain than wearing a heading twice its
 * useful size.
 */
@Composable
fun SlabSurface(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(rememberSlabShape())
            .background(slabColor)
            // The generous bottom padding is not decoration: it keeps content
            // clear of the curve cut out of the slab's bottom edge.
            .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 40.dp),
        content = content,
    )
}

/**
 * A screen's name on the slab, in the serif that marks out the few words and
 * figures worth reading twice.
 */
@Composable
fun SlabTitle(title: String, subtitle: String? = null) {
    Text(
        text = title,
        fontSize = 23.sp,
        fontWeight = FontWeight.ExtraBold,
        fontFamily = FontFamily.Serif,
        color = onSlab,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
    if (!subtitle.isNullOrBlank()) {
        Text(
            text = subtitle,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Medium,
            color = onSlabDim,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The slab's soft bottom edge.
 *
 * A straight line under a coloured band reads as a banner dropped onto the page;
 * the sweep makes the dark ground feel like part of the screen instead of a
 * sticker on it. Shallow on purpose — deep enough to register as a decision, not
 * so deep that the curve becomes the thing anyone remembers about the app.
 */
@Composable
fun rememberSlabShape(): Shape {
    val density = LocalDensity.current
    return remember(density) {
        val deep = with(density) { 34.dp.toPx() }
        val shallow = with(density) { 12.dp.toPx() }
        GenericShape { size, direction ->
            val w = size.width
            val h = size.height
            // Mirrored in Arabic so the sweep runs the way the reading does.
            val rtl = direction == LayoutDirection.Rtl
            val rightDip = if (rtl) shallow else deep
            val leftDip = if (rtl) deep else shallow
            moveTo(0f, 0f)
            lineTo(w, 0f)
            lineTo(w, h - rightDip)
            cubicTo(w * 0.70f, h - 2f, w * 0.30f, h, 0f, h - leftDip)
            close()
        }
    }
}

/**
 * The slab's four colours.
 *
 * In light mode the slab is the theme's deep ink and everything on it is white;
 * in dark mode there is no darker shade left to go to, so the slab lifts one
 * step out of the ground instead and the text flips with it. Either way a screen
 * written against these names gets the right answer.
 */
val slabColor: Color
    @Composable @ReadOnlyComposable get() = if (Alpha.dark) Alpha.Slate100 else Alpha.Ink

val onSlab: Color
    @Composable @ReadOnlyComposable get() = if (Alpha.dark) Alpha.Slate900 else Color.White

val onSlabDim: Color
    @Composable @ReadOnlyComposable get() = if (Alpha.dark) Alpha.Slate500 else Color.White.copy(alpha = .68f)

/** The one accent a slab is allowed: a figure that matters, and the on-shift dot. */
val slabAccent: Color
    @Composable @ReadOnlyComposable get() = if (Alpha.dark) Alpha.Green else Alpha.Mint
