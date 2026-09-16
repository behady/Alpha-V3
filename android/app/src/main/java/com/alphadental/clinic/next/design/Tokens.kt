package com.alphadental.clinic.next.design

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Every colour in the new app, in one place.
 *
 * Named for what each one DOES, never for its hue. The old palette is the warning:
 * it had `Green` meaning "success", "the accent", "a focused text field" and "the
 * brand" all at once, so changing the brand silently restyled every confirmation
 * in the product. A role survives a theme change; a hue does not.
 *
 * Values are lifted from the website's `globals.css` so the phone and the site
 * resolve to the same colour for the same job. A change made there is a change
 * to make here — they are two copies of one decision, which is a cost worth
 * paying to avoid a build step for six numbers.
 */
data class Palette(
    val dark: Boolean,

    /** The page behind everything, and the white surface content sits on. */
    val ground: Color,
    val surface: Color,
    val surfaceSoft: Color,

    /** The near-black band at the top of every screen — the app's one loud surface. */
    val slab: Color,
    val onSlab: Color,
    /** Secondary and tertiary type on the slab. Alpha-blended, so any slab works. */
    val onSlabSoft: Color,
    val onSlabFaint: Color,
    val slabLine: Color,
    val slabFill: Color,

    /** Type on light ground, strongest to faintest. */
    val ink: Color,
    val inkBody: Color,
    val inkMuted: Color,
    val inkFaint: Color,

    /** Hairlines. [line] rules a list; [lineStrong] outlines something pressable. */
    val line: Color,
    val lineStrong: Color,

    /**
     * The accent, split by job — the distinction the old app kept getting wrong.
     *
     * [accent] is what you PAINT WITH and [onAccent] is the type that goes on it.
     * Alpha's yellow on white is about 1.7:1 and genuinely cannot be read, so the
     * brand colour as *type* is [accentInk], a darkened gold that can.
     */
    val accent: Color,
    val onAccent: Color,
    val accentInk: Color,
    val accentTint: Color,

    /** Meaning, kept away from the accent so a rebrand cannot restyle a warning. */
    val ok: Color,
    val warn: Color,
    val danger: Color,
    val dangerTint: Color,

    /** The floating navigation pill. */
    val bar: Color,
    val barLine: Color,
    val barIdle: Color,
    val badge: Color,
) {
    val cardShape = RoundedCornerShape(14.dp)
    /** The site's card radius on a phone: 1.25rem. */
    val card = RoundedCornerShape(20.dp)
    val pill = RoundedCornerShape(999.dp)
    val barShape = RoundedCornerShape(32.dp)

    /** One gutter for the whole app, so nothing drifts to 18dp on one screen. */
    val gutter = 20.dp
    val barHeight = 64.dp
    val barInset = 16.dp

    /** Room a scrolling list must leave so its last row clears the floating bar. */
    val barClearance = 118.dp
}

/**
 * The light rendition, and the app's real identity.
 *
 * Light is the default deliberately. The design is white cards ruled by hairlines
 * under one near-black band; staff whose phones happened to sit in dark mode were
 * opening a visibly different product to the one on the clinic's desk.
 */
val LightPalette = Palette(
    dark = false,
    ground = Color(0xFFF5F6F8),
    surface = Color(0xFFFFFFFF),
    surfaceSoft = Color(0xFFF8FAFC),

    slab = Color(0xFF111318),
    onSlab = Color(0xFFFFFFFF),
    onSlabSoft = Color(0xFFFFFFFF).copy(alpha = .56f),
    onSlabFaint = Color(0xFFFFFFFF).copy(alpha = .34f),
    slabLine = Color(0xFFFFFFFF).copy(alpha = .13f),
    slabFill = Color(0xFFFFFFFF).copy(alpha = .08f),

    ink = Color(0xFF0F172A),
    inkBody = Color(0xFF475569),
    inkMuted = Color(0xFF64748B),
    inkFaint = Color(0xFF94A3B8),

    line = Color(0xFFE2E8F0),
    lineStrong = Color(0xFFCBD5E1),

    accent = Color(0xFFFACC15),
    onAccent = Color(0xFF1A1206),
    accentInk = Color(0xFF7A5C00),
    accentTint = Color(0xFFFEF9E6),

    ok = Color(0xFF05603A),
    warn = Color(0xFFC44A0A),
    danger = Color(0xFFC51F1F),
    dangerTint = Color(0xFFFEF2F2),

    bar = Color(0xFF111318),
    barLine = Color(0xFFFFFFFF).copy(alpha = .12f),
    barIdle = Color(0xFFFFFFFF).copy(alpha = .52f),
    badge = Color(0xFFC0392B),
)

/**
 * The dark rendition. Not an inversion — a second design.
 *
 * The slab has to stay the darkest thing on screen or it stops reading as the
 * same object, so the ground moves UP to make room for it rather than the slab
 * moving down. The bar goes the other way and lifts, because a near-black pill
 * floating on a near-black ground is not floating on anything.
 */
val DarkPalette = Palette(
    dark = true,
    ground = Color(0xFF0D0F12),
    surface = Color(0xFF161A1F),
    surfaceSoft = Color(0xFF12161A),

    slab = Color(0xFF050608),
    onSlab = Color(0xFFFFFFFF),
    onSlabSoft = Color(0xFFFFFFFF).copy(alpha = .58f),
    onSlabFaint = Color(0xFFFFFFFF).copy(alpha = .36f),
    slabLine = Color(0xFFFFFFFF).copy(alpha = .14f),
    slabFill = Color(0xFFFFFFFF).copy(alpha = .09f),

    ink = Color(0xFFF1F4F7),
    inkBody = Color(0xFFA8B2BE),
    inkMuted = Color(0xFF7F8A97),
    inkFaint = Color(0xFF646F7C),

    line = Color(0xFF262C34),
    lineStrong = Color(0xFF333B45),

    accent = Color(0xFFFACC15),
    onAccent = Color(0xFF1A1206),
    accentInk = Color(0xFFF5D23F),
    accentTint = Color(0xFF2A2306),

    ok = Color(0xFF34D399),
    warn = Color(0xFFFB923C),
    danger = Color(0xFFFB7185),
    dangerTint = Color(0xFF2E1218),

    bar = Color(0xFF222830),
    barLine = Color(0xFFFFFFFF).copy(alpha = .14f),
    barIdle = Color(0xFFFFFFFF).copy(alpha = .55f),
    badge = Color(0xFFE04B3A),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

/** The palette every screen reads: `T.accent`, `T.ink`, and so on. */
val T: Palette
    @Composable
    @ReadOnlyComposable
    get() = LocalPalette.current
