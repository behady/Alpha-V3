package com.alphadental.clinic.data

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import com.alphadental.clinic.ai.PayrollClient
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The payroll sheet, drawn from figures the server computed.
 *
 * Nothing in this file works out what anyone earns. Every number arrives from
 * `/api/payroll`, which calls the same function the Attendance screen and the
 * weekly brief call, so all three agree by construction rather than by three
 * people keeping three copies of the same arithmetic in step.
 *
 * The server's qualifications are printed at the foot in full. A payroll total
 * that quietly leaves out commission, or counts an agreed day off as an
 * absence, is the kind of thing an employee finds before the manager does — so
 * the sheet says both, on the paper, every time.
 */
object PayrollPdf {

    private const val PAGE_W = 595 // A4 at 72dpi
    private const val PAGE_H = 842
    private const val MARGIN = 40f
    private const val CONTENT_W = PAGE_W - 2 * MARGIN

    /** Room kept at the foot of every page for the footer, on every page. */
    private const val CONTENT_BOTTOM = PAGE_H - MARGIN - 30f

    private val INK = Color.rgb(15, 23, 42)
    private val SLATE = Color.rgb(100, 116, 139)
    private val FAINT = Color.rgb(226, 232, 240)
    private val GREEN = Color.rgb(5, 150, 105)
    private val AMBER = Color.rgb(217, 119, 6)
    private val RED = Color.rgb(220, 38, 38)

    fun write(
        context: Context,
        payroll: PayrollClient.Payroll,
        clinicName: String,
        arabic: Boolean,
    ): File {
        val doc = PdfDocument()
        var pageNumber = 1
        var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
        var canvas = page.canvas
        var y = MARGIN

        val line = Paint().apply { color = FAINT; strokeWidth = 1f }

        fun newPage() {
            doc.finishPage(page)
            pageNumber += 1
            page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
            canvas = page.canvas
            y = MARGIN
            // A loose sheet from the middle of a payroll run has to say what it is.
            canvas.drawText(
                (if (arabic) "كشف الرواتب — تكملة" else "Payroll, continued") +
                    "  ·  ${prettyRange(payroll.from, payroll.to, arabic)}",
                MARGIN, y + 11, paint(9f, SLATE, bold = true),
            )
            y += 20
            canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            y += 8
            columnHeadings(canvas, y, arabic)
            y += 16
            canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            y += 4
        }

        fun ensure(space: Float) {
            if (y + space > CONTENT_BOTTOM) newPage()
        }

        // Header.
        canvas.drawText(
            if (arabic) "كشف الرواتب" else "Payroll",
            MARGIN, y + 16, paint(17f, INK, bold = true),
        )
        canvas.drawText(
            "$clinicName  ·  ${prettyRange(payroll.from, payroll.to, arabic)}  ·  " +
                (if (arabic) "أُنشئ " else "generated ") +
                SimpleDateFormat("d MMM yyyy HH:mm", Locale.US).format(Date()),
            MARGIN, y + 32, paint(10f, SLATE),
        )
        y += 48
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
        y += 18

        // The two figures that matter, and the one that is deliberately not in them.
        val boxW = (CONTENT_W - 10f) / 2
        listOf(
            Triple(
                if (arabic) "إجمالي الأجور المقدّرة" else "Estimated wages",
                "${payroll.labourCost.toInt()} EGP",
                GREEN,
            ),
            Triple(
                if (arabic) "وقت إضافي بانتظار الاعتماد" else "Overtime awaiting approval",
                "${payroll.overtimePendingCost.toInt()} EGP",
                if (payroll.overtimePendingCost > 0) AMBER else SLATE,
            ),
        ).forEachIndexed { i, (label, value, colour) ->
            val left = MARGIN + i * (boxW + 10f)
            canvas.drawRoundRect(
                left, y, left + boxW, y + 54f, 8f, 8f,
                Paint().apply { color = Color.rgb(248, 250, 252) },
            )
            canvas.drawText(label, left + 10, y + 20, paint(8.5f, SLATE, bold = true))
            canvas.drawText(value, left + 10, y + 42, paint(14f, colour, bold = true))
        }
        y += 70

        if (payroll.staff.isEmpty()) {
            canvas.drawText(
                if (arabic) "لا يوجد موظفون في هذه الفترة." else "No staff records for this period.",
                MARGIN, y + 14, paint(10f, SLATE),
            )
        } else {
            columnHeadings(canvas, y, arabic)
            y += 16
            canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            y += 4

            payroll.staff.forEach { person ->
                ensure(22f)
                val cell = paint(9.5f, INK)
                val dim = paint(9.5f, SLATE)

                canvas.drawText(ellipsize(person.name, cell, 150f), MARGIN, y + 12, cell)
                canvas.drawText(ellipsize(person.role, dim, 80f), MARGIN + 158, y + 12, dim)
                canvas.drawText(hoursLabel(person.minutesWorked), MARGIN + 246, y + 12, dim)
                canvas.drawText("${person.daysWorked}", MARGIN + 306, y + 12, dim)

                val overtime = if (person.overtimePendingMinutes > 0) {
                    hoursLabel(person.overtimeApprovedMinutes) + " (+" +
                        hoursLabel(person.overtimePendingMinutes) + "?)"
                } else {
                    hoursLabel(person.overtimeApprovedMinutes)
                }
                canvas.drawText(
                    overtime, MARGIN + 348, y + 12,
                    paint(9.5f, if (person.overtimePendingMinutes > 0) AMBER else SLATE),
                )

                // Somebody with no schedule has no derivable rate, so a bare 0 would
                // read as "earned nothing" rather than "cannot be worked out".
                val pay = if (person.hasSchedule) {
                    "${person.estimatedPay.toInt()}"
                } else {
                    if (arabic) "بدون جدول" else "no schedule"
                }
                val payPaint = paint(
                    if (person.hasSchedule) 10.5f else 8.5f,
                    if (person.hasSchedule) INK else RED,
                    bold = person.hasSchedule,
                )
                canvas.drawText(pay, PAGE_W - MARGIN - payPaint.measureText(pay), y + 12, payPaint)

                y += 17
                canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            }
        }

        // The qualifications, in full, on the last page.
        if (payroll.notes.isNotEmpty()) {
            ensure(30f)
            y += 12
            canvas.drawText(
                if (arabic) "ملاحظات" else "How to read this",
                MARGIN, y + 12, paint(10f, INK, bold = true),
            )
            y += 20
            val notePaint = paint(8.5f, SLATE)
            payroll.notes.forEach { note ->
                splitLines(note, CONTENT_W - 12f, notePaint).forEach { text ->
                    ensure(notePaint.textSize + 3)
                    canvas.drawText("·  $text", MARGIN, y + notePaint.textSize, notePaint)
                    y += notePaint.textSize + 3
                }
                y += 4
            }
        }

        doc.finishPage(page)

        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        val file = File(dir, "payroll-${payroll.from}-to-${payroll.to}.pdf")
        file.outputStream().use { doc.writeTo(it) }
        doc.close()
        return file
    }

