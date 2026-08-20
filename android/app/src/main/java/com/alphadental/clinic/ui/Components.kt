package com.alphadental.clinic.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment
import com.alphadental.clinic.data.withDoctorTitle

/**
 * The app's panel: a soft rounded card on the calm ground.
 *
 * In light mode it floats on a faint shadow; in dark mode shadows are invisible,
 * so a hairline border does the same job of separating card from ground.
 */
@Composable
fun AlphaCard(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = Alpha.BigCardShape,
    color: Color = Alpha.Card,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = shape,
        color = color,
        border = if (Alpha.dark) BorderStroke(1.dp, Alpha.Slate100) else null,
        shadowElevation = if (Alpha.dark) 0.dp else 1.dp,
        content = { Box(Modifier.padding(0.dp)) { content() } },
    )
}

/** The small status chip. Same hues in both themes — staff read these by colour. */
@Composable
fun StatusPill(status: String?, arabic: Boolean) {
    val style = statusStyle(status)
    Surface(shape = Alpha.PillShape, color = style.pillBg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.5.dp),
        ) {
            Box(
                Modifier
                    .size(6.dp)
                    .clip(Alpha.PillShape)
                    .background(style.accent)
            )
            Spacer(Modifier.width(5.dp))
            Text(
                text = statusLabel(status, arabic),
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = style.pillText,
            )
        }
    }
}

/** A circled initial, tinted by the appointment's status. */
@Composable
fun InitialBadge(name: String, style: StatusStyle) {
    Box(
        modifier = Modifier
            .size(42.dp)
            .clip(CircleShape)
            .background(style.pillBg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.trim().firstOrNull()?.uppercase() ?: "•",
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold,
            color = style.pillText,
        )
    }
}

/**
 * One appointment in the day list.
 *
 * The coloured edge stays from the old design — staff scan the strip, not the
 * text — joined now by an initial badge in the same tint, a clearer name line,
 * and the visit details gathered into one quiet caption underneath.
 */
