package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.AppViewModel
import com.alphadental.clinic.data.Appointment
import java.text.SimpleDateFormat
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

        // Day switcher
        Surface(color = Alpha.Ground, modifier = Modifier.fillMaxWidth()) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { onShiftDay(-1) }) {
                    Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous day", tint = Alpha.Slate600)
                }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = prettyDate(date, arabic),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate900,
                    )
                    Text(
                        text = countLabel(appointments.size, arabic),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.Slate500,
                    )
                }
                IconButton(onClick = { onShiftDay(1) }) {
                    Icon(Icons.Filled.ChevronRight, contentDescription = "Next day", tint = Alpha.Slate600)
                }
            }
        }

        if (!isToday) {
            TextButton(onClick = onToday, modifier = Modifier.padding(start = 12.dp)) {
                Text(
                    if (arabic) "العودة إلى اليوم" else "Back to today",
                    fontWeight = FontWeight.Black,
                    fontSize = 13.sp,
                    color = Alpha.Green,
                )
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
