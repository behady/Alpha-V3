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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.core.view.WindowCompat
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
 * It has its own launcher icon, "Alpha (new)", for as long as the rebuild is
 * unfinished — some screens still exist only in the old one.
 */
class NextActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Before anything asks who is signed in: the answer includes which clinic, and that is
        // stored here.
        com.alphadental.clinic.next.data.ClinicChoice.attach(this)
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
                Gate(preview)
            }
        }
    }
}
