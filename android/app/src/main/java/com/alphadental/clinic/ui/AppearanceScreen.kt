package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * How the app looks: the theme, and whether it follows the phone into dark mode.
 *
 * Everything here repaints the screen underneath as it is tapped — the swatch
 * grid and the preview card are drawn from the same palette every other screen
 * reads, so what is on show is literally the app, not a mock-up of it.
 */
@Composable
fun AppearanceScreen(arabic: Boolean, onClose: () -> Unit) {
    BackHandler { onClose() }
    val appearance by AppearanceStore.state.collectAsState()

    Surface(color = Alpha.Ground, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 4.dp, end = 16.dp, top = 6.dp),
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Alpha.Slate700)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (arabic) "المظهر" else "Appearance",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Alpha.Slate900,
                        fontFamily = AlphaType.Display,
                    )
                    Text(
                        if (arabic) "الألوان والوضع الليلي" else "Colours and night mode",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate400,
                    )
                }
            }

            Column(Modifier.padding(horizontal = 16.dp)) {

                // --- Night mode ---
                Spacer(Modifier.height(8.dp))
                SectionHeading(if (arabic) "الوضع الليلي" else "NIGHT MODE")
                Spacer(Modifier.height(8.dp))

                AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    if (arabic) "اتبع إعداد الهاتف" else "Follow the phone",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate900,
                                )
                                Text(
                                    if (arabic) {
                                        "يتحول التطبيق للوضع الليلي مع هاتفك."
                                    } else {
                                        "The app turns dark when your phone does."
                                    },
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = Alpha.Slate500,
                                )
                            }
                            Switch(
                                checked = appearance.followPhone,
                                onCheckedChange = { AppearanceStore.setFollowPhone(it) },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Color.White,
                                    checkedTrackColor = Alpha.Green,
                                    uncheckedTrackColor = Alpha.Slate200,
                                ),
                            )
                        }

                        Spacer(Modifier.height(14.dp))

                        // Still shown while following, greyed — so the app never
                        // hides which of the two it is currently in.
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            ModeButton(
                                label = if (arabic) "فاتح" else "Light",
                                icon = Icons.Filled.LightMode,
                                selected = !Alpha.dark,
                                dimmed = appearance.followPhone,
                                modifier = Modifier.weight(1f),
                            ) { AppearanceStore.setDark(false) }
                            ModeButton(
                                label = if (arabic) "داكن" else "Dark",
                                icon = Icons.Filled.DarkMode,
                                selected = Alpha.dark,
                                dimmed = appearance.followPhone,
                                modifier = Modifier.weight(1f),
                            ) { AppearanceStore.setDark(true) }
                        }

                        if (appearance.followPhone) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                if (arabic) {
                                    "أطفئ المتابعة لتثبيت الوضع بنفسك."
                                } else {
                                    "Turn the switch off to choose one and keep it."
                                },
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                color = Alpha.Slate400,
                            )
                        }
                    }
                }

                // --- Themes ---
                Spacer(Modifier.height(20.dp))
                SectionHeading(if (arabic) "لون التطبيق" else "APP COLOUR")
                Spacer(Modifier.height(8.dp))

                ALPHA_THEMES.chunked(2).forEach { pair ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                    ) {
                        pair.forEach { theme ->
                            ThemeCard(
                                theme = theme,
                                selected = appearance.themeId == theme.id,
                                arabic = arabic,
                                modifier = Modifier.weight(1f),
                            ) { AppearanceStore.setTheme(theme.id) }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }

                // --- Preview ---
                Spacer(Modifier.height(10.dp))
                SectionHeading(if (arabic) "معاينة" else "PREVIEW")
                Spacer(Modifier.height(8.dp))
                AlphaCard(modifier = Modifier.fillMaxWidth(), shape = Alpha.CardShape) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(Alpha.GreenSoft),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("A", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Alpha.Green)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    if (arabic) "أحمد محمد" else "Ahmed Mohamed",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Alpha.Slate900,
                                )
                                Text(
                                    if (arabic) "١٠:٣٠ · حشو" else "10:30 · Filling",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = Alpha.Slate500,
                                )
                            }
                            // A status pill, to show these never change with the theme.
                            StatusPill("Checked In", arabic)
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Surface(shape = Alpha.PillShape, color = Alpha.Ink, modifier = Modifier.weight(1f)) {
                                Text(
                                    if (arabic) "زر أساسي" else "Primary button",
                                    fontSize = 12.5.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                    modifier = Modifier.padding(vertical = 10.dp),
                                )
                            }
                            Surface(shape = Alpha.PillShape, color = Alpha.GreenSoft) {
                                Text(
                                    "+500 EGP",
                                    fontSize = 12.5.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Alpha.Green,
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))
                Text(
                    if (arabic) {
                        "ألوان حالات المواعيد ثابتة في كل الثيمات — حتى لا تتغير دلالتها."
                    } else {
                        "Appointment status colours stay the same in every theme, so a status never changes meaning."
                    },
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.Slate400,
                )
                Spacer(Modifier.height(28.dp))
            }
        }
    }
}

@Composable
private fun ModeButton(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    dimmed: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val tint = when {
        selected && !dimmed -> Color.White
        selected -> Alpha.Slate500
        else -> Alpha.Slate500
    }
    Surface(
        onClick = onClick,
        shape = Alpha.CardShape,
        color = when {
            selected && !dimmed -> Alpha.Ink
            selected -> Alpha.Slate200
            else -> Alpha.Slate50
        },
        modifier = modifier,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
            modifier = Modifier.padding(vertical = 12.dp),
        ) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(7.dp))
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = tint)
        }
    }
}

/** A swatch: the theme's two colours, its name, and a tick when it is the one in use. */
@Composable
private fun ThemeCard(
    theme: AlphaThemeOption,
    selected: Boolean,
    arabic: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val dark = Alpha.dark
    val ink = if (dark) theme.inkDark else theme.ink
    val accent = if (dark) theme.accentDark else theme.accent

    Surface(
        onClick = onClick,
        shape = Alpha.CardShape,
        color = Alpha.Card,
        modifier = modifier.then(
            if (selected) Modifier.border(2.dp, accent, Alpha.CardShape) else Modifier
        ),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(ink)
                )
                Spacer(Modifier.width((-9).dp))
                Box(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(accent)
                )
                Spacer(Modifier.weight(1f))
                if (selected) {
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .background(accent),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(13.dp))
                    }
                }
            }
            Spacer(Modifier.height(9.dp))
            Text(
                if (arabic) theme.ar else theme.en,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Bold,
                color = Alpha.Slate800,
                maxLines = 1,
            )
        }
    }
}
