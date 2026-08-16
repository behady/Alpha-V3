package com.alphadental.clinic.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.alphadental.clinic.data.LocationFinder
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * Clock in and out.
 *
 * Deliberately one button whose label is the action, not a pair of buttons. Whoever is holding the
 * phone knows whether they have just arrived or are leaving; what they cannot know is whether the
 * system thinks their last shift is still open — so the button states that instead.
 */
@Composable
fun ClockCard(
    onShift: Boolean,
    since: Long,
    busy: Boolean,
    error: String?,
    arabic: Boolean,
    onPunch: () -> Unit,
    onDismissError: () -> Unit,
) {
    // Ticks so the elapsed time is live rather than frozen at whenever the screen was drawn.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(onShift) {
        while (onShift) {
            now = System.currentTimeMillis()
            delay(30_000)
        }
    }

    AlphaCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.Schedule,
                    contentDescription = null,
                    tint = if (onShift) Alpha.Green else Alpha.Slate400,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.size(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = when {
                            onShift && arabic -> "أنت داخل الدوام"
                            onShift -> "You are clocked in"
                            arabic -> "لم تسجل دخول"
                            else -> "Not clocked in"
                        },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate800,
                    )
                    if (onShift && since > 0) {
                        Text(
                            elapsedLabel(now - since, arabic),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate400,
                        )
                    }
                }
            }

            if (error != null) {
                Spacer(Modifier.height(12.dp))
                Surface(shape = Alpha.CardShape, color = Alpha.DangerSoft, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        // The real reason, not "failed". "You appear to be 300m from the clinic"
                        // is something a person can act on; a generic error is not.
                        Text(
                            error,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.DangerText,
                        )
                        TextButton(onClick = onDismissError, modifier = Modifier.padding(top = 2.dp)) {
                            Text(
                                if (arabic) "حسناً" else "Dismiss",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Alpha.DangerText,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onPunch,
                enabled = !busy,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (onShift) Color(0xFF9F1239) else Alpha.Ink,
                    contentColor = Color.White,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                if (busy) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(10.dp))
                    Text(
                        // Says what it is waiting for. A spinner while the GPS settles for six
                        // seconds otherwise reads as the app having hung.
                        if (arabic) "جارٍ تحديد الموقع..." else "Checking you are on site...",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                    )
                } else {
                    Text(
                        text = when {
                            onShift && arabic -> "تسجيل خروج"
                            onShift -> "Clock out"
                            arabic -> "تسجيل حضور"
                            else -> "Clock in"
                        },
                        fontSize = 15.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
            }
        }
    }
}

/**
 * The location-permission dance around a clock punch, shared by every place a
 * punch can start. Location is asked for at the moment of the tap, not at
 * launch, and whatever the answer the punch still runs — a refusal comes back
 * as a plain explanation rather than a silent no-op.
 */
@Composable
fun rememberPunchAction(onPunch: () -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { onPunch() }
    return {
        if (LocationFinder.hasPermission(context)) {
            onPunch()
        } else {
            launcher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                )
            )
        }
    }
}

internal fun elapsedLabel(millis: Long, arabic: Boolean): String {
    val minutes = (millis / 60_000L).coerceAtLeast(0L)
    val hours = minutes / 60
    val mins = minutes % 60

    return when {
        arabic && hours > 0 -> "منذ $hours ساعة و $mins دقيقة"
        arabic -> "منذ $mins دقيقة"
        hours > 0 -> "for ${hours}h ${mins}m"
        else -> "for ${mins}m"
    }
}