@Composable
fun AppointmentCard(
    appointment: Appointment,
    arabic: Boolean,
    onClick: () -> Unit,
) {
    val style = statusStyle(appointment.status)

    AlphaCard(
        modifier = Modifier
            .fillMaxWidth()
            .clip(Alpha.CardShape)
            .clickable(onClick = onClick),
        shape = Alpha.CardShape,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .padding(start = 10.dp)
                    .size(width = 4.dp, height = 44.dp)
                    .clip(Alpha.PillShape)
                    .background(style.accent)
            )
            Row(
                Modifier.padding(start = 10.dp, top = 13.dp, bottom = 13.dp, end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                InitialBadge(appointment.patientName, style)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = appointment.patientName.ifBlank {
                                if (arabic) "بدون اسم" else "No name"
                            },
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate900,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        Spacer(Modifier.width(8.dp))
                        StatusPill(appointment.status, arabic)
                    }

                    Spacer(Modifier.height(4.dp))

                    Text(
                        text = listOfNotNull(
                            appointment.time.ifBlank { "—" },
                            appointment.doctor.takeIf { it.isNotBlank() }?.let { withDoctorTitle(it) },
                        ).joinToString("  ·  "),
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Alpha.Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )

                    // The treatment gets a line of its own: sharing one with the time
                    // and doctor left it truncated more often than not.
                    if (appointment.treatment.isNotBlank()) {
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = appointment.treatment,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Alpha.Slate500,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }

                    // Says plainly that this change is still only on this phone. Without
                    // it, a check-in made with no signal looks exactly like one that
                    // reached the clinic.
                    if (appointment.pendingWrite) {
                        Spacer(Modifier.height(5.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Filled.CloudOff,
                                contentDescription = null,
                                tint = Alpha.Slate400,
                                modifier = Modifier.size(12.dp),
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = if (arabic) "لم تُرسل بعد" else "Not sent yet",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Alpha.Slate400,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Shown whenever the screen is being served from the phone's own copy. */
@Composable
fun OfflineBanner(pending: Int, arabic: Boolean) {
    Surface(
        shape = Alpha.CardShape,
        color = Alpha.WarnBg,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.CloudOff,
                contentDescription = null,
                tint = Alpha.WarnText,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(9.dp))
            Column {
                Text(
                    text = if (arabic) "تعمل بدون إنترنت" else "Working offline",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.WarnText,
                )
                Text(
                    text = when {
                        pending > 0 && arabic -> "$pending تغيير في انتظار الإرسال"
                        pending > 0 -> "$pending change${if (pending == 1) "" else "s"} waiting to be sent"
                        arabic -> "تظهر آخر نسخة محفوظة على الهاتف"
                        else -> "Showing the last copy saved on this phone"
                    },
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Alpha.WarnText.copy(alpha = .8f),
                )
            }
        }
    }
}

/** A number with a caption — the dashboard's building block. */
@Composable
fun StatTile(
    value: String,
    caption: String,
    tint: Color = Alpha.Slate900,
    modifier: Modifier = Modifier,
) {
    AlphaCard(modifier = modifier, shape = Alpha.CardShape) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 16.dp)) {
            Text(value, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = tint)
            Spacer(Modifier.height(3.dp))
            Text(
                caption,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = Alpha.Slate500,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        fontSize = 11.5.sp,
        fontWeight = FontWeight.Bold,
        color = Alpha.Slate400,
        letterSpacing = 1.4.sp,
        modifier = modifier.padding(top = 6.dp),
    )
}

/** Empty-state block: quiet, centred, never alarming. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = Alpha.BigCardShape,
        color = Alpha.Card.copy(alpha = if (Alpha.dark) .45f else .6f),
    ) {
        Box(Modifier.padding(vertical = 36.dp, horizontal = 20.dp), contentAlignment = Alignment.Center) {
            Text(
                text,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = Alpha.Slate400,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * A square shortcut tile: icon in a soft tinted circle, label under it, and an
 * optional count badge. The dashboard's quick actions and the More tab's tool
 * grid are both built from these, so shortcuts look the same wherever they live.
 */
@Composable
fun ToolTile(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: Color = Alpha.Green,
    badge: Int = 0,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = Alpha.CardShape,
        color = Alpha.Card,
        border = if (Alpha.dark) BorderStroke(1.dp, Alpha.Slate100) else null,
        shadowElevation = if (Alpha.dark) 0.dp else 1.dp,
        modifier = modifier,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(vertical = 14.dp, horizontal = 6.dp),
        ) {
            Box {
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(tint.copy(alpha = if (Alpha.dark) .2f else .12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(21.dp))
                }
                if (badge > 0) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .size(18.dp)
                            .clip(CircleShape)
                            .background(Alpha.Danger),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (badge > 9) "9+" else badge.toString(),
                            fontSize = 9.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                label,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Alpha.Slate700,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun VerticalSpace(height: Int) = Spacer(Modifier.height(height.dp))

/**
 * Make the back button put the keyboard away before it closes the sheet.
 *
 * Android's own convention is that back dismisses the keyboard first and only closes the screen on
 * a second press. A `ModalBottomSheet` puts its content in its own dialog window, which takes the
 * back press for itself — so reaching for back to see the form behind the keyboard threw away
 * whatever had been typed into it.
 *
 * Registered inside the sheet's content, so it sits nearer the back dispatcher than the sheet's own
 * handler and gets first refusal. It is only enabled while the keyboard is actually up: with the
 * keyboard down, back closes the sheet exactly as before.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DismissKeyboardBeforeSheet() {
    val keyboardVisible = WindowInsets.isImeVisible
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current

    BackHandler(enabled = keyboardVisible) {
        // Focus is cleared as well as hiding the IME: leaving a field focused with no keyboard
        // leaves a blinking cursor in a box the person can no longer type into.
        keyboard?.hide()
        focus.clearFocus()
    }
}
