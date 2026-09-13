package com.alphadental.clinic.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
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

    // ---- the old vocabulary, re-pointed --------------------------------
    // Every screen written before the redesign reads these names. They still
    // mean what they always meant — `Slate900` is the strongest text against
    // the ground, `Slate50` the faintest fill — so those screens keep
    // compiling and simply pick up the web app's values.
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

    // ---- the web app's roles, added ------------------------------------
    // Named for what they DO, never for a hue, so a theme change cannot
    // quietly restyle something that carried meaning. These are the names new
    // work should reach for; the block above exists for the old screens.

    /** The near-black band at the top of every screen. The app's one loud surface. */
    val Slab: Color,
    val SlabInk: Color,
    val SlabInk2: Color,
    val SlabInk3: Color,
    val SlabLine: Color,
    val SlabFill: Color,

    /** Hairlines. [Line] divides rows; [LineStrong] outlines something pressable. */
    val Line: Color,
    val LineStrong: Color,

    /**
     * The accent, split by job.
     *
     * [Accent] is what you PAINT WITH and [OnAccent] the type that goes on it.
     * Yellow on white is about 1.7:1 and cannot be read, so type in the brand
     * colour uses [AccentInk] — the same hue darkened until it works — exactly
     * as `.text-accent` does on the website.
     */
    val Accent: Color,
    val AccentTint: Color,
    val AccentInk: Color,
    val OnAccent: Color,

    /** The floating navigation pill, ported from the web app's mobile bar. */
    val Bar: Color,
    val BarLine: Color,
    val BarIdle: Color,
    /** Opaque twin of [Bar], for the ring punched around a count badge. */
    val BarSolid: Color,
    val Badge: Color,

    /** "This succeeded" — deliberately not the accent, so a theme cannot restyle it. */
    val Ok: Color,
    val OkTint: Color,
) {
    val CardShape = RoundedCornerShape(14.dp)
    val BigCardShape = RoundedCornerShape(22.dp)
    val PillShape = RoundedCornerShape(999.dp)

    /** The floating bar: a 64dp pill, inset 16dp from every edge. */
    val BarShape = RoundedCornerShape(32.dp)
    val BarHeight = 64.dp
    val BarInset = 16.dp

    /** The stripe that carries an appointment's stage down the edge of a row. */
    val StripeWidth = 3.dp

    /** The gutter. One number, so nothing drifts to 18dp on one screen and 20dp on the next. */
    val Gutter = 20.dp
}

/**
 * A theme, which is now one decision: the accent.
 *
 * It used to be two — an ink and an accent — and the ink repainted the app's
 * whole frame, which is why six themes produced six differently-coloured
 * products rather than one product in six accents. The frame is now fixed: a
 * near-black slab, white cards, a grey scale with no hue in it. A theme picks
 * the colour of a filled button and the disc under the selected tab, and
 * nothing else.
 *
 * The semantic colours — danger, warning, success, and the eleven appointment
 * stages — are deliberately NOT derived from this. A status must mean the same
 * thing whichever accent a clinic picked.
 */
class AlphaThemeOption(
    val id: String,
    val en: String,
    val ar: String,
    /** What you paint with, on a light ground. */
    val accent: Color,
    /** The same role on a dark ground, where a light-mode fill would glare. */
    val accentDark: Color,
    /** The same hue pushed until it can be READ as type on a light ground. */
    val accentInk: Color,
    val accentInkDark: Color,
)

