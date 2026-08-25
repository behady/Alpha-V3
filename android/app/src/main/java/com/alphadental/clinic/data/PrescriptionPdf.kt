package com.alphadental.clinic.data

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * A prescription as a printable A5 sheet, however many sheets that takes.
 *
 * Mirrors the website's printed script rather than inventing a second design —
 * clinic letterhead, the patient block, the Rx symbol, a numbered list of
 * medicines with their doses and instructions, and a signature line. A
 * prescription is a document a pharmacy reads and a patient keeps, so the two
 * surfaces must produce the same paper.
 *
 * It used to produce exactly one page and simply stop drawing when it ran out of
 * room, which silently dropped every medicine past roughly the seventh — with
 * nothing on the sheet to say anything was missing. A pharmacist cannot detect
 * that. The renderer now spills onto as many pages as the script needs, every
 * page carries the patient's name and "Page 1 of 2", and any page that is not
 * the last says so in words.
 */
object PrescriptionPdf {

    // A5 at 72dpi.
    private const val PAGE_W = 420
    private const val PAGE_H = 595
    private const val MARGIN = 34f

    /**
     * The lowest a medicine may reach. Room for the signature block and the
     * footer is reserved on every page, not only the last, because which page
     * turns out to be the last is not known until the medicines have run out.
     */
    private const val CONTENT_BOTTOM = PAGE_H - MARGIN - 60f

    private val INK = Color.rgb(15, 23, 42)
    private val SLATE = Color.rgb(100, 116, 139)
    private val FAINT = Color.rgb(226, 232, 240)
    private val GREEN = Color.rgb(5, 150, 105)

    /**
     * Writes the script to the app's shareable reports folder and returns it.
     * One file per prescription id, so printing twice refreshes rather than litters.
     */
    fun write(
        context: Context,
        clinic: ClinicInfo,
        patientName: String,
        patientPhone: String,
        prescription: Prescription,
        arabic: Boolean,
    ): File {
        // Drawn twice: the first pass only counts pages, so the second can print
        // "Page 1 of 2" rather than leaving a pharmacist to wonder whether a
        // second sheet exists. Both passes run the same code over the same data,
        // so the count cannot drift from the document — which a separately
        // written estimate eventually would.
        val counting = PdfDocument()
        val total = runCatching {
            render(counting, clinic, patientName, patientPhone, prescription, arabic, totalPages = 0)
        }.getOrDefault(1)
        runCatching { counting.close() }

        val doc = PdfDocument()
        render(doc, clinic, patientName, patientPhone, prescription, arabic, totalPages = total)

        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        val file = File(dir, "prescription-${prescription.id.ifBlank { "draft" }}.pdf")
        file.outputStream().use { doc.writeTo(it) }
        doc.close()
        return file
    }

