package com.alphadental.clinic.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.Appointment
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * One day's appointments, in time order.
 *
 * The screen the app exists for. Deliberately a flat list rather than a grid of
 * time slots: on a phone held one-handed between patients, a list is scannable and
 * a timetable is not.
 */
@Composable
fun DayScreen(
    date: String,
    appointments: List<Appointment>,
    loading: Boolean,
    offline: Boolean,
    pending: Int,
    arabic: Boolean,
    isToday: Boolean,
    onShiftDay: (Int) -> Unit,
    onToday: () -> Unit,
    onOpenAppointment: (Appointment) -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {

        // The slab carries whose day it is; the five-day strip stays on the light
        // ground below, where a row of tappable chips reads as controls rather
        // than as decoration on a dark band.
        SlabSurface {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = prettyDate(date, arabic),
                        fontSize = 23.sp,
                        fontWeight = FontWeight.ExtraBold,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                        color = onSlab,
                        maxLines = 1,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = countLabel(appointments.size, arabic),
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = onSlabDim,
                    )
                }
                IconButton(onClick = { onShiftDay(-1) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous day", tint = onSlabDim)
                }
                IconButton(onClick = { onShiftDay(1) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Next day", tint = onSlabDim)
                }
            }

            if (!isToday) {
                Spacer(Modifier.height(12.dp))
                Surface(
                    onClick = onToday,
                    shape = Alpha.PillShape,
                    color = onSlab.copy(alpha = .14f),
                ) {
                    Text(
                        if (arabic) "العودة إلى اليوم" else "Back to today",
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.5.sp,
                        color = onSlab,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }

        Surface(color = Alpha.Ground, modifier = Modifier.fillMaxWidth()) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            ) {
                (-2..2).forEach { offset ->
                    DayChip(date, offset, arabic, onShiftDay, Modifier.weight(1f))
                }
            }
        }

        when {
            loading -> Column(
                Modifier.fillMaxWidth().padding(vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(color = Alpha.Slate400, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
            }

            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (offline) item { OfflineBanner(pending, arabic) }

                if (appointments.isEmpty()) {
                    item {
                        Spacer(Modifier.height(8.dp))
                        EmptyState(if (arabic) "لا توجد مواعيد في هذا اليوم." else "Nothing booked on this day.")
                    }
                } else {
                    items(appointments, key = { it.id }) { appointment ->
                        AppointmentCard(appointment, arabic) { onOpenAppointment(appointment) }
                    }
                }
            }
        }
    }
}

/**
 * One day in the strip. The selected day is the filled square; today, when it is
 * not the selected day, carries a small green dot so the way home stays visible.
 */
@Composable
private fun DayChip(
    baseDate: String,
    offset: Int,
    arabic: Boolean,
    onShiftDay: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cal = Calendar.getInstance().apply {
        time = AppViewModel.parseDate(baseDate)
        add(Calendar.DAY_OF_YEAR, offset)
    }
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    val weekday = SimpleDateFormat("EEE", locale).format(cal.time)
    val dayNumber = cal.get(Calendar.DAY_OF_MONTH).toString()
    val selected = offset == 0
    val isTodayChip = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time) == AppViewModel.today()

    Surface(
        onClick = { if (!selected) onShiftDay(offset) },
        shape = RoundedCornerShape(14.dp),
        color = if (selected) Alpha.Ink else Alpha.Card,
        border = if (!selected && Alpha.dark) BorderStroke(1.dp, Alpha.Slate100) else null,
        shadowElevation = if (selected || Alpha.dark) 0.dp else 1.dp,
        modifier = modifier,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(vertical = 8.dp),
        ) {
            Text(
                weekday.uppercase(locale),
                fontSize = 9.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) Color.White.copy(alpha = .8f) else Alpha.Slate400,
                maxLines = 1,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                dayNumber,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = if (selected) Color.White else Alpha.Slate800,
            )
            Spacer(Modifier.height(3.dp))
            Box(
                Modifier
                    .size(4.dp)
                    .clip(CircleShape)
                    .background(
                        when {
                            isTodayChip && selected -> Color.White
                            isTodayChip -> Alpha.Green
                            else -> Color.Transparent
                        }
                    )
            )
        }
    }
}

private fun countLabel(count: Int, arabic: Boolean): String = when {
    arabic -> "$count موعد"
    count == 1 -> "1 appointment"
    else -> "$count appointments"
}

/** "Tue, 12 Aug" — short enough for the header, unambiguous about the day. */
private fun prettyDate(date: String, arabic: Boolean): String {
    val parsed = AppViewModel.parseDate(date)
    val locale = if (arabic) Locale("ar", "EG") else Locale.US
    return SimpleDateFormat("EEE, d MMM", locale).format(parsed)
}