val ALPHA_THEMES: List<AlphaThemeOption> = listOf(
    // Alpha's own yellow, and the default — it is the colour the website wears.
    AlphaThemeOption("gold", "Alpha Gold", "ذهبي ألفا", Color(0xFFFACC15), Color(0xFFFACC15), Color(0xFF7A5C00), Color(0xFFF5D23F)),
    AlphaThemeOption("green", "Medical Green", "أخضر طبي", Color(0xFF0F8A63), Color(0xFF3DD69C), Color(0xFF05603A), Color(0xFF6EE7B7)),
    AlphaThemeOption("blue", "Ocean Blue", "أزرق", Color(0xFF1173A8), Color(0xFF38BDF8), Color(0xFF0C4A6E), Color(0xFF7DD3FC)),
    AlphaThemeOption("purple", "Royal Purple", "بنفسجي", Color(0xFF6D4FC7), Color(0xFFA78BFA), Color(0xFF5B21B6), Color(0xFFC4B5FD)),
    AlphaThemeOption("amber", "Warm Amber", "عنبري", Color(0xFFC9820B), Color(0xFFF5B948), Color(0xFF8A5A00), Color(0xFFFCD34D)),
    AlphaThemeOption("rose", "Rose", "وردي", Color(0xFFC13E6D), Color(0xFFF472A0), Color(0xFF9F1239), Color(0xFFFDA4AF)),
    AlphaThemeOption("graphite", "Graphite", "رمادي", Color(0xFF4A7DB5), Color(0xFF7FB0E0), Color(0xFF1E3A5F), Color(0xFF93C5FD)),
)

fun themeById(id: String?): AlphaThemeOption = ALPHA_THEMES.firstOrNull { it.id == id } ?: ALPHA_THEMES.first()

/**
 * The type that can be read on a given fill.
 *
 * Derived rather than stored so no theme can ever ship an unreadable pair:
 * white on Alpha's yellow is the exact bug this prevents. The threshold sits at
 * .45 because a mid-green reads as dark to the eye well before its measured
 * luminance reaches .5.
 */
fun readableOn(fill: Color): Color =
    if (fill.luminance() > 0.45f) Color(0xFF1A1206) else Color.White

/**
 * Builds a full palette from a theme.
 *
 * Only the accent varies. Every other value is a literal lifted from
 * `src/app/globals.css`, so the phone and the website resolve to the same
 * colour for the same role — and a change made there is a change to make here.
 *
 * The dark rendition is not an inversion. The slab has to stay the darkest
 * thing on screen, so in dark mode it goes BELOW the ground rather than above
 * it; and the floating bar goes the other way and lifts, because a near-black
 * pill on a near-black ground stops reading as a floating object at all.
 */