    /**
     * Draws the whole script into [doc] and returns how many pages it took.
     *
     * [totalPages] is what the page footers should claim; the counting pass
     * passes 0, when the answer is not known yet and nothing is kept anyway.
     */
    private fun render(
        doc: PdfDocument,
        clinic: ClinicInfo,
        patientName: String,
        patientPhone: String,
        prescription: Prescription,
        arabic: Boolean,
        totalPages: Int,
    ): Int {
        var pageNumber = 1
        var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
        var canvas = page.canvas
        var y = MARGIN

        val line = Paint().apply { color = FAINT; strokeWidth = 1f }

        /** Leaves the current page, having said on it that the script continues. */
        fun newPage() {
            drawPageFoot(canvas, pageNumber, totalPages, arabic, continues = true)
            doc.finishPage(page)
            pageNumber += 1
            page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
            canvas = page.canvas
            y = MARGIN
            // A loose second sheet has to be matchable to its script and its
            // patient without the first sheet in hand.
            canvas.drawText(
                if (arabic) "تكملة الروشتة" else "Prescription, continued",
                MARGIN, y + 11, paint(9f, SLATE, bold = true),
            )
            val header = listOfNotNull(
                patientName.takeIf { it.isNotBlank() },
                prettyDate(prescription.date, arabic).takeIf { it.isNotBlank() },
            ).joinToString("  ·  ")
            if (header.isNotBlank()) {
                val headerPaint = paint(9f, SLATE)
                canvas.drawText(header, PAGE_W - MARGIN - headerPaint.measureText(header), y + 11, headerPaint)
            }
            y += 20
            canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            y += 10
        }

        /** Starts a new page when [space] would not fit above the reserved footer. */
        fun ensure(space: Float) {
            if (y + space > CONTENT_BOTTOM) newPage()
        }

        /** Draws already-split lines, taking a new page between any two of them. */
        fun drawLines(lines: List<String>, x: Float, linePaint: Paint) {
            lines.forEach { text ->
                ensure(linePaint.textSize + 3)
                canvas.drawText(text, x, y + linePaint.textSize, linePaint)
                y += linePaint.textSize + 3
            }
        }

        // 1. Letterhead.
        canvas.drawText(
            clinic.name.ifBlank { if (arabic) "عيادة أسنان" else "Dental Clinic" },
            MARGIN, y + 15, paint(15f, INK, bold = true),
        )
        val subtitle = clinic.rxHeader.ifBlank {
            prescription.doctor.takeIf { it.isNotBlank() }?.let { withDoctorTitle(it) }
                ?: clinic.doctorName.takeIf { it.isNotBlank() }?.let { withDoctorTitle(it) }
                ?: ""
        }
        if (subtitle.isNotBlank()) {
            canvas.drawText(subtitle, MARGIN, y + 29, paint(9.5f, SLATE))
        }
        // The date sits on the right of the header, as it does on the website's sheet.
        val dateLabel = prettyDate(prescription.date, arabic)
        val datePaint = paint(9.5f, SLATE)
        canvas.drawText(
            dateLabel,
            PAGE_W - MARGIN - datePaint.measureText(dateLabel),
            y + 15,
            datePaint,
        )
        y += 40
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = GREEN; strokeWidth = 2f })
        y += 18

        // 2. Patient block.
        val boxPaint = Paint().apply { color = Color.rgb(248, 250, 252) }
        canvas.drawRoundRect(MARGIN, y, PAGE_W - MARGIN, y + 46f, 6f, 6f, boxPaint)
        canvas.drawText(if (arabic) "المريض" else "PATIENT", MARGIN + 10, y + 15, paint(7.5f, SLATE, bold = true))
        canvas.drawText(patientName.ifBlank { "—" }, MARGIN + 10, y + 31, paint(11.5f, INK, bold = true))
        if (patientPhone.isNotBlank()) {
            val phonePaint = paint(9f, SLATE)
            canvas.drawText(
                patientPhone,
                PAGE_W - MARGIN - 10 - phonePaint.measureText(patientPhone),
                y + 31,
                phonePaint,
            )
        }
        y += 60

        if (prescription.diagnosis.isNotBlank()) {
            ensure(30f)
            canvas.drawText(if (arabic) "التشخيص" else "DIAGNOSIS", MARGIN, y, paint(7.5f, SLATE, bold = true))
            y += 14
            val body = paint(10f, INK)
            drawLines(splitLines(prescription.diagnosis, PAGE_W - 2 * MARGIN, body), MARGIN, body)
            y += 10
        }

        // 3. The Rx symbol and the medicines.
        ensure(44f)
        canvas.drawText("℞", MARGIN, y + 18, paint(24f, GREEN, bold = true))
        y += 30
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
        y += 6

        if (prescription.drugs.isEmpty()) {
            canvas.drawText(
                if (arabic) "لا توجد أدوية." else "No medicines listed.",
                MARGIN, y + 14, paint(10f, SLATE),
            )
            y += 24
        } else {
            prescription.drugs.forEachIndexed { index, drug ->
                // Keep the number, the name and the first line of instructions
                // together: a medicine split across the fold is a misread waiting
                // to happen.
                ensure(46f)
                canvas.drawText("${index + 1}.", MARGIN, y + 15, paint(11f, GREEN, bold = true))
                canvas.drawText(drug.name, MARGIN + 20, y + 15, paint(11.5f, INK, bold = true))
                y += 20
                val detail = listOfNotNull(
                    drug.dose.takeIf { it.isNotBlank() },
                    drug.note.takeIf { it.isNotBlank() },
                ).joinToString("  ·  ")
                if (detail.isNotBlank()) {
                    val body = paint(9.5f, SLATE)
                    y += 2
                    drawLines(splitLines(detail, PAGE_W - MARGIN - (MARGIN + 20), body), MARGIN + 20, body)
                    y += 4
                }
                canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
                y += 8
            }
        }

        // 4. Signature and footer, pinned to the bottom of the final sheet.
        val signY = PAGE_H - MARGIN - 46f
        canvas.drawLine(PAGE_W - MARGIN - 130, signY, PAGE_W - MARGIN, signY, line)
        val signLabel = if (arabic) "التوقيع" else "Signature"
        val signPaint = paint(8.5f, SLATE)
        canvas.drawText(
            signLabel,
            PAGE_W - MARGIN - signPaint.measureText(signLabel),
            signY + 12,
            signPaint,
        )

        val footer = listOfNotNull(
            clinic.address.takeIf { it.isNotBlank() },
            clinic.phone.takeIf { it.isNotBlank() },
        ).joinToString("   ·   ")
        if (footer.isNotBlank()) {
            canvas.drawText(footer, MARGIN, PAGE_H - MARGIN, paint(8f, SLATE))
        }
        drawPageFoot(canvas, pageNumber, totalPages, arabic, continues = false)

        doc.finishPage(page)
        return pageNumber
    }

    /**
     * "Page 1 of 2", and on any page that is not the last, the fact that it is
     * not. Set on the right so it never collides with the clinic address.
     */
    private fun drawPageFoot(
        canvas: Canvas,
        pageNumber: Int,
        totalPages: Int,
        arabic: Boolean,
        continues: Boolean,
    ) {
        // A one-page script says nothing: page numbers on a single sheet are
        // noise, and one sheet is overwhelmingly the common case.
        if (totalPages <= 1 && !continues) return

        val of = if (totalPages > 0) {
            if (arabic) "صفحة $pageNumber من $totalPages" else "Page $pageNumber of $totalPages"
        } else {
            if (arabic) "صفحة $pageNumber" else "Page $pageNumber"
        }
        val text = if (continues) {
            if (arabic) "$of — يتبع" else "$of — continued overleaf"
        } else {
            of
        }
        val footPaint = paint(8f, SLATE, bold = continues)
        canvas.drawText(text, PAGE_W - MARGIN - footPaint.measureText(text), PAGE_H - MARGIN, footPaint)
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = size
        isFakeBoldText = bold
    }

    /**
     * Breaks text into lines that fit [maxWidth], without drawing any of it.
     *
     * Split from the drawing so the caller can take a new page between two
     * lines. While measuring and drawing were one pass, a long instruction near
     * the foot of the sheet ran into the signature or off the paper entirely.
     */
    private fun splitLines(text: String, maxWidth: Float, paint: Paint): List<String> {
        val lines = mutableListOf<String>()
        var remaining = text.trim()
        while (remaining.isNotEmpty()) {
            val fitted = paint.breakText(remaining, true, maxWidth, null)
            if (fitted <= 0) {
                // Nothing fits — a single unbreakable glyph wider than the column.
                // Emit it anyway rather than looping forever or losing the text.
                lines += remaining
                break
            }
            // Break on a space where there is one, so words are not sliced in half.
            var cut = fitted
            if (fitted < remaining.length) {
                val space = remaining.lastIndexOf(' ', fitted)
                if (space > 0) cut = space
            }
            lines += remaining.substring(0, cut)
            remaining = remaining.substring(cut).trim()
        }
        return lines
    }

    private fun prettyDate(dateKey: String, arabic: Boolean): String {
        if (dateKey.isBlank()) return ""
        val locale = if (arabic) Locale("ar", "EG") else Locale.US
        val parsed = runCatching {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey)
        }.getOrNull() ?: return dateKey
        return SimpleDateFormat("d MMM yyyy", locale).format(parsed)
    }
}
