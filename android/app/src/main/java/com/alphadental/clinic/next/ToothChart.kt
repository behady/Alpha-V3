package com.alphadental.clinic.next

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.next.data.LOWER_LEFT
import com.alphadental.clinic.next.data.LOWER_RIGHT
import com.alphadental.clinic.next.data.Tooth
import com.alphadental.clinic.next.data.UPPER_LEFT
import com.alphadental.clinic.next.data.UPPER_RIGHT
import com.alphadental.clinic.next.data.categoryNameOf
import com.alphadental.clinic.next.data.colourOf
import com.alphadental.clinic.next.data.labelOf
import com.alphadental.clinic.next.design.RowGroup
import com.alphadental.clinic.next.design.Rule
import com.alphadental.clinic.next.design.T
import com.alphadental.clinic.next.design.Txt
import com.alphadental.clinic.next.design.Type

/**
 * The mouth, as a dentist looks at it.
 *
 * Upper arch above, lower below, each split into the patient's right and left —
 * which is the LEFT and RIGHT of the screen respectively, because the chart is
 * drawn from the clinician's side of the chair. Getting that backwards is the
 * one mistake a dental chart must never make, so the quadrant orders live in
 * `Teeth.kt` beside a note saying why they run outward-to-inward.
 *
 * A tooth is coloured by the most serious thing recorded on it, not the first.
 * Teeth with nothing recorded stay blank: an absent entry means nobody has said
 * anything about that tooth, which is not the same as saying it is healthy.
 */
@Composable
fun ToothChart(
    teeth: Map<Int, Tooth>,
    selected: Int?,
    onSelect: (Int?) -> Unit,
) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Rule()
            Column(Modifier.padding(horizontal = 12.dp, vertical = 16.dp)) {

                ArchLabel("Upper")
                Spacer(Modifier.height(8.dp))
                Arch(UPPER_RIGHT, UPPER_LEFT, teeth, selected, onSelect)

                Spacer(Modifier.height(14.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(T.line))
                Spacer(Modifier.height(14.dp))

                Arch(LOWER_RIGHT, LOWER_LEFT, teeth, selected, onSelect)
                Spacer(Modifier.height(8.dp))
                ArchLabel("Lower")

                Spacer(Modifier.height(16.dp))
                Legend(teeth)
            }
            Rule()
        }
    }
}

@Composable
private fun ArchLabel(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        // The patient's right is on the viewer's left. Labelled, because a chart
        // that does not say which side is which is a chart nobody trusts.
        Txt("Right", Type.chip, T.inkFaint, uppercase = true)
        Txt(text, Type.chip, T.inkFaint, uppercase = true)
        Txt("Left", Type.chip, T.inkFaint, uppercase = true)
    }
}

/**
 * The same mouth, used to pick teeth for a treatment or a lab case.
 *
 * Several at once, and it keeps the chart's own colours underneath: choosing
 * teeth for a filling while being able to see which of them are already charted
 * as decayed is the whole reason a dentist looks at a chart rather than a list of
 * numbers.
 */
@Composable
fun ToothPickerChart(
    chosen: Set<Int>,
    teeth: Map<Int, Tooth> = emptyMap(),
    onToggle: (Int) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
        ArchLabel("Upper")
        Spacer(Modifier.height(8.dp))
        PickArch(UPPER_RIGHT, UPPER_LEFT, teeth, chosen, onToggle)

        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(T.line))
        Spacer(Modifier.height(12.dp))

        PickArch(LOWER_RIGHT, LOWER_LEFT, teeth, chosen, onToggle)
        Spacer(Modifier.height(8.dp))
        ArchLabel("Lower")
    }
}

@Composable
private fun PickArch(
    right: List<Int>,
    left: List<Int>,
    teeth: Map<Int, Tooth>,
    chosen: Set<Int>,
    onToggle: (Int) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        right.forEach { ToothCell(it, teeth[it], it in chosen, Modifier.weight(1f)) { n -> onToggle(n ?: it) } }
        Box(Modifier.width(2.dp).height(46.dp).background(T.line))
        left.forEach { ToothCell(it, teeth[it], it in chosen, Modifier.weight(1f)) { n -> onToggle(n ?: it) } }
    }
}