    private fun columnHeadings(canvas: Canvas, y: Float, arabic: Boolean) {
        val head = paint(8f, SLATE, bold = true)
        canvas.drawText(if (arabic) "الموظف" else "STAFF", MARGIN, y + 10, head)
        canvas.drawText(if (arabic) "الدور" else "ROLE", MARGIN + 158, y + 10, head)
        canvas.drawText(if (arabic) "ساعات" else "HOURS", MARGIN + 246, y + 10, head)
        canvas.drawText(if (arabic) "أيام" else "DAYS", MARGIN + 306, y + 10, head)
        canvas.drawText(if (arabic) "إضافي" else "OVERTIME", MARGIN + 348, y + 10, head)
        val pay = if (arabic) "الأجر" else "PAY (EGP)"
        canvas.drawText(pay, PAGE_W - MARGIN - head.measureText(pay), y + 10, head)
    }

    /** "7h 30m" — minutes alone stop being readable somewhere around the third row. */
    private fun hoursLabel(minutes: Int): String {
        if (minutes <= 0) return "—"
        val h = minutes / 60
        val m = minutes % 60
        return if (m == 0) "${h}h" else "${h}h ${m}m"
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = size
        isFakeBoldText = bold
    }

    private fun ellipsize(text: String, paint: Paint, maxWidth: Float): String {
        if (text.isBlank()) return "—"
        if (paint.measureText(text) <= maxWidth) return text
        var cut = text
        while (cut.isNotEmpty() && paint.measureText("$cut…") > maxWidth) cut = cut.dropLast(1)
        return "$cut…"
    }

    private fun splitLines(text: String, maxWidth: Float, paint: Paint): List<String> {
        val lines = mutableListOf<String>()
        var remaining = text.trim()
        while (remaining.isNotEmpty()) {
            val fitted = paint.breakText(remaining, true, maxWidth, null)
            if (fitted <= 0) {
                lines += remaining
                break
            }
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

    private fun prettyRange(fromKey: String, toKey: String, arabic: Boolean): String {
        val locale = if (arabic) Locale("ar", "EG") else Locale.US
        val parser = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val printer = SimpleDateFormat("d MMM yyyy", locale)
        val from = runCatching { parser.parse(fromKey) }.getOrNull() ?: return "$fromKey → $toKey"
        val to = runCatching { parser.parse(toKey) }.getOrNull() ?: return "$fromKey → $toKey"
        return if (fromKey == toKey) printer.format(from) else "${printer.format(from)} → ${printer.format(to)}"
    }
}
