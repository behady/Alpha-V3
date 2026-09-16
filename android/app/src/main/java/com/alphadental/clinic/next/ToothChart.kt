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
import androidx.compose.ui.graphics.Path
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

    val upper = number < 30
    val ink = T.ink
    val line = T.line
    val soft = T.surfaceSoft
    val multi = (tooth?.statuses?.size ?: 0) > 1

    Column(
        modifier.clickable { onSelect(if (isSelected) null else number) },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Drawn, not a box. Each tooth is its own kind — an incisor is a blade, a
        // canine a point, a molar a square with two cusps — and the crown points
        // the way it does in the mouth: down on the upper arch, up on the lower.
        // That is what makes a row of sixteen readable at a glance as a jaw
        // rather than as a bar chart.
        androidx.compose.foundation.Canvas(
            Modifier.fillMaxWidth().aspectRatio(0.72f),
        ) {
            val path = toothPath(number, size.width, size.height, upper)
            drawPath(path, color = fill ?: soft)
            drawPath(
                path,
                color = when {
                    isSelected -> ink
                    fill != null -> Color.Black.copy(alpha = .18f)
                    else -> line
                },
                style = androidx.compose.ui.graphics.drawscope.Stroke(
                    width = if (isSelected) 2.2.dp.toPx() else 1.dp.toPx(),
                ),
            )
            // A tooth carrying more than one condition gets a dot, so the chart
            // does not quietly imply the colour is the whole story.
            if (multi) {
                drawCircle(
                    color = Color.White.copy(alpha = .9f),
                    radius = 2.4.dp.toPx(),
                    center = androidx.compose.ui.geometry.Offset(size.width / 2, size.height / 2),
                )
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

/**
 * A tooth's outline, by which tooth it is.
 *
 * Not anatomy — a chart is a diagram — but the four kinds are told apart the way
 * a dentist tells them apart at a glance: incisors are flat blades, canines come
 * to a point, premolars are rounded with one notch, molars are broad with two.
 * The crown is at the bottom for an upper tooth and at the top for a lower one,
 * with a root tapering away from it, so the two arches read as facing each other
 * across the midline the way the mouth does.
 *
 * The same shapes serve every screen that draws a tooth, so a molar on the
 * treatment sheet is the molar from the chart.
 */
internal fun toothPath(number: Int, w: Float, h: Float, upper: Boolean): androidx.compose.ui.graphics.Path {
    val position = number % 10                         // 1..8 from the midline
    val kind = when (position) {
        1, 2 -> 0                                      // incisor
        3 -> 1                                         // canine
        4, 5 -> 2                                      // premolar
        else -> 3                                      // molar
    }

    // Proportions in a unit box: crown height, crown half-width, root half-width.
    val crownH = when (kind) { 0 -> .40f; 1 -> .42f; 2 -> .44f; else -> .48f }
    val crownW = when (kind) { 0 -> .34f; 1 -> .36f; 2 -> .42f; else -> .46f }
    val rootW = when (kind) { 0 -> .16f; 1 -> .17f; 2 -> .20f; else -> .30f }
    val inset = 0.04f * w

    val path = androidx.compose.ui.graphics.Path()
    fun x(f: Float) = w / 2 + f * (w - 2 * inset)
    // Flip vertically for the lower arch so the crown is at the top.
    fun y(f: Float) = if (upper) inset + f * (h - 2 * inset) else h - inset - f * (h - 2 * inset)

    // Walk clockwise from the root tip (y = 0) round the crown (y = 1) and back.
    val rootTip = 0f
    val neck = 1f - crownH
    val edge = 1f

    path.moveTo(x(-rootW * .5f), y(rootTip))
    path.lineTo(x(rootW * .5f), y(rootTip))
    if (kind == 3) {
        // Two roots on a molar: a notch between them.
        path.lineTo(x(rootW), y(neck * .55f))
        path.lineTo(x(rootW * .35f), y(neck * .55f))
        path.lineTo(x(rootW * .2f), y(neck * .25f))
        path.lineTo(x(-rootW * .2f), y(neck * .25f))
        path.lineTo(x(-rootW * .35f), y(neck * .55f))
        path.lineTo(x(-rootW), y(neck * .55f))
        path.lineTo(x(-rootW * .5f), y(rootTip))
        path.close()
        path.moveTo(x(-rootW), y(neck * .55f))
    } else {
        path.lineTo(x(rootW), y(neck))
        path.lineTo(x(-rootW), y(neck))
        path.close()
        path.moveTo(x(-rootW), y(neck))
    }

    // The crown, from the neck out to the edge and back.
    path.moveTo(x(-crownW), y(neck))
    path.lineTo(x(crownW), y(neck))
    when (kind) {
        0 -> { // incisor: a flat edge
            path.lineTo(x(crownW * .9f), y(edge))
            path.lineTo(x(-crownW * .9f), y(edge))
        }
        1 -> { // canine: a point
            path.lineTo(x(crownW * .85f), y(neck + crownH * .55f))
            path.lineTo(x(0f), y(edge))
            path.lineTo(x(-crownW * .85f), y(neck + crownH * .55f))
        }
        2 -> { // premolar: two soft cusps with a dip
            path.lineTo(x(crownW * .95f), y(neck + crownH * .6f))
            path.lineTo(x(crownW * .5f), y(edge))
            path.lineTo(x(0f), y(neck + crownH * .8f))
            path.lineTo(x(-crownW * .5f), y(edge))
            path.lineTo(x(-crownW * .95f), y(neck + crownH * .6f))
        }
        else -> { // molar: broad, two cusps
            path.lineTo(x(crownW), y(neck + crownH * .7f))
            path.lineTo(x(crownW * .6f), y(edge))
            path.lineTo(x(crownW * .2f), y(neck + crownH * .82f))
            path.lineTo(x(-crownW * .2f), y(neck + crownH * .82f))
            path.lineTo(x(-crownW * .6f), y(edge))
            path.lineTo(x(-crownW), y(neck + crownH * .7f))
        }
    }
    path.close()
    return path
}
