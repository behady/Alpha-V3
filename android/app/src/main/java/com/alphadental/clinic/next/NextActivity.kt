package com.alphadental.clinic.next

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.alphadental.clinic.next.design.DarkPalette
import com.alphadental.clinic.next.design.LightPalette
import com.alphadental.clinic.next.design.LocalPalette
import com.alphadental.clinic.next.design.T

/**
 * The rebuilt app's shell.
 *
 * It lives beside the existing activity rather than replacing it, so the app on
 * the phone keeps working while this is being built. Launch it with:
 *
 *     adb shell am start -n com.alphadental.clinic.debug/com.alphadental.clinic.next.NextActivity
 *
 * It has no launcher icon on purpose — two icons for one app is a worse problem
 * than an extra adb command.
 */
class NextActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge to edge, because the slab has to paint under the status bar.
        enableEdgeToEdge()
        // Debug-only: draw the design's example data instead of reading the
        // clinic, so the layout can be checked without anyone's credentials.
        val preview = intent?.getBooleanExtra("preview", false) == true
        setContent { NextApp(preview) }
    }
}

/**
 * The theme, which is one decision: light or dark.
 *
 * Light unless the phone is dark AND nobody has said otherwise. There is no
 * theme picker: a theme used to also repaint the app's frame, which is how six
 * "themes" became six differently-coloured products. The frame is fixed now.
 */
@Composable
private fun NextApp(preview: Boolean = false) {
    val dark = isSystemInDarkTheme()
    val palette = if (dark) DarkPalette else LightPalette

    // The status-bar icons have to invert with the surface under them, and the
    // surface under them is always the slab — which is dark in both themes.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme {
            Surface(color = T.ground, modifier = Modifier.fillMaxSize()) {
                if (preview) {
                    DashboardScreen(state = previewDashboard(), onCheckOut = {})
                } else {
                    val model: DashboardModel = viewModel()
                    val state by model.state.collectAsState()
                    androidx.compose.runtime.LaunchedEffect(Unit) { model.start() }
                    DashboardScreen(state = state, onCheckOut = model::checkOut)
                }
            }
        }
    }
}