fun paletteFor(theme: AlphaThemeOption, dark: Boolean): AlphaPalette {
    val accent = if (dark) theme.accentDark else theme.accent
    val accentInk = if (dark) theme.accentInkDark else theme.accentInk
    return if (!dark) AlphaPalette(
        dark = false,
        Ground = Color(0xFFF5F6F8),
        GroundSoft = Color(0xFFF8FAFC),
        Card = Color(0xFFFFFFFF),
        // The primary action is the slab, not the accent. Yellow is spent once
        // per screen; a screen of yellow buttons is the look this replaces.
        Ink = Color(0xFF111318),
        Slate900 = Color(0xFF0F172A),
        Slate800 = Color(0xFF2D3748),
        Slate700 = Color(0xFF475569),
        Slate600 = Color(0xFF64748B),
        Slate500 = Color(0xFF78899F),
        Slate400 = Color(0xFF94A3B8),
        Slate300 = Color(0xFFCBD5E1),
        Slate200 = Color(0xFFE2E8F0),
        Slate100 = Color(0xFFF1F5F9),
        Slate50 = Color(0xFFF8FAFC),
        Green = Color(0xFF05603A),
        GreenSoft = Color(0xFFECFDF5),
        Mint = Color(0xFFD1FAE5),
        Pink = Color(0xFFF6A5C0),
        Danger = Color(0xFFC51F1F),
        DangerSoft = Color(0xFFFEF2F2),
        DangerText = Color(0xFFC51F1F),
        WarnBg = Color(0xFFFFF7ED),
        WarnText = Color(0xFFC44A0A),

        Slab = Color(0xFF111318),
        SlabInk = Color(0xFFFFFFFF),
        SlabInk2 = Color(0xFFFFFFFF).copy(alpha = .55f),
        SlabInk3 = Color(0xFFFFFFFF).copy(alpha = .34f),
        SlabLine = Color(0xFFFFFFFF).copy(alpha = .13f),
        SlabFill = Color(0xFFFFFFFF).copy(alpha = .06f),
        Line = Color(0xFFE2E8F0),
        LineStrong = Color(0xFFCBD5E1),
        Accent = accent,
        AccentTint = Color(0xFFFEF9E6),
        AccentInk = accentInk,
        OnAccent = readableOn(accent),
        Bar = Color(0xFF111318).copy(alpha = .88f),
        BarLine = Color(0xFFFFFFFF).copy(alpha = .12f),
        BarIdle = Color(0xFFFFFFFF).copy(alpha = .52f),
        BarSolid = Color(0xFF111318),
        Badge = Color(0xFFC0392B),
        Ok = Color(0xFF05603A),
        OkTint = Color(0xFFECFDF5),
    ) else AlphaPalette(
        dark = true,
        Ground = Color(0xFF0D0F12),
        GroundSoft = Color(0xFF12161A),
        Card = Color(0xFF161A1F),
        Ink = Color(0xFFF1F4F7),
        Slate900 = Color(0xFFF1F4F7),
        Slate800 = Color(0xFFDDE3EA),
        Slate700 = Color(0xFFA8B2BE),
        Slate600 = Color(0xFF7F8A97),
        Slate500 = Color(0xFF646F7C),
        Slate400 = Color(0xFF556069),
        Slate300 = Color(0xFF333B45),
        Slate200 = Color(0xFF262C34),
        Slate100 = Color(0xFF1C2127),
        Slate50 = Color(0xFF12161A),
        Green = Color(0xFF34D399),
        GreenSoft = Color(0xFF0C2A20),
        Mint = Color(0xFF134E4A),
        Pink = Color(0xFFE884A6),
        Danger = Color(0xFFFB7185),
        DangerSoft = Color(0xFF2E1218),
        DangerText = Color(0xFFFB7185),
        WarnBg = Color(0xFF2E1B0C),
        WarnText = Color(0xFFFB923C),

        // Below the ground, not above it.
        Slab = Color(0xFF050608),
        SlabInk = Color(0xFFFFFFFF),
        SlabInk2 = Color(0xFFFFFFFF).copy(alpha = .58f),
        SlabInk3 = Color(0xFFFFFFFF).copy(alpha = .36f),
        SlabLine = Color(0xFFFFFFFF).copy(alpha = .14f),
        SlabFill = Color(0xFFFFFFFF).copy(alpha = .07f),
        Line = Color(0xFF262C34),
        LineStrong = Color(0xFF333B45),
        Accent = accent,
        AccentTint = Color(0xFF2A2306),
        AccentInk = accentInk,
        OnAccent = readableOn(accent),
        // ...and the bar lifts, for the same reason.
        Bar = Color(0xFF222830).copy(alpha = .90f),
        BarLine = Color(0xFFFFFFFF).copy(alpha = .14f),
        BarIdle = Color(0xFFFFFFFF).copy(alpha = .55f),
        BarSolid = Color(0xFF222830),
        Badge = Color(0xFFE04B3A),
        Ok = Color(0xFF34D399),
        OkTint = Color(0xFF0C2A20),
    )
}

