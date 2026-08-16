package com.alphadental.clinic.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The app's design system: one palette, two renditions.
 *
 * The app started as a pixel copy of the website's mobile view. It now has its own
 * calmer, clinical look — airy neutral surfaces, a deep medical green where the
 * old design used flat black, and a proper dark mode — while keeping the same
 * vocabulary of names (`Ground`, `Ink`, `Slate900`…) so every screen written
 * against the old palette keeps compiling and simply picks up the new colours.
 *
 * `Slate900` always means "strongest text against the ground" and `Slate50`
 * "faintest fill"; in dark mode the scale flips values, not meaning. That is what
 * lets one call site serve both themes.
 */
class AlphaPalette(
    val dark: Boolean,
    val Ground: Color,
    val GroundSoft: Color,
    val Card: Color,
    /** The primary-action colour: filled buttons, the selected tab, cursors. */
    val Ink: Color,
    val Slate900: Color,
    val Slate800: Color,
    val Slate700: Color,
    val Slate600: Color,
    val Slate500: Color,
    val Slate400: Color,
    val Slate300: Color,
    val Slate200: Color,
    val Slate100: Color,
    val Slate50: Color,
    val Green: Color,
    val GreenSoft: Color,
    val Mint: Color,
    val Pink: Color,
    val Danger: Color,
    val DangerSoft: Color,
    val DangerText: Color,
    val WarnBg: Color,
    val WarnText: Color,
) {
    val CardShape = RoundedCornerShape(16.dp)
    val BigCardShape = RoundedCornerShape(24.dp)
    val PillShape = RoundedCornerShape(999.dp)
}

val LightAlpha = AlphaPalette(
    dark = false,
    Ground = Color(0xFFF5F8F7),
    GroundSoft = Color(0xFFFAFCFB),
    Card = Color(0xFFFFFFFF),
    Ink = Color(0xFF0E3F32),
    Slate900 = Color(0xFF10201B),
    Slate800 = Color(0xFF1E2E29),
    Slate700 = Color(0xFF33443E),
    Slate600 = Color(0xFF4A5B55),
    Slate500 = Color(0xFF64756F),
    Slate400 = Color(0xFF94A29D),
    Slate300 = Color(0xFFCBD6D2),
    Slate200 = Color(0xFFE2EAE7),
    Slate100 = Color(0xFFF0F4F3),
    Slate50 = Color(0xFFF7FAF9),
    Green = Color(0xFF0D9E6F),
    GreenSoft = Color(0xFFE3F5EE),
    Mint = Color(0xFF8DE3C4),
    Pink = Color(0xFFF6A5C0),
    Danger = Color(0xFFE11D48),
    DangerSoft = Color(0xFFFFF1F2),
    DangerText = Color(0xFF9F1239),
    WarnBg = Color(0xFFFEF3C7),
    WarnText = Color(0xFF92400E),
)

val DarkAlpha = AlphaPalette(
    dark = true,
    Ground = Color(0xFF0D1412),
    GroundSoft = Color(0xFF101815),
    Card = Color(0xFF171F1C),
    Ink = Color(0xFF0F8A63),
    Slate900 = Color(0xFFF2F5F4),
    Slate800 = Color(0xFFE4E9E8),
    Slate700 = Color(0xFFC9D2CF),
    Slate600 = Color(0xFFA9B6B2),
    Slate500 = Color(0xFF8B9995),
    Slate400 = Color(0xFF6C7B75),
    Slate300 = Color(0xFF3A4640),
    Slate200 = Color(0xFF2B3530),
    Slate100 = Color(0xFF1F2823),
    Slate50 = Color(0xFF1A211E),
    Green = Color(0xFF3DD69C),
    GreenSoft = Color(0xFF14352A),
    Mint = Color(0xFF2F5D4C),
    Pink = Color(0xFFE884A6),
    Danger = Color(0xFFFB7185),
    DangerSoft = Color(0xFF38141C),
    DangerText = Color(0xFFFDA4AF),
    WarnBg = Color(0xFF33270E),
    WarnText = Color(0xFFFBBF24),
)

