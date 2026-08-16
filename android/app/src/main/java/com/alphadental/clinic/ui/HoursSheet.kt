package com.alphadental.clinic.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicSchedule

/** Sunday first, matching the website's own order. */
private val WEEK = listOf("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")

private val OPENING_HOURS = (6..14).toList()
private val CLOSING_HOURS = (14..23).toList()
private val SLOT_CHOICES = listOf(15, 30, 45, 60)

/**
 * The clinic's working hours.
 *
 * The one piece of configuration worth having on a phone. Everything else in Settings is set up
 * once from a desk and then left alone, but "we are shut on Thursday after all" is decided the
 * evening before, by whoever is holding a phone — and until it is changed the booking screen keeps
 * offering slots nobody will be there to work.
 *
 * Hours are picked from a list rather than typed. A clinic opens on the hour, and a free-text time
 * field on a phone is four taps and a chance to store something the slot builder cannot read.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun HoursSheet(
    schedule: ClinicSchedule,
    saving: Boolean,
    arabic: Boolean,
    onSave: (String, String, Int, List<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var openHour by remember { mutableStateOf(schedule.startHour) }
    var closeHour by remember { mutableStateOf(schedule.endHour) }
    var slot by remember { mutableStateOf(schedule.slotDuration) }
    var offDays by remember { mutableStateOf(schedule.offDays) }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState, containerColor = Alpha.Card) {
        Column(
            Modifier
                .padding(start = 20.dp, end = 20.dp, bottom = 28.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                if (arabic) "ساعات العمل" else "Clinic hours",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Alpha.Slate900,
            )
            Text(
                if (arabic) "تُطبَّق على شاشة الحجز في التطبيق وعلى النظام."
                else "Applies to the booking screen here and on the website.",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate500,
                modifier = Modifier.padding(top = 4.dp),
            )

            if (!schedule.isConfigured) {
                Spacer(Modifier.height(12.dp))
                Surface(shape = Alpha.CardShape, color = Alpha.WarnBg, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (arabic) "لم تُضبط ساعات العيادة بعد — المعروض هنا افتراضي."
                        else "No hours have been set yet — what is shown is a default, not your clinic's.",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.Bold,
                        color = Alpha.WarnText,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            Spacer(Modifier.height(18.dp))
            SectionHeading(if (arabic) "يفتح" else "OPENS")
            Spacer(Modifier.height(8.dp))
            HourRow(OPENING_HOURS, openHour) { openHour = it }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "يغلق" else "CLOSES")
            Spacer(Modifier.height(8.dp))
            HourRow(CLOSING_HOURS, closeHour) { closeHour = it }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "مدة الموعد" else "APPOINTMENT LENGTH")
            Spacer(Modifier.height(8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(SLOT_CHOICES) { minutes ->
                    FilterChip(
                        selected = slot == minutes,
                        onClick = { slot = minutes },
                        label = {
                            Text(
                                if (arabic) "$minutes د" else "$minutes min",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        },
                        shape = Alpha.PillShape,
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Alpha.Ink,
                            selectedLabelColor = Color.White,
                        ),
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            SectionHeading(if (arabic) "أيام الإجازة" else "DAYS CLOSED")
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                WEEK.forEach { day ->
                    val off = day in offDays
                    FilterChip(
                        selected = off,
                        onClick = { offDays = if (off) offDays - day else offDays + day },
                        label = {
                            Text(dayLabel(day, arabic), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        },
                        shape = Alpha.PillShape,
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Color(0xFFE11D48),
                            selectedLabelColor = Color.White,
                        ),
                    )
                }
            }

            Spacer(Modifier.height(18.dp))

            // Refused rather than saved and left to produce an empty day. A clinic that closes
            // before it opens builds no slots at all, and the booking screen would simply look
            // broken with nothing to say why.
            val valid = closeHour > openHour
            if (!valid) {
                Text(
                    if (arabic) "وقت الإغلاق يجب أن يكون بعد وقت الفتح."
                    else "Closing time has to be after opening time.",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Alpha.Danger,
                )
                Spacer(Modifier.height(8.dp))
            }

            Button(
                onClick = {
                    onSave(
                        "%02d:00".format(openHour),
                        "%02d:00".format(closeHour),
                        slot,
                        offDays,
                    )
                },
                enabled = valid && !saving,
                shape = Alpha.CardShape,
                colors = ButtonDefaults.buttonColors(containerColor = Alpha.Ink, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                } else {
                    Text(
                        if (arabic) "حفظ" else "Save hours",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Text(
                if (arabic) "الأسعار، الموظفون، القوالب وبقية الإعدادات تُدار من النظام على المتصفح."
                else "Prices, staff, templates and the rest of Settings are managed in the full system.",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                color = Alpha.Slate400,
            )
        }
    }
}

@Composable
private fun HourRow(hours: List<Int>, selected: Int, onSelect: (Int) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(hours) { hour ->
            FilterChip(
                selected = selected == hour,
                onClick = { onSelect(hour) },
                label = { Text(clockLabel(hour), fontSize = 13.sp, fontWeight = FontWeight.Bold) },
                shape = Alpha.PillShape,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Alpha.Ink,
                    selectedLabelColor = Color.White,
                ),
            )
        }
    }
}

private fun clockLabel(hour: Int): String = when {
    hour == 0 -> "12 AM"
    hour < 12 -> "$hour AM"
    hour == 12 -> "12 PM"
    else -> "${hour - 12} PM"
}

private fun dayLabel(day: String, arabic: Boolean): String = if (arabic) {
    when (day) {
        "sunday" -> "الأحد"
        "monday" -> "الاثنين"
        "tuesday" -> "الثلاثاء"
        "wednesday" -> "الأربعاء"
        "thursday" -> "الخميس"
        "friday" -> "الجمعة"
        else -> "السبت"
    }
} else {
    day.replaceFirstChar { it.uppercase() }.take(3)
}