val LightAlpha = paletteFor(ALPHA_THEMES.first(), dark = false)
val DarkAlpha = paletteFor(ALPHA_THEMES.first(), dark = true)

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
    // Unconfirmed is a to-do — someone still has to call the patient — so it
    // wears a warm yellow rather than a grey that reads as "all settled".
    "Scheduled" -> StatusStyle(Color(0xFFFEFCE8), Color(0xFFFACC15), Color(0xFFFEF9C3), Color(0xFF854D0E))
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
    // Anything unrecognised.
    else -> StatusStyle(Color(0xFFF1F5F9), Color(0xFF94A3B8), Color(0xFFE2E8F0), Color(0xFF334155))
} else when (normalizeStatus(status)) {
    "Scheduled" -> StatusStyle(Color(0xFF2E2908), Color(0xFFFACC15), Color(0xFF713F12), Color(0xFFFEF08A))
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
/**
 * The app's type scale, in the brand's two faces.
 *
 * Headings take Montserrat, running text takes Open Sans. Setting it here means
 * every Text that does not name a family gets the brand rather than the phone's
 * default sans — which was the difference between two clinics seeing the same
 * product and not.
 */
private val AlphaTypography = Typography(
    displaySmall = TextStyle(fontFamily = AlphaType.Display, fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, lineHeight = 34.sp),
    headlineMedium = TextStyle(fontFamily = AlphaType.Display, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(fontFamily = AlphaType.Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp),
    titleLarge = TextStyle(fontFamily = AlphaType.Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 24.sp),
    titleMedium = TextStyle(fontFamily = AlphaType.Display, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = AlphaType.Body, fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = AlphaType.Body, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = AlphaType.Body, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = AlphaType.Body, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = AlphaType.Body, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp),
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

/**
 * How the app is dressed, as the person chose it.
 *
 * Three values, saved on the phone: which theme, whether to follow the phone's
 * own light/dark setting, and — when not following — which of the two to use.
 * Held in a flow so a tap in Settings repaints the whole app at once, and read
 * from disk in Application.onCreate so the first frame is already right rather
 * than flashing white on a dark phone.
 */
data class Appearance(
    val themeId: String = "green",
    val followPhone: Boolean = true,
    val dark: Boolean = false,
    /**
     * Whether the interface is in Arabic.
     *
     * Kept here rather than in the view model because the view model is rebuilt
     * with every process, and a preference that lives only there is a preference
     * the person re-states every single morning — which is exactly what was
     * happening.
     */
    val arabic: Boolean = false,
)

object AppearanceStore {

    private const val PREFS = "alpha_ui"
    private const val KEY_THEME = "theme_id"
    private const val KEY_FOLLOW = "follow_phone"
    private const val KEY_DARK = "dark_mode"
    private const val KEY_ARABIC = "arabic"

    private var prefs: android.content.SharedPreferences? = null

    val state = kotlinx.coroutines.flow.MutableStateFlow(Appearance())

    /** Called from Application.onCreate, before any pixel is drawn. */
    fun init(context: android.content.Context) {
        val store = context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
        prefs = store
        state.value = Appearance(
            themeId = store.getString(KEY_THEME, null) ?: "green",
            followPhone = store.getBoolean(KEY_FOLLOW, true),
            dark = store.getBoolean(KEY_DARK, false),
            // Until someone chooses, follow the phone. A clinic whose staff run
            // their phones in Arabic should not have to switch the app over on
            // first run to read it in the language they already asked for.
            arabic = store.getBoolean(
                KEY_ARABIC,
                java.util.Locale.getDefault().language == "ar",
            ),
        )
    }

    fun setTheme(id: String) = update { it.copy(themeId = id) }

    fun setFollowPhone(follow: Boolean) = update { it.copy(followPhone = follow) }

    /** Only meaningful while not following the phone. */
    fun setDark(dark: Boolean) = update { it.copy(dark = dark, followPhone = false) }

    fun setArabic(arabic: Boolean) = update { it.copy(arabic = arabic) }

    private fun update(change: (Appearance) -> Appearance) {
        val next = change(state.value)
        state.value = next
        prefs?.edit()
            ?.putString(KEY_THEME, next.themeId)
            ?.putBoolean(KEY_FOLLOW, next.followPhone)
            ?.putBoolean(KEY_DARK, next.dark)
            ?.putBoolean(KEY_ARABIC, next.arabic)
            ?.apply()
    }
}

@Composable
fun AlphaTheme(content: @Composable () -> Unit) {
    val appearance by AppearanceStore.state.collectAsState()
    // Following the phone is the default; switching it off freezes the app on
    // whichever of the two was chosen, whatever the phone does afterwards.
    val dark = if (appearance.followPhone) isSystemInDarkTheme() else appearance.dark
    val palette = paletteFor(themeById(appearance.themeId), dark)

    // The status-bar icons have to invert with the ground under them, or they
    // vanish: dark icons on a dark header is an unreadable strip at the top.
    val view = androidx.compose.ui.platform.LocalView.current
    if (!view.isInEditMode) {
        androidx.compose.runtime.SideEffect {
            val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
            androidx.core.view.WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }

    CompositionLocalProvider(LocalAlpha provides palette) {
        MaterialTheme(
            colorScheme = materialScheme(palette),
            typography = AlphaTypography,
            content = content,
        )
    }
}