val LocalAlpha = staticCompositionLocalOf { LightAlpha }

/**
 * The palette every screen reads. A composable getter rather than an object, so
 * `Alpha.Ground` written years ago now answers differently in dark mode.
 */
val Alpha: AlphaPalette
    @Composable
    @ReadOnlyComposable
    get() = LocalAlpha.current

/**
 * One appointment status, coloured the way the website colours it in light mode
 * and re-tuned by hand for dark.
 *
 * Staff read these cards by colour before they read the words — green means "they
 * are here", amber means "running late". The hues therefore never change between
 * themes; only their brightness does, so a status learned on the website is the
 * same status on a dark phone.
 */
data class StatusStyle(
    val card: Color,
    val accent: Color,
    val pillBg: Color,
    val pillText: Color,
)

@Composable
@ReadOnlyComposable
fun statusStyle(status: String?): StatusStyle = statusStyle(status, LocalAlpha.current.dark)

fun statusStyle(status: String?, dark: Boolean): StatusStyle = if (!dark) when (normalizeStatus(status)) {
    "Confirmed" -> StatusStyle(Color(0xFFF0FDFA), Color(0xFF2DD4BF), Color(0xFFCCFBF1), Color(0xFF0F766E))
    "Checked In" -> StatusStyle(Color(0xFFD1FAE5), Color(0xFF10B981), Color(0xFFA7F3D0), Color(0xFF065F46))
    "In Chair" -> StatusStyle(Color(0xFFE0F2FE), Color(0xFF0EA5E9), Color(0xFFBAE6FD), Color(0xFF075985))
    "Checking Out" -> StatusStyle(Color(0xFFCFFAFE), Color(0xFF06B6D4), Color(0xFFA5F3FC), Color(0xFF155E75))
    "Completed" -> StatusStyle(Color(0xFFE2E8F0), Color(0xFF94A3B8), Color(0xFFCBD5E1), Color(0xFF475569))
    "Late" -> StatusStyle(Color(0xFFFFEDD5), Color(0xFFF97316), Color(0xFFFED7AA), Color(0xFF9A3412))
    "Delayed" -> StatusStyle(Color(0xFFFEF3C7), Color(0xFFF59E0B), Color(0xFFFDE68A), Color(0xFF92400E))
    "Cancelled" -> StatusStyle(Color(0xFFFFF1F2), Color(0xFFFDA4AF), Color(0xFFFFE4E6), Color(0xFFE11D48))
    "No Show" -> StatusStyle(Color(0xFFFFE4E6), Color(0xFFF43F5E), Color(0xFFFECDD3), Color(0xFF9F1239))
    "Rescheduled" -> StatusStyle(Color(0xFFEDE9FE), Color(0xFF8B5CF6), Color(0xFFDDD6FE), Color(0xFF5B21B6))
    // "Scheduled" and anything unrecognised.
    else -> StatusStyle(Color(0xFFF1F5F9), Color(0xFF94A3B8), Color(0xFFE2E8F0), Color(0xFF334155))
} else when (normalizeStatus(status)) {
    "Confirmed" -> StatusStyle(Color(0xFF122A27), Color(0xFF2DD4BF), Color(0xFF134E4A), Color(0xFF99F6E4))
    "Checked In" -> StatusStyle(Color(0xFF122A1E), Color(0xFF34D399), Color(0xFF065F46), Color(0xFFA7F3D0))
    "In Chair" -> StatusStyle(Color(0xFF0F2536), Color(0xFF38BDF8), Color(0xFF075985), Color(0xFFBAE6FD))
    "Checking Out" -> StatusStyle(Color(0xFF0E2A31), Color(0xFF22D3EE), Color(0xFF155E75), Color(0xFFA5F3FC))
    "Completed" -> StatusStyle(Color(0xFF1E2731), Color(0xFF94A3B8), Color(0xFF334155), Color(0xFFCBD5E1))
    "Late" -> StatusStyle(Color(0xFF33200F), Color(0xFFFB923C), Color(0xFF7C2D12), Color(0xFFFED7AA))
    "Delayed" -> StatusStyle(Color(0xFF322608), Color(0xFFFBBF24), Color(0xFF78350F), Color(0xFFFDE68A))
    "Cancelled" -> StatusStyle(Color(0xFF331722), Color(0xFFFB7185), Color(0xFF881337), Color(0xFFFECDD3))
    "No Show" -> StatusStyle(Color(0xFF38141C), Color(0xFFF43F5E), Color(0xFF9F1239), Color(0xFFFDA4AF))
    "Rescheduled" -> StatusStyle(Color(0xFF241A38), Color(0xFFA78BFA), Color(0xFF5B21B6), Color(0xFFDDD6FE))
    else -> StatusStyle(Color(0xFF1B2430), Color(0xFF94A3B8), Color(0xFF334155), Color(0xFFCBD5E1))
}

