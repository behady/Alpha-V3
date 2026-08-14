package com.alphadental.clinic.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.data.ClinicalNote

/**
 * FDI tooth numbering, the same quadrants the website charts.
 *
 * Upper right and lower right run outward-to-inward so that, laid left to right on screen, the
 * arch reads the way a dentist sees it looking at the patient — not the way the numbers ascend.
 */
private val Q1 = listOf(18, 17, 16, 15, 14, 13, 12, 11)   // upper right
private val Q2 = listOf(21, 22, 23, 24, 25, 26, 27, 28)   // upper left
private val Q4 = listOf(48, 47, 46, 45, 44, 43, 42, 41)   // lower right
private val Q3 = listOf(31, 32, 33, 34, 35, 36, 37, 38)   // lower left

private val ChildQ1 = listOf(55, 54, 53, 52, 51)
private val ChildQ2 = listOf(61, 62, 63, 64, 65)
private val ChildQ4 = listOf(85, 84, 83, 82, 81)
private val ChildQ3 = listOf(71, 72, 73, 74, 75)

/**
 * The teeth chart.
 *
 * Its job here is orientation, not diagnosis: which teeth have work recorded, and what. Tapping a
 * tooth filters the treatment list to it, which is how a dentist actually uses a chart mid-visit —
 * "what did we do on 36?" — rather than as a drawing surface.
 *
 * Surface-level marking and perio charting stay on the website. Those need precision a thumb on a
 * 6mm target cannot give, and a half-accurate periodontal chart is worse than none.
 */
@Composable
fun TeethChart(
    notes: List<ClinicalNote>,
    arabic: Boolean,
    selectedTooth: String?,
    onSelectTooth: (String?) -> Unit,
) {
    var showChild by remember { mutableStateOf(false) }

    // How many procedures touch each tooth, and whether any is still outstanding. Counting once
    // here keeps the per-tooth lookup out of the drawing loop.
    val byTooth = remember(notes) {
        notes.filter { it.tooth.isNotBlank() && it.tooth != "Gen" }
            .groupBy { it.tooth.trim() }
    }

    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionHeading(if (arabic) "الأسنان" else "TEETH", Modifier.weight(1f))
            TextButton(onClick = { showChild = !showChild }) {
                Text(
                    if (showChild) {
                        if (arabic) "أسنان دائمة" else "Adult teeth"
                    } else {
                        if (arabic) "أسنان لبنية" else "Child teeth"
                    },
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Black,
                    color = Alpha.Green,
                )
            }
        }

        Spacer(Modifier.height(6.dp))

        Surface(shape = Alpha.CardShape, color = Alpha.Slate50, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(vertical = 12.dp, horizontal = 8.dp)) {
                val upperRight = if (showChild) ChildQ1 else Q1
                val upperLeft = if (showChild) ChildQ2 else Q2
                val lowerRight = if (showChild) ChildQ4 else Q4
                val lowerLeft = if (showChild) ChildQ3 else Q3

                ArchRow(upperRight, upperLeft, byTooth, selectedTooth, onSelectTooth)

                // The midline. Without it the two arches read as one long row of numbers.
                Spacer(Modifier.height(6.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(Alpha.Slate200)
                )
                Spacer(Modifier.height(6.dp))

                ArchRow(lowerRight, lowerLeft, byTooth, selectedTooth, onSelectTooth)
            }
        }

        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            LegendDot(Alpha.Green, if (arabic) "علاج مكتمل" else "treated")
            LegendDot(Color(0xFFF59E0B), if (arabic) "غير مكتمل" else "outstanding")
        }

        if (selectedTooth != null) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    (if (arabic) "السن " else "Tooth ") + selectedTooth,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Black,
                    color = Alpha.Slate800,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { onSelectTooth(null) }) {
                    Text(
                        if (arabic) "عرض الكل" else "Show all",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Black,
                        color = Alpha.Slate500,
                    )
                }
            }
        }
    }
}

@Composable
private fun ArchRow(
    right: List<Int>,
    left: List<Int>,
    byTooth: Map<String, List<ClinicalNote>>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        right.forEach { Tooth(it, byTooth, selected, onSelect) }
        Spacer(Modifier.width(6.dp))
        left.forEach { Tooth(it, byTooth, selected, onSelect) }
    }
}

@Composable
private fun Tooth(
    number: Int,
    byTooth: Map<String, List<ClinicalNote>>,
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    val key = number.toString()
    val notes = byTooth[key].orEmpty()
    val isSelected = selected == key

    // Outstanding wins over treated: a tooth with a completed filling and a planned crown is a
    // tooth with work still to do, and colouring it green would say the opposite.
    val outstanding = notes.any { it.status != "Completed" }

    val fill = when {
        isSelected -> Alpha.Ink
        outstanding -> Color(0xFFFDE68A)
        notes.isNotEmpty() -> Color(0xFFA7F3D0)
        else -> Color.White
    }
    val textColor = when {
        isSelected -> Color.White
        notes.isNotEmpty() -> Alpha.Slate800
        else -> Alpha.Slate400
    }

    Box(
        Modifier
            .padding(horizontal = 1.dp)
            .size(width = 20.dp, height = 26.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(fill)
            // Tapping the selected tooth again clears the filter, so there is always a way back
            // without hunting for a separate control.
            .clickable { onSelect(if (isSelected) null else key) },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = key,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
            color = textColor,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun LegendDot(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(color)
        )
        Spacer(Modifier.width(5.dp))
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Alpha.Slate500)
    }
}
