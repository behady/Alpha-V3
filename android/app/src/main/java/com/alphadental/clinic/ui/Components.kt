package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.Appointment

/**
 * A white rounded card on the mint ground — the shape every panel on the website's
 * mobile view uses.
 */
@Composable
fun AlphaCard(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = Alpha.BigCardShape,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = shape,
        color = Alpha.Card,
        shadowElevation = 1.dp,
        content = { Box(Modifier.padding(0.dp)) { content() } },
    )
}

/** The small status chip. Colours come straight from the website's status map. */
@Composable
fun StatusPill(status: String?, arabic: Boolean) {
    val style = statusStyle(status)
    Surface(shape = Alpha.PillShape, color = style.pillBg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
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

/**
 * One appointment in the day list.
 *
 * The coloured left edge is the whole point: staff scan the strip, not the text.
 * Its colour is the appointment's state, matching the website exactly.
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
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .width(5.dp)
                    .fillMaxHeight()
                    .background(style.accent)
            )
            Column(Modifier.padding(14.dp).fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Filled.Schedule,
                        contentDescription = null,
                        tint = Alpha.Slate400,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(
                        text = appointment.time.ifBlank { "—" },
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate600,
                    )
                    Spacer(Modifier.weight(1f))
                    StatusPill(appointment.status, arabic)
                }

                Spacer(Modifier.height(6.dp))

                Text(
                    text = appointment.patientName.ifBlank {
                        if (arabic) "بدون اسم" else "No name"
                    },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Black,
                    color = Alpha.Slate900,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )

                if (appointment.doctor.isNotBlank() || appointment.treatment.isNotBlank()) {
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = listOf(
                            appointment.doctor.takeIf { it.isNotBlank() }?.let { "Dr. $it" },
                            appointment.treatment.takeIf { it.isNotBlank() },
                        ).filterNotNull().joinToString(" · "),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Alpha.Slate500,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                // Says plainly that this change is still only on this phone. Without
                // it, a check-in made with no signal looks exactly like one that
                // reached the clinic.
                if (appointment.pendingWrite) {
                    Spacer(Modifier.height(7.dp))
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
                            fontWeight = FontWeight.Bold,
                            color = Alpha.Slate400,
                        )
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
        color = Color(0xFFFEF3C7),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.CloudOff,
                contentDescription = null,
                tint = Color(0xFF92400E),
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(9.dp))
            Column {
                Text(
                    text = if (arabic) "تعمل بدون إنترنت" else "Working offline",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Black,
                    color = Color(0xFF92400E),
                )
                Text(
                    text = when {
                        pending > 0 && arabic -> "$pending تغيير في انتظار الإرسال"
                        pending > 0 -> "$pending change${if (pending == 1) "" else "s"} waiting to be sent"
                        arabic -> "تظهر آخر نسخة محفوظة على الهاتف"
                        else -> "Showing the last copy saved on this phone"
                    },
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFF92400E).copy(alpha = .8f),
                )
            }
        }
    }
}

/** A number with a caption, as used across the website's mobile dashboard. */
@Composable
fun StatTile(
    value: String,
    caption: String,
    tint: Color = Alpha.Slate900,
    modifier: Modifier = Modifier,
) {
    AlphaCard(modifier = modifier, shape = Alpha.CardShape) {
        Column(Modifier.padding(14.dp)) {
            Text(value, fontSize = 24.sp, fontWeight = FontWeight.Black, color = tint)
            Spacer(Modifier.height(2.dp))
            Text(
                caption,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
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
        fontSize = 12.sp,
        fontWeight = FontWeight.Black,
        color = Alpha.Slate500,
        letterSpacing = 1.2.sp,
        modifier = modifier,
    )
}

/** Empty-state block, styled like the website's dashed placeholder panels. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = Alpha.BigCardShape,
        color = Alpha.Card.copy(alpha = .6f),
    ) {
        Box(Modifier.padding(vertical = 34.dp), contentAlignment = Alignment.Center) {
            Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate400)
        }
    }
}

@Composable
fun VerticalSpace(height: Int) = Spacer(Modifier.height(height.dp))
