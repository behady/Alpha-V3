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
import androidx.compose.ui.graphics.drawscope.clipPath
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
    /** What has been done to each tooth. Drawn as the website draws it: form, then mark. */
    treatments: Map<Int, List<com.alphadental.clinic.next.data.ToothTreatment>> = emptyMap(),
) {
    Surface(color = T.surface, modifier = Modifier.fillMaxWidth()) {
        Column {
            Rule()
            Column(Modifier.padding(horizontal = 12.dp, vertical = 16.dp)) {

                ArchLabel("Upper")
                Spacer(Modifier.height(8.dp))
                Arch(UPPER_RIGHT, UPPER_LEFT, teeth, selected, onSelect, treatments)

                Spacer(Modifier.height(14.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(T.line))
                Spacer(Modifier.height(14.dp))

                Arch(LOWER_RIGHT, LOWER_LEFT, teeth, selected, onSelect, treatments)
                Spacer(Modifier.height(8.dp))
                ArchLabel("Lower")

                Spacer(Modifier.height(16.dp))
                Legend(teeth, treatments)
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
        // Named, because the trailing-lambda slot is now the marks parameter.
        right.forEach { ToothCell(it, teeth[it], it in chosen, Modifier.weight(1f), onSelect = { n -> onToggle(n ?: it) }) }
        Box(Modifier.width(2.dp).height(46.dp).background(T.line))
        left.forEach { ToothCell(it, teeth[it], it in chosen, Modifier.weight(1f), onSelect = { n -> onToggle(n ?: it) }) }
    }
}

@Composable
private fun Arch(
    right: List<Int>,
    left: List<Int>,
    teeth: Map<Int, Tooth>,
    selected: Int?,
    onSelect: (Int?) -> Unit,
    treatments: Map<Int, List<com.alphadental.clinic.next.data.ToothTreatment>> = emptyMap(),
) {
    val marks = { n: Int -> com.alphadental.clinic.next.data.ToothTreatments.resolve(treatments[n]) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        right.forEach { ToothCell(it, teeth[it], selected == it, Modifier.weight(1f), onSelect, marks(it)) }
        // The midline, so a dentist can count outward from it without reading
        // every number.
        Box(Modifier.width(2.dp).height(46.dp).background(T.line))
        left.forEach { ToothCell(it, teeth[it], selected == it, Modifier.weight(1f), onSelect, marks(it)) }
    }
}

@Composable
private fun ToothCell(
    number: Int,
    tooth: Tooth?,
    isSelected: Boolean,
    modifier: Modifier,
    onSelect: (Int?) -> Unit,
    marks: com.alphadental.clinic.next.data.ToothMarks = com.alphadental.clinic.next.data.ToothMarks(),
) {
    val leading = tooth?.leading
    val diagnosisFill = leading?.let { colourOf(it) }
    /*
     * What the tooth looks like, in the website's order of precedence: a form treatment
     * (extraction, implant, crown, veneer) replaces the artwork and the diagnosis colour with
     * it — a crowned tooth is grey whatever was wrong underneath — while a mark is drawn ON the
     * tooth and leaves the diagnosis colour showing. Diagnosis and treatment are kept apart on
     * purpose: a dentist must be able to read "caries" and not mistake it for "we filled it".
     */
    val form = marks.form
    val mark = marks.mark
    val fill = when (form) {
        com.alphadental.clinic.next.data.TreatmentState.Extracted -> null
        null -> diagnosisFill
        else -> form.colour
    }
    val gone = form == com.alphadental.clinic.next.data.TreatmentState.Extracted
    val pending = marks.pending.isNotEmpty()

    val upper = number < 30
    val ink = T.ink
    val line = T.line
    val soft = T.surfaceSoft
    val multi = (tooth?.statuses?.size ?: 0) > 1
    // The photographs, when the app ships them. Looked up once per cell and cached app-wide.
    val context = androidx.compose.ui.platform.LocalContext.current
    val photo = { key: String -> ToothTextures.get(context, key) }

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
            val g = toothParts(number, size.width, size.height, upper)
            val path = g.whole
            val w = size.width
            val h = size.height
            val dashed = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.5.dp.toPx()))
            val T_Extracted = com.alphadental.clinic.next.data.TreatmentState.Extracted
            val T_Implant = com.alphadental.clinic.next.data.TreatmentState.Implant
            val T_Crowned = com.alphadental.clinic.next.data.TreatmentState.Crowned
            val T_Veneered = com.alphadental.clinic.next.data.TreatmentState.Veneered
            val T_RootCanal = com.alphadental.clinic.next.data.TreatmentState.RootCanal
            val T_Filled = com.alphadental.clinic.next.data.TreatmentState.Filled
            val T_Perio = com.alphadental.clinic.next.data.TreatmentState.Perio
            val T_Treated = com.alphadental.clinic.next.data.TreatmentState.Treated

            if (gone) {
                // An extracted tooth is a gap: a faint dashed outline where it was, and an X.
                drawPath(path, color = line, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx(), pathEffect = dashed))
                val c = T_Extracted.colour
                val sw = 1.8.dp.toPx()
                drawLine(c, androidx.compose.ui.geometry.Offset(w * .28f, h * .28f), androidx.compose.ui.geometry.Offset(w * .72f, h * .72f), sw)
                drawLine(c, androidx.compose.ui.geometry.Offset(w * .72f, h * .28f), androidx.compose.ui.geometry.Offset(w * .28f, h * .72f), sw)
            } else {
                /*
                 * Two regions, each painted by what was done to it, so the chart reads the way a
                 * mouth does. The ROOT: gutta-percha pink with its striations after a root canal,
                 * a titanium screw for an implant, otherwise the diagnosis colour. The CROWN:
                 * porcelain after a crown (with a metal margin when it was a PFM), composite
                 * ivory after a filling (amalgam grey when it was), a lighter face for a veneer,
                 * otherwise the diagnosis colour. Where nothing was done the region keeps the
                 * diagnosis colour, so "root-filled but still carious" stays visible.
                 */
                /*
                 * Drawn the way the charting textbooks and the big chart programs draw it, not
                 * the way the materials look in the hand (which was tried, and read wrong):
                 *
                 *   root canal  — a line through the canal of each treated root, in gutta-percha
                 *                 pink; the root itself is not painted (Dentrix, Open Dental:
                 *                 "root canal, not including pulp chamber").
                 *   crown       — caps the crown: an outline over the whole crown. Ceramic or
                 *                 zirconia is light; PFM is light with the metal shown as
                 *                 diagonal lines at the collar; a full metal crown is diagonal
                 *                 lines all over ("metal is dark, ceramic and porcelain light").
                 *   filling     — an outlined restoration on the crown: composite is outlined
                 *                 and left tooth-coloured, amalgam is outlined and filled solid.
                 *   implant     — the screw, in the root.
                 *   veneer      — covers the front of the crown.
                 *   planned     — red dashed, the near-universal "to be done" colour.
                 *
                 * A region nothing was done to keeps the diagnosis colour underneath.
                 */
                val lowerProc = (marks.formProcedure + " " + marks.markProcedure).lowercase()
                val molar = number % 10 >= 6
                val metalInk = Color(0xFF4B5563)
                val guttaPercha = Color(0xFFE26B7A)
                val guttaCore = Color(0xFFB24A58)
                val porcelain = Color(0xFFEEF2F7)
                val porcelainEdge = Color(0xFF94A3B8)
                val composite = Color(0xFFF5F0E4)
                val compositeEdge = Color(0xFFA69C82)
                val amalgam = Color(0xFF6B7280)

                // A diagonal hatch, clipped to whatever region is being marked as metal.
                fun androidx.compose.ui.graphics.drawscope.DrawScope.hatch(region: androidx.compose.ui.graphics.Path, top: Float, bottom: Float) {
                    clipPath(region) {
                        var x = -h
                        while (x < w + h) {
                            drawLine(metalInk, androidx.compose.ui.geometry.Offset(x, bottom), androidx.compose.ui.geometry.Offset(x + (bottom - top), top), 0.9.dp.toPx())
                            x += 2.6.dp.toPx()
                        }
                    }
                }

                val base = diagnosisFill ?: soft
                val crownTop = minOf(g.neckY, g.edgeY)
                val crownBottom = maxOf(g.neckY, g.edgeY)
                val crownH = crownBottom - crownTop

                // ---- the root: painted with its diagnosis, then the screw or the canal line
                if (form == T_Implant && photo("implant") != null) {
                    with(ToothTextures) { paintPhoto(g.root, photo("implant")!!) }
                } else if (form == T_Implant) {
                    drawPath(g.root, color = Color(0xFFD1D5DB))
                    clipPath(g.root) {
                        val rootTop = minOf(g.tipY, g.neckY)
                        val rootBottom = maxOf(g.tipY, g.neckY)
                        drawRect(
                            androidx.compose.ui.graphics.Brush.horizontalGradient(listOf(Color(0xFF6B7280), Color(0xFFE5E7EB), Color(0xFF6B7280)), startX = w * .32f, endX = w * .68f),
                            topLeft = androidx.compose.ui.geometry.Offset(0f, rootTop),
                            size = androidx.compose.ui.geometry.Size(w, rootBottom - rootTop),
                        )
                        var y = rootTop + 2.dp.toPx()
                        while (y < rootBottom - 1.dp.toPx()) {
                            drawLine(Color(0xFF374151).copy(alpha = .6f), androidx.compose.ui.geometry.Offset(w * .32f, y), androidx.compose.ui.geometry.Offset(w * .68f, y), 0.9.dp.toPx())
                            y += 2.6.dp.toPx()
                        }
                    }
                } else {
                    drawPath(g.root, color = base)
                    if (mark == T_RootCanal) {
                        // The obturated canal: from the apex up to the pulp-chamber floor, one
                        // line per root — two on a molar — in gutta-percha with a darker core.
                        val apex = g.tipY
                        val floor = if (upper) g.neckY - 1.dp.toPx() else g.neckY + 1.dp.toPx()
                        val xs = if (molar) listOf(w * .36f, w * .64f) else listOf(w / 2)
                        val gp = photo("gutta_percha")
                        if (gp != null) {
                            // The photograph, through a band the width of each canal, cropped
                            // by the root itself.
                            val half = 1.8.dp.toPx()
                            xs.forEach { cx ->
                                val band = ToothTextures.rect(cx - half, minOf(apex, floor), cx + half, maxOf(apex, floor))
                                val region = androidx.compose.ui.graphics.Path.combine(androidx.compose.ui.graphics.PathOperation.Intersect, g.root, band)
                                with(ToothTextures) { paintPhoto(region, gp) }
                            }
                        } else clipPath(g.root) {
                            xs.forEach { cx ->
                                drawLine(guttaPercha, androidx.compose.ui.geometry.Offset(cx, apex), androidx.compose.ui.geometry.Offset(cx, floor), 2.6.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                                drawLine(guttaCore, androidx.compose.ui.geometry.Offset(cx, apex), androidx.compose.ui.geometry.Offset(cx, floor), 0.9.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                            }
                        }
                    }
                }

                // ---- the crown
                when {
                    form == T_Crowned || form == T_Implant -> {
                        val fullMetal = listOf("gold", "full metal", "metal crown", "stainless", "ssc").any { it in lowerProc }
                        val pfm = !fullMetal && listOf("pfm", "porcelain fused", "metal").any { it in lowerProc }
                        val crownPhoto = photo(if (fullMetal) "crown_metal" else if (pfm) "crown_pfm" else "crown_zirconia")
                        if (crownPhoto != null) {
                            // The real crown, filling the whole crown, cropped by its outline.
                            with(ToothTextures) { paintPhoto(g.crown, crownPhoto) }
                        } else {
                        // The cap: a light crown with a firm outline, which is what "capped" reads as.
                        drawPath(g.crown, color = if (fullMetal) Color(0xFFD1D5DB) else porcelain)
                        if (fullMetal) hatch(g.crown, crownTop, crownBottom)
                        }
                        if (pfm && crownPhoto == null) {
                            // The metal collar: the cervical third, hatched.
                            val collarTop = if (upper) g.neckY else g.neckY - crownH * .3f
                            val collarBottom = if (upper) g.neckY + crownH * .3f else g.neckY
                            clipPath(g.crown) {
                                drawRect(Color(0xFFD1D5DB), topLeft = androidx.compose.ui.geometry.Offset(0f, collarTop), size = androidx.compose.ui.geometry.Size(w, collarBottom - collarTop))
                            }
                            val collar = androidx.compose.ui.graphics.Path().apply { addRect(androidx.compose.ui.geometry.Rect(0f, collarTop, w, collarBottom)) }
                            val region = androidx.compose.ui.graphics.Path.combine(androidx.compose.ui.graphics.PathOperation.Intersect, g.crown, collar)
                            hatch(region, collarTop, collarBottom)
                        }
                        drawPath(g.crown, color = if (fullMetal) metalInk else porcelainEdge, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.6.dp.toPx()))
                    }
                    form == T_Veneered -> {
                        drawPath(g.crown, color = base)
                        val vp = photo("veneer")
                        val face = androidx.compose.ui.graphics.Path.combine(
                            androidx.compose.ui.graphics.PathOperation.Intersect, g.crown,
                            ToothTextures.rect(w * .26f, crownTop, w * .74f, crownBottom),
                        )
                        if (vp != null) with(ToothTextures) { paintPhoto(face, vp) } else clipPath(g.crown) {
                            drawRect(porcelain, topLeft = androidx.compose.ui.geometry.Offset(w * .26f, crownTop), size = androidx.compose.ui.geometry.Size(w * .48f, crownH))
                        }
                        drawPath(g.crown, color = porcelainEdge, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx()))
                    }
                    mark == T_Filled -> {
                        drawPath(g.crown, color = base)
                        // The restoration: an outlined patch on the biting third of the crown.
                        // Composite stays tooth-coloured inside the outline; amalgam is filled.
                        val isAmalgam = "amalgam" in lowerProc || "silver" in lowerProc
                        val top = if (upper) crownBottom - crownH * .62f else crownTop + crownH * .12f
                        val patch = androidx.compose.ui.graphics.Path().apply {
                            addRoundRect(androidx.compose.ui.geometry.RoundRect(androidx.compose.ui.geometry.Rect(w * .28f, top, w * .72f, top + crownH * .5f), androidx.compose.ui.geometry.CornerRadius(2.dp.toPx())))
                        }
                        val region = androidx.compose.ui.graphics.Path.combine(androidx.compose.ui.graphics.PathOperation.Intersect, g.crown, patch)
                        val fp = photo(if (isAmalgam) "amalgam" else "composite")
                        if (fp != null) with(ToothTextures) { paintPhoto(region, fp) }
                        else drawPath(region, color = if (isAmalgam) amalgam else composite)
                        drawPath(region, color = if (isAmalgam) metalInk else compositeEdge, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.1.dp.toPx()))
                    }
                    else -> drawPath(g.crown, color = base)
                }

                // A post, when the procedure says so: fills the pulp chamber under the crown.
                if ("post" in lowerProc && mark == T_RootCanal) {
                    val pTop = if (upper) g.neckY - 3.dp.toPx() else g.neckY - crownH * .25f
                    val pBottom = if (upper) g.neckY + crownH * .25f else g.neckY + 3.dp.toPx()
                    drawRect(metalInk, topLeft = androidx.compose.ui.geometry.Offset(w * .44f, pTop), size = androidx.compose.ui.geometry.Size(w * .12f, pBottom - pTop))
                }

                // ---- the outline, over both regions
                drawPath(
                    path,
                    color = when {
                        isSelected -> ink
                        form != null || mark != null || diagnosisFill != null -> Color.Black.copy(alpha = .22f)
                        else -> line
                    },
                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                        width = if (isSelected) 2.2.dp.toPx() else 1.dp.toPx(),
                    ),
                )

                // ---- marks that are not a region
                when (mark) {
                    T_Perio -> drawLine(T_Perio.colour, androidx.compose.ui.geometry.Offset(w * .15f, g.neckY), androidx.compose.ui.geometry.Offset(w * .85f, g.neckY), 2.2.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                    T_Treated -> drawCircle(T_Treated.colour, radius = 2.6.dp.toPx(), center = androidx.compose.ui.geometry.Offset(w / 2, (crownTop + crownBottom) / 2))
                    else -> Unit
                }

                // Work planned and not yet done: a dashed amber outline, never drawn as done.
                if (pending) {
                    drawPath(path, color = Color(0xFFDC2626), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.4.dp.toPx(), pathEffect = dashed))
                }

                // A tooth carrying more than one condition gets a dot, so the chart
                // does not quietly imply the colour is the whole story.
                if (multi && mark == null && form == null) {
                    drawCircle(
                        color = Color.White.copy(alpha = .9f),
                        radius = 2.4.dp.toPx(),
                        center = androidx.compose.ui.geometry.Offset(size.width / 2, size.height / 2),
                    )
                }
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
private fun Legend(
    teeth: Map<Int, Tooth>,
    treatments: Map<Int, List<com.alphadental.clinic.next.data.ToothTreatment>> = emptyMap(),
) {
    // Diagnoses first, then the work: each entry only if it is on this mouth.
    val done = treatments.values.flatten().filter { it.done }.map { it.state }.distinct().sortedByDescending { it.precedence }
    val anyPending = treatments.values.flatten().any { !it.done }
    val present = (teeth.values
        .mapNotNull { it.leading }
        .map { categoryNameOf(it) to colourOf(it) }
        .distinctBy { it.first }
        .sortedBy { it.first }) +
        done.map { it.label to it.colour } +
        (if (anyPending) listOf("Planned work" to Color(0xFFDC2626)) else emptyList())

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
/** A tooth as two regions — the crown and the root — plus where the neck between them sits. */
internal class ToothGeometry(
    val root: androidx.compose.ui.graphics.Path,
    val crown: androidx.compose.ui.graphics.Path,
    /** The y of the neck line, in pixels. */
    val neckY: Float,
    /** The y of the root tip and of the biting edge, in pixels. */
    val tipY: Float,
    val edgeY: Float,
) {
    val whole: androidx.compose.ui.graphics.Path
        get() = androidx.compose.ui.graphics.Path().apply { addPath(root); addPath(crown) }
}

/**
 * A tooth's outline, by which tooth it is, in two pieces.
 *
 * Not anatomy — a chart is a diagram — but the four kinds are told apart the way a dentist tells
 * them apart at a glance: incisors are flat blades, canines come to a point, premolars are rounded
 * with one notch, molars are broad with two. The crown is at the bottom for an upper tooth and at
 * the top for a lower one, with a root tapering away from it, so the two arches read as facing
 * each other across the midline the way the mouth does.
 *
 * Crown and root are separate closed paths on purpose: a root canal is painted into the root
 * and a filling into the crown, and a dentist reads which is which from where the colour is.
 */
internal fun toothParts(number: Int, w: Float, h: Float, upper: Boolean): ToothGeometry {
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

    fun x(f: Float) = w / 2 + f * (w - 2 * inset)
    // Flip vertically for the lower arch so the crown is at the top.
    fun y(f: Float) = if (upper) inset + f * (h - 2 * inset) else h - inset - f * (h - 2 * inset)

    val rootTip = 0f
    val neck = 1f - crownH
    val edge = 1f

    val root = androidx.compose.ui.graphics.Path()
    root.moveTo(x(-rootW * .5f), y(rootTip))
    root.lineTo(x(rootW * .5f), y(rootTip))
    if (kind == 3) {
        // Two roots on a molar: a notch between them.
        root.lineTo(x(rootW), y(neck * .55f))
        root.lineTo(x(rootW), y(neck))
        root.lineTo(x(-rootW), y(neck))
        root.lineTo(x(-rootW), y(neck * .55f))
        root.close()
        // The notch, cut as a second contour so the union still reads as two roots.
        root.moveTo(x(rootW * .35f), y(neck * .55f))
        root.lineTo(x(rootW * .2f), y(neck * .25f))
        root.lineTo(x(-rootW * .2f), y(neck * .25f))
        root.lineTo(x(-rootW * .35f), y(neck * .55f))
        root.close()
        root.fillType = androidx.compose.ui.graphics.PathFillType.EvenOdd
    } else {
        root.lineTo(x(rootW), y(neck))
        root.lineTo(x(-rootW), y(neck))
        root.close()
    }

    // The crown, from the neck out to the edge and back.
    val crown = androidx.compose.ui.graphics.Path()
    crown.moveTo(x(-crownW), y(neck))
    crown.lineTo(x(crownW), y(neck))
    when (kind) {
        0 -> { // incisor: a flat edge
            crown.lineTo(x(crownW * .9f), y(edge))
            crown.lineTo(x(-crownW * .9f), y(edge))
        }
        1 -> { // canine: a point
            crown.lineTo(x(crownW * .85f), y(neck + crownH * .55f))
            crown.lineTo(x(0f), y(edge))
            crown.lineTo(x(-crownW * .85f), y(neck + crownH * .55f))
        }
        2 -> { // premolar: two soft cusps with a dip
            crown.lineTo(x(crownW * .95f), y(neck + crownH * .6f))
            crown.lineTo(x(crownW * .5f), y(edge))
            crown.lineTo(x(0f), y(neck + crownH * .8f))
            crown.lineTo(x(-crownW * .5f), y(edge))
            crown.lineTo(x(-crownW * .95f), y(neck + crownH * .6f))
        }
        else -> { // molar: broad, two cusps
            crown.lineTo(x(crownW), y(neck + crownH * .7f))
            crown.lineTo(x(crownW * .6f), y(edge))
            crown.lineTo(x(crownW * .2f), y(neck + crownH * .82f))
            crown.lineTo(x(-crownW * .2f), y(neck + crownH * .82f))
            crown.lineTo(x(-crownW * .6f), y(edge))
            crown.lineTo(x(-crownW), y(neck + crownH * .7f))
        }
    }
    crown.close()

    return ToothGeometry(root = root, crown = crown, neckY = y(neck), tipY = y(rootTip), edgeY = y(edge))
}

/** The whole outline, for anything that only needs the silhouette. */
internal fun toothPath(number: Int, w: Float, h: Float, upper: Boolean): androidx.compose.ui.graphics.Path =
    toothParts(number, w, h, upper).whole
