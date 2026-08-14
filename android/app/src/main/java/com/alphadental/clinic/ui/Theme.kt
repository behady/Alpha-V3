package com.alphadental.clinic.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The website's mobile look, rebuilt in Compose.
 *
 * Every value here is lifted from the web app rather than invented, so the two do
 * not drift into looking like different products:
 *   Ground          globals.css  --background: #E8F0ED
 *   Primary/active  layout.tsx   bg-[#0a0a0a] with white text
 *   Cards           white, rounded-2xl (16dp) and rounded-3xl (24dp)
 *   Accent          #27ae60 / #60d297, the green used for active settings rows
 *   Status colours  lib/appointmentStages.ts, matched one for one below
 *
 * Deliberately light-only. The website has no dark mode on these screens, and a
 * half-invented dark palette would be the one place the app stopped matching it.
 */
object Alpha {
    val Ground = Color(0xFFE8F0ED)
    val GroundSoft = Color(0xFFF4F7F6)
    val Card = Color(0xFFFFFFFF)
    val Ink = Color(0xFF0A0A0A)
    val Slate900 = Color(0xFF111827)
    val Slate800 = Color(0xFF1A202C)
    val Slate700 = Color(0xFF2D3748)
    val Slate600 = Color(0xFF4A5568)
    val Slate500 = Color(0xFF718096)
    val Slate400 = Color(0xFFA0AAB2)
    val Slate300 = Color(0xFFC8E5DA)
    val Slate200 = Color(0xFFDBEFE8)
    val Slate100 = Color(0xFFE8F0ED)
    val Slate50 = Color(0xFFF4F7F6)

    val Green = Color(0xFF27AE60)
    val GreenSoft = Color(0xFFE8F7F0)
    val Mint = Color(0xFF8DE3C4)
    val Pink = Color(0xFFF6A5C0)

    /** rounded-2xl and rounded-3xl from the web. */
    val CardShape = RoundedCornerShape(16.dp)
    val BigCardShape = RoundedCornerShape(24.dp)
    val PillShape = RoundedCornerShape(999.dp)
}

/**
 * One appointment status, coloured exactly as the website colours it.
 *
 * Staff read these cards by colour before they read the words — a green row means
 * "they are here", amber means "running late". Getting a hue wrong here would not
 * look like a styling bug, it would look like the wrong patient state.
 */
data class StatusStyle(
    val card: Color,
    val accent: Color,
    val pillBg: Color,
    val pillText: Color,
)

/** Mirrors getAppointmentStatusStyles() in lib/appointmentStages.ts. */
fun statusStyle(status: String?): StatusStyle = when (normalizeStatus(status)) {
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
 * The web app leans on very heavy weights — font-bold and font-black almost
 * everywhere, rarely regular. Matching that is most of what makes the app read as
 * the same product.
 */
private val AlphaTypography = Typography(
    displaySmall = TextStyle(fontWeight = FontWeight.Black, fontSize = 28.sp, lineHeight = 34.sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.Black, fontSize = 24.sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.Black, fontSize = 20.sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 24.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp),
)

private val AlphaColors = lightColorScheme(
    primary = Alpha.Ink,
    onPrimary = Color.White,
    secondary = Alpha.Green,
    onSecondary = Color.White,
    background = Alpha.Ground,
    onBackground = Alpha.Slate700,
    surface = Alpha.Card,
    onSurface = Alpha.Slate800,
    surfaceVariant = Alpha.Slate50,
    onSurfaceVariant = Alpha.Slate500,
    outline = Alpha.Slate200,
    error = Color(0xFFE11D48),
)

@Composable
fun AlphaTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme() // read and ignored: see the light-only note above
    MaterialTheme(colorScheme = AlphaColors, typography = AlphaTypography, content = content)
}