@Composable
private fun Arch(
    right: List<Int>,
    left: List<Int>,
    teeth: Map<Int, Tooth>,
    selected: Int?,
    onSelect: (Int?) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        right.forEach { ToothCell(it, teeth[it], selected == it, Modifier.weight(1f), onSelect) }
        // The midline, so a dentist can count outward from it without reading
        // every number.
        Box(Modifier.width(2.dp).height(46.dp).background(T.line))
        left.forEach { ToothCell(it, teeth[it], selected == it, Modifier.weight(1f), onSelect) }
    }
}

@Composable
private fun ToothCell(
    number: Int,
    tooth: Tooth?,
    isSelected: Boolean,
    modifier: Modifier,
    onSelect: (Int?) -> Unit,
) {
    val leading = tooth?.leading
    val fill = leading?.let { colourOf(it) }

    Column(
        modifier.clickable { onSelect(if (isSelected) null else number) },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(0.72f)
                .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp, bottomStart = 6.dp, bottomEnd = 6.dp))
                .background(fill ?: T.surfaceSoft)
                .border(
                    if (isSelected) 2.dp else 1.dp,
                    when {
                        isSelected -> T.ink
                        fill != null -> Color.Transparent
                        else -> T.line
                    },
                    RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp, bottomStart = 6.dp, bottomEnd = 6.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            // A tooth carrying more than one condition gets a dot, so the chart
            // does not quietly imply the colour is the whole story.
            if ((tooth?.statuses?.size ?: 0) > 1) {
                Box(Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = .85f)))
            }
        }
        Spacer(Modifier.height(3.dp))
        Txt(
            number.toString(),
            Type.chip.copy(fontSize = 8.5.sp, letterSpacing = 0.sp),
            if (isSelected) T.ink else T.inkFaint,
        )
    }
}

/**
 * What the colours mean — but only the ones actually on this chart.
 *
 * A full eleven-category key under a mouth with two things wrong in it is
 * furniture. It grows to fit what is there.
 */
@Composable
private fun Legend(teeth: Map<Int, Tooth>) {
    val present = teeth.values
        .mapNotNull { it.leading }
        .map { categoryNameOf(it) to colourOf(it) }
        .distinctBy { it.first }
        .sortedBy { it.first }

    if (present.isEmpty()) {
        Txt("Nothing has been charted for this patient yet.", Type.caption, T.inkFaint, maxLines = 2)
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        present.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { (name, colour) ->
                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(colour))
                        Spacer(Modifier.width(7.dp))
                        Txt(name, Type.caption.copy(fontSize = 11.5.sp), T.inkMuted)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/**
 * Everything recorded on one tooth.
 *
 * Shown under the chart rather than in a popup: a dentist reading a chart is
 * comparing teeth, and a dialog that covers the mouth to tell you about one of
 * them makes that impossible.
 */
@Composable
fun ToothDetail(tooth: Tooth?, number: Int?) {
    if (number == null) return

    Column {
        com.alphadental.clinic.next.design.SectionLabel("Tooth $number")
        RowGroup {
            if (tooth == null || !tooth.hasAnything) {
                Txt(
                    "Nothing recorded on this tooth.",
                    Type.body,
                    T.inkFaint,
                    Modifier.padding(horizontal = T.gutter, vertical = 14.dp),
                    maxLines = 2,
                )
            } else {
                tooth.statuses.forEachIndexed { i, id ->
                    if (i > 0) Rule()
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = T.gutter, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(colourOf(id)))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Txt(labelOf(id), Type.rowName, T.ink, maxLines = 2)
                            Spacer(Modifier.height(2.dp))
                            Txt(categoryNameOf(id), Type.caption, T.inkMuted)
                        }
                    }
                }
                if (tooth.notes.isNotBlank()) {
                    Rule()
                    Column(Modifier.padding(horizontal = T.gutter, vertical = 12.dp)) {
                        Txt("Note", Type.chip, T.inkFaint, uppercase = true)
                        Spacer(Modifier.height(4.dp))
                        Txt(tooth.notes, Type.body, T.inkBody, maxLines = 10)
                    }
                }
            }
        }
    }
}
