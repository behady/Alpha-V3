package com.alphadental.clinic.ui

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * The assistant's front door: a floating bubble that lives on every tab.
 *
 * A voice assistant buried three taps deep in a menu is a feature; one hovering over whatever
 * you are doing is a colleague. The bubble sits above every screen, opens the conversation with
 * one tap, and can be dragged anywhere it is in the way — reception works around a Day-view
 * button all day, and a bubble that cannot move would cover it.
 *
 * Where you drag it is remembered on the phone, because a bubble that snaps home every morning
 * teaches people it cannot be moved at all.
 */
@Composable
fun BoxScope.AssistantBubble(onOpen: () -> Unit) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current

    val prefs = remember { context.getSharedPreferences("alpha_ui", Context.MODE_PRIVATE) }
    var offset by remember {
        mutableStateOf(Offset(prefs.getFloat("bubble_dx", 0f), prefs.getFloat("bubble_dy", 0f)))
    }

    // Anchored bottom-end, so dragging moves it left and up: offsets run negative, clamped so
    // the bubble can reach any corner but never leave the screen.
    val maxLeft = with(density) { (configuration.screenWidthDp.dp - 76.dp).toPx() }
    val maxUp = with(density) { (configuration.screenHeightDp.dp - 220.dp).toPx() }

    Surface(
        shape = CircleShape,
        color = Alpha.Ink,
        shadowElevation = 8.dp,
        modifier = Modifier
            .align(Alignment.BottomEnd)
            // Above the Day tab's booking button, which owns the default corner.
            .padding(end = 16.dp, bottom = 92.dp)
            .offset { IntOffset(offset.x.roundToInt(), offset.y.roundToInt()) }
            .size(54.dp)
            .pointerInput(maxLeft, maxUp) {
                detectDragGestures(
                    onDrag = { change, amount ->
                        change.consume()
                        offset = Offset(
                            (offset.x + amount.x).coerceIn(-maxLeft, 0f),
                            (offset.y + amount.y).coerceIn(-maxUp, 0f),
                        )
                    },
                    onDragEnd = {
                        prefs.edit()
                            .putFloat("bubble_dx", offset.x)
                            .putFloat("bubble_dy", offset.y)
                            .apply()
                    },
                )
            }
            .clip(CircleShape)
            .clickable(onClick = onOpen),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(
                Icons.Filled.Mic,
                contentDescription = "Assistant",
                tint = Color.White,
                modifier = Modifier.size(24.dp),
            )
        }
    }
}
