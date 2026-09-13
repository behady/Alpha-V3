package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The dark band a screen opens on.
 *
 * One screen having a dark header is a header; every screen having one is the
 * app's face. The rule it encodes: spend the contrast budget once, at the top,
 * and let everything below stay quiet — so the only colour left further down the
 * screen is the appointment statuses, where a colour marks something to act on.
 *
 * Not every screen gets one. A slab suits a screen that opens on something worth
 * stating — the day's takings, whose day it is, what a period came to. A list
 * with nothing to announce is better off plain than wearing a heading twice its
 * useful size.
 *
 * **Two things changed in the redesign.** The bottom edge used to be a shallow
 * cubic sweep. A coloured band with a curve cut out of it is the single most
 * recognisable thing about a templated mobile app, and it was costing 40dp of
 * bottom padding to keep content clear of its own decoration — so the edge is
 * straight now and the screen below starts immediately. And the slab used to
 * *lift* in dark mode, on the reasoning that there was no darker shade to go to.
 * There is: the ground moved up to make room, and the slab is the darkest thing
 * on screen in both themes, which is what makes it read as the same object.
 *
 * [DesignSystem.Slab] is the fuller version — eyebrow, headline figure, the
 * divided strip of secondary figures — and is what new screens should use. This
 * stays for screens that just need the surface.
 */
@Composable
fun SlabSurface(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(slabColor)
            .statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        content = content,
    )
}

/** A screen's name on the slab, in the display face. */
@Composable
fun SlabTitle(title: String, subtitle: String? = null) {
    Text(
        text = title,
        fontSize = 23.sp,
        fontWeight = FontWeight.Bold,
        fontFamily = AlphaType.Display,
        letterSpacing = (-0.4).sp,
        color = onSlab,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
    if (!subtitle.isNullOrBlank()) {
        Text(
            text = subtitle,
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = AlphaType.Body,
            color = onSlabDim,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The slab's four colours, kept as names so the screens written against them
 * keep working. Each now forwards to the palette's slab roles, which is what
 * makes Day and Money match the redesign without being rewritten.
 */
val slabColor: Color
    @Composable @ReadOnlyComposable get() = Alpha.Slab

val onSlab: Color
    @Composable @ReadOnlyComposable get() = Alpha.SlabInk

val onSlabDim: Color
    @Composable @ReadOnlyComposable get() = Alpha.SlabInk2

/**
 * The one accent a slab is allowed: a figure that matters, and the on-shift dot.
 *
 * It used to be a mint green, which put a second brand colour on the app's most
 * visible surface. It is the accent now, so the yellow on the slab and the
 * yellow under the selected tab are the same decision.
 */
val slabAccent: Color
    @Composable @ReadOnlyComposable get() = Alpha.Accent
