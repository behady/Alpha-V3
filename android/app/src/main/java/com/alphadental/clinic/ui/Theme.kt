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

/**
 * One theme, as the two colours that define it.
 *
 * Everything else — the neutral scale, the surfaces, the soft tints — is derived
 * from these, so a new theme is two colours rather than thirty hand-tuned ones,
 * and no theme can quietly ship an unreadable grey. The semantic colours
 * (danger, warning, and the eleven appointment statuses) are deliberately NOT
 * derived: a status must mean the same thing in every theme.
 */
class AlphaThemeOption(
    val id: String,
    val en: String,
    val ar: String,
    /** The primary-action colour in light mode: filled buttons, selected tabs. */
    val ink: Color,
    /** The accent in light mode: money in credit, highlights, success. */
    val accent: Color,
    /** Their brighter counterparts, for dark backgrounds. */
    val inkDark: Color,
    val accentDark: Color,
)

val ALPHA_THEMES: List<AlphaThemeOption> = listOf(
    AlphaThemeOption("green", "Medical Green", "أخضر طبي", Color(0xFF0E3F32), Color(0xFF0D9E6F), Color(0xFF0F8A63), Color(0xFF3DD69C)),
    AlphaThemeOption("blue", "Ocean Blue", "أزرق", Color(0xFF0C3A5A), Color(0xFF0E7FB8), Color(0xFF1173A8), Color(0xFF38BDF8)),
    AlphaThemeOption("purple", "Royal Purple", "بنفسجي", Color(0xFF34275F), Color(0xFF7C5CD6), Color(0xFF6D4FC7), Color(0xFFA78BFA)),
    AlphaThemeOption("amber", "Warm Amber", "عنبري", Color(0xFF573611), Color(0xFFC9820B), Color(0xFFB07A15), Color(0xFFF5B948)),
    AlphaThemeOption("rose", "Rose", "وردي", Color(0xFF56203A), Color(0xFFD4487A), Color(0xFFB84A72), Color(0xFFF472A0)),
    // Graphite keeps a steel-blue accent rather than a grey one: money and
    // "settled" badges read as colour everywhere else, and a grey +500 EGP
    // stops looking like a positive number at all.
    AlphaThemeOption("graphite", "Graphite", "رمادي", Color(0xFF23272E), Color(0xFF4A7DB5), Color(0xFF54606E), Color(0xFF7FB0E0)),
)

fun themeById(id: String?): AlphaThemeOption = ALPHA_THEMES.firstOrNull { it.id == id } ?: ALPHA_THEMES.first()

/** Mixes two colours; `amount` is how much of [b] ends up in the result. */
private fun mix(a: Color, b: Color, amount: Float): Color =
    androidx.compose.ui.graphics.lerp(a, b, amount.coerceIn(0f, 1f))

/**
 * Builds a full palette from a theme.
 *
 * The neutrals are a plain grey scale carrying a whisper of the brand hue — six
 * per cent is enough to make a blue theme feel blue and a rose theme feel warm
 * without tinting a patient's name pink.
 */
fun paletteFor(theme: AlphaThemeOption, dark: Boolean): AlphaPalette {
    val brand = if (dark) theme.accentDark else theme.accent
    return if (!dark) AlphaPalette(
        dark = false,
        Ground = mix(Color(0xFFF6F8F8), brand, .06f),
        GroundSoft = mix(Color(0xFFFBFCFC), brand, .04f),
        Card = Color(0xFFFFFFFF),
        Ink = theme.ink,
        Slate900 = mix(Color(0xFF141A18), brand, .05f),
        Slate800 = mix(Color(0xFF232B29), brand, .05f),
        Slate700 = mix(Color(0xFF3A4340), brand, .05f),
        Slate600 = mix(Color(0xFF515B58), brand, .05f),
        Slate500 = mix(Color(0xFF6B7572), brand, .05f),
        Slate400 = mix(Color(0xFF98A19E), brand, .06f),
        Slate300 = mix(Color(0xFFCED5D3), brand, .08f),
        Slate200 = mix(Color(0xFFE4E9E8), brand, .08f),
        Slate100 = mix(Color(0xFFF1F4F3), brand, .07f),
        Slate50 = mix(Color(0xFFF8FAFA), brand, .05f),
        Green = theme.accent,
        GreenSoft = mix(Color.White, theme.accent, .13f),
        Mint = mix(Color.White, theme.accent, .42f),
        Pink = Color(0xFFF6A5C0),
        Danger = Color(0xFFE11D48),
        DangerSoft = Color(0xFFFFF1F2),
        DangerText = Color(0xFF9F1239),
        WarnBg = Color(0xFFFEF3C7),
        WarnText = Color(0xFF92400E),
    ) else AlphaPalette(
        dark = true,
        Ground = mix(Color(0xFF0D1113), brand, .05f),
        GroundSoft = mix(Color(0xFF101517), brand, .05f),
        Card = mix(Color(0xFF171D1F), brand, .05f),
        Ink = theme.inkDark,
        Slate900 = mix(Color(0xFFF2F5F4), brand, .04f),
        Slate800 = mix(Color(0xFFE4E9E8), brand, .04f),
        Slate700 = mix(Color(0xFFC9D2CF), brand, .05f),
        Slate600 = mix(Color(0xFFA9B6B2), brand, .05f),
        Slate500 = mix(Color(0xFF8B9995), brand, .06f),
        Slate400 = mix(Color(0xFF6C7B75), brand, .07f),
        Slate300 = mix(Color(0xFF3C4744), brand, .08f),
        Slate200 = mix(Color(0xFF2C3533), brand, .08f),
        Slate100 = mix(Color(0xFF202826), brand, .08f),
        Slate50 = mix(Color(0xFF1A211F), brand, .07f),
        Green = theme.accentDark,
        GreenSoft = mix(Color(0xFF141A18), theme.accentDark, .20f),
        Mint = mix(Color(0xFF141A18), theme.accentDark, .45f),
        Pink = Color(0xFFE884A6),
        Danger = Color(0xFFFB7185),
        DangerSoft = Color(0xFF38141C),
        DangerText = Color(0xFFFDA4AF),
        WarnBg = Color(0xFF33270E),
        WarnText = Color(0xFFFBBF24),
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
)

object AppearanceStore {

    private const val PREFS = "alpha_ui"
    private const val KEY_THEME = "theme_id"
    private const val KEY_FOLLOW = "follow_phone"
    private const val KEY_DARK = "dark_mode"

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
        )
    }

    fun setTheme(id: String) = update { it.copy(themeId = id) }

    fun setFollowPhone(follow: Boolean) = update { it.copy(followPhone = follow) }

    /** Only meaningful while not following the phone. */
    fun setDark(dark: Boolean) = update { it.copy(dark = dark, followPhone = false) }

    private fun update(change: (Appearance) -> Appearance) {
        val next = change(state.value)
        state.value = next
        prefs?.edit()
            ?.putString(KEY_THEME, next.themeId)
            ?.putBoolean(KEY_FOLLOW, next.followPhone)
            ?.putBoolean(KEY_DARK, next.dark)
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