/**
 * Canonical form of a stored status.
 *
 * Records written before the web app settled on its vocabulary still say
 * "Arrived" or "Seated". The website maps them rather than migrating; if the app
 * did not do the same, those appointments would show up grey and unstyled.
 */
fun normalizeStatus(status: String?): String = when (status) {
    null, "" -> "Scheduled"
    "Arrived" -> "Checked In"
    "Seated" -> "In Chair"
    "Pending" -> "Scheduled"
    "In Progress" -> "In Chair"
    else -> status
}

/** English and Arabic labels, matching STAGE_LABELS in lib/appointmentStages.ts. */
fun statusLabel(status: String?, arabic: Boolean): String = when (normalizeStatus(status)) {
    "Scheduled" -> if (arabic) "غير مؤكد" else "Unconfirmed"
    "Confirmed" -> if (arabic) "مؤكد" else "Confirmed"
    "Delayed" -> if (arabic) "مؤجل" else "Delayed"
    "Cancelled" -> if (arabic) "ملغي" else "Canceled"
    "Checked In" -> if (arabic) "تسجيل وصول" else "Checked in"
    "In Chair" -> if (arabic) "بالكرسي" else "In chair"
    "Checking Out" -> if (arabic) "خروج" else "Check out"
    "Completed" -> if (arabic) "مكتمل" else "Completed"
    "Late" -> if (arabic) "متأخر" else "Late"
    "No Show" -> if (arabic) "لم يحضر" else "No show"
    "Rescheduled" -> if (arabic) "معاد جدولته" else "Rescheduled"
    else -> status ?: ""
}

/**
 * A step calmer than the web app's font-black-everywhere. Headings keep real
 * weight so the hierarchy survives, but body text breathes.
 */
private val AlphaTypography = Typography(
    displaySmall = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, lineHeight = 34.sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 24.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp),
)

private fun materialScheme(p: AlphaPalette) = if (p.dark) darkColorScheme(
    primary = p.Ink,
    onPrimary = Color.White,
    secondary = p.Green,
    onSecondary = Color(0xFF06251A),
    background = p.Ground,
    onBackground = p.Slate700,
    surface = p.Card,
    onSurface = p.Slate800,
    surfaceVariant = p.Slate50,
    onSurfaceVariant = p.Slate500,
    outline = p.Slate200,
    error = p.Danger,
) else lightColorScheme(
    primary = p.Ink,
    onPrimary = Color.White,
    secondary = p.Green,
    onSecondary = Color.White,
    background = p.Ground,
    onBackground = p.Slate700,
    surface = p.Card,
    onSurface = p.Slate800,
    surfaceVariant = p.Slate50,
    onSurfaceVariant = p.Slate500,
    outline = p.Slate200,
    error = p.Danger,
)

@Composable
fun AlphaTheme(content: @Composable () -> Unit) {
    val palette = if (isSystemInDarkTheme()) DarkAlpha else LightAlpha
    CompositionLocalProvider(LocalAlpha provides palette) {
        MaterialTheme(
            colorScheme = materialScheme(palette),
            typography = AlphaTypography,
            content = content,
        )
    }
}
