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
 * A prescription as a printable A5 sheet.
 *
 * Mirrors the website's printed script rather than inventing a second design —
 * clinic letterhead, the patient block, the Rx symbol, a numbered list of
 * medicines with their doses and instructions, and a signature line. A
 * prescription is a document a pharmacy reads and a patient keeps, so the two
 * surfaces must produce the same paper.
 *
 * Drawn with Android's own PdfDocument, which shapes Arabic through the system
 * text engine — the same route the finance report takes.
 */
object PrescriptionPdf {

    // A5 at 72dpi.
    private const val PAGE_W = 420
    private const val PAGE_H = 595
    private const val MARGIN = 34f

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
        val doc = PdfDocument()
        val page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, 1).create())
        val canvas = page.canvas
        var y = MARGIN

        val line = Paint().apply { color = FAINT; strokeWidth = 1f }

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
            canvas.drawText(if (arabic) "التشخيص" else "DIAGNOSIS", MARGIN, y, paint(7.5f, SLATE, bold = true))
            y += 14
            y = wrap(canvas, prescription.diagnosis, MARGIN, y, PAGE_W - 2 * MARGIN, paint(10f, INK))
            y += 10
        }

        // 3. The Rx symbol and the medicines.
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
                // Stop before running off the sheet rather than drawing into the margin.
                if (y > PAGE_H - 120) return@forEachIndexed
                canvas.drawText("${index + 1}.", MARGIN, y + 15, paint(11f, GREEN, bold = true))
                canvas.drawText(drug.name, MARGIN + 20, y + 15, paint(11.5f, INK, bold = true))
                y += 20
                val detail = listOfNotNull(
                    drug.dose.takeIf { it.isNotBlank() },
                    drug.note.takeIf { it.isNotBlank() },
                ).joinToString("  ·  ")
                if (detail.isNotBlank()) {
                    y = wrap(canvas, detail, MARGIN + 20, y + 2, PAGE_W - MARGIN - (MARGIN + 20), paint(9.5f, SLATE))
                    y += 4
                }
                canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
                y += 8
            }
        }

        // 4. Signature and footer, pinned to the bottom of the sheet.
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

        doc.finishPage(page)

        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        val file = File(dir, "prescription-${prescription.id.ifBlank { "draft" }}.pdf")
        file.outputStream().use { doc.writeTo(it) }
        doc.close()
        return file
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = size
        isFakeBoldText = bold
    }

    /** Draws text broken across lines, returning the y it finished at. */
    private fun wrap(canvas: Canvas, text: String, x: Float, startY: Float, maxWidth: Float, paint: Paint): Float {
        var y = startY
        var remaining = text.trim()
        while (remaining.isNotEmpty()) {
            val fitted = paint.breakText(remaining, true, maxWidth, null)
            if (fitted <= 0) break
            // Break on a space where there is one, so words are not sliced in half.
            var cut = fitted
            if (fitted < remaining.length) {
                val space = remaining.lastIndexOf(' ', fitted)
                if (space > 0) cut = space
            }
            canvas.drawText(remaining.substring(0, cut), x, y + paint.textSize, paint)
            y += paint.textSize + 3
            remaining = remaining.substring(cut).trim()
        }
        return y
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
