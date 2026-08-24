package com.alphadental.clinic.data

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The finance report as a real PDF, drawn on the phone.
 *
 * Same numbers as the Finance screen and the website — cash basis, computed from
 * the same rows — laid out as the website's PDF export lays them: the KPI row,
 * income against expenses, then the transactions. Built with Android's own
 * PdfDocument so there is no library to carry and Arabic text is shaped by the
 * system exactly as it is on screen.
 */
object ReportPdf {

    private const val PAGE_W = 595 // A4 at 72dpi
    private const val PAGE_H = 842
    private const val MARGIN = 40f
    private const val CONTENT_W = PAGE_W - 2 * MARGIN

    private val INK = Color.rgb(15, 23, 42)
    private val SLATE = Color.rgb(100, 116, 139)
    private val FAINT = Color.rgb(226, 232, 240)
    private val GREEN = Color.rgb(5, 150, 105)
    private val RED = Color.rgb(220, 38, 38)
    private val AMBER = Color.rgb(217, 119, 6)

    /**
     * Draws the report for [rows] and writes it into the app's shared-able
     * reports folder. Pure rendering: the caller loads the rows, so what lands
     * in the PDF is exactly what the screen it came from was showing.
     */
    fun writeFinanceReport(
        context: Context,
        rows: List<Repository.FinanceRow>,
        fromKey: String,
        toKey: String,
        clinicName: String,
        arabic: Boolean,
    ): File {
        val income = rows.filterNot { it.isExpense }
        val expenseRows = rows.filter { it.isExpense }
        val cashIn = income.sumOf { it.cash }
        val expenses = expenseRows.sumOf { it.cash }
        val commissions = income.sumOf { it.commission }
        val labFees = income.sumOf { it.labFee }
        val net = income.sumOf { it.clinicProfit ?: (it.cash - it.commission - it.labFee) } - expenses

        val doc = PdfDocument()
        var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, doc.pages.size + 1).create())
        var canvas = page.canvas
        var y = MARGIN

        fun newPage() {
            doc.finishPage(page)
            page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, doc.pages.size + 1).create())
            canvas = page.canvas
            y = MARGIN
        }

        fun ensure(space: Float) {
            if (y + space > PAGE_H - MARGIN) newPage()
        }

        val title = paint(17f, INK, bold = true)
        val sub = paint(10f, SLATE)
        val heading = paint(12f, INK, bold = true)
        val cell = paint(9.5f, INK)
        val cellDim = paint(9.5f, SLATE)
        val line = Paint().apply { color = FAINT; strokeWidth = 1f }

        // Header
        canvas.drawText(if (arabic) "التقرير المالي" else "Finance report", MARGIN, y + 16, title)
        canvas.drawText(
            "$clinicName  ·  ${prettyRange(fromKey, toKey, arabic)}  ·  " +
                (if (arabic) "أُنشئ " else "generated ") +
                SimpleDateFormat("d MMM yyyy HH:mm", Locale.US).format(Date()),
            MARGIN, y + 32, sub,
        )
        y += 48
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
        y += 18

        // KPI row: four boxes, like the website's export.
        val kpis = listOf(
            Triple(if (arabic) "المدخول" else "Cash in", "+${cashIn.toInt()}", GREEN),
            Triple(if (arabic) "المصروفات" else "Expenses", "-${expenses.toInt()}", RED),
            Triple(if (arabic) "العمولات" else "Commissions", "-${commissions.toInt()}", AMBER),
            Triple(if (arabic) "صافي الربح" else "Net profit", "${net.toInt()}", if (net >= 0) INK else RED),
        )
        val boxW = (CONTENT_W - 3 * 10f) / 4
        kpis.forEachIndexed { i, (label, value, color) ->
            val left = MARGIN + i * (boxW + 10f)
            val box = Paint().apply { this.color = Color.rgb(248, 250, 252); style = Paint.Style.FILL }
            canvas.drawRoundRect(left, y, left + boxW, y + 52f, 8f, 8f, box)
            canvas.drawText(label, left + 10, y + 20, paint(8.5f, SLATE, bold = true))
            canvas.drawText("$value EGP", left + 10, y + 40, paint(13f, color, bold = true))
        }
        y += 66
        if (labFees > 0) {
            canvas.drawText(
                (if (arabic) "رسوم المعمل ضمن الحساب: " else "Lab fees included in the net: ") + "${labFees.toInt()} EGP",
                MARGIN, y, cellDim,
            )
            y += 16
        }

        // Income vs expenses bars.
        val maxFlow = maxOf(cashIn, expenses, 1.0)
        fun bar(label: String, value: Double, color: Int) {
            canvas.drawText(label, MARGIN, y + 9, paint(9f, color, bold = true))
            canvas.drawText("${value.toInt()}", PAGE_W - MARGIN - 60, y + 9, paint(9f, color, bold = true))
            val track = Paint().apply { this.color = FAINT }
            canvas.drawRoundRect(MARGIN, y + 14, PAGE_W - MARGIN, y + 22, 4f, 4f, track)
            val fill = Paint().apply { this.color = color }
            val w = (CONTENT_W * (value / maxFlow)).toFloat().coerceAtLeast(4f)
            canvas.drawRoundRect(MARGIN, y + 14, MARGIN + w, y + 22, 4f, 4f, fill)
            y += 30
        }
        ensure(70f)
        bar(if (arabic) "الدخل" else "Income", cashIn, GREEN)
        bar(if (arabic) "المصروفات" else "Expenses", expenses, RED)
        y += 6

        // Transaction tables.
        fun table(titleText: String, list: List<Repository.FinanceRow>, positive: Boolean) {
            if (list.isEmpty()) return
            ensure(50f)
            y += 10
            canvas.drawText(titleText, MARGIN, y + 12, heading)
            y += 22
            canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            y += 4
            list.forEach { row ->
                ensure(20f)
                val date = row.date.takeLast(5) // "MM-dd"
                canvas.drawText(date, MARGIN, y + 12, cellDim)
                val desc = listOfNotNull(
                    row.description.ifBlank { row.category }.takeIf { it.isNotBlank() },
                    row.patientName.takeIf { it.isNotBlank() },
                    row.doctorName.takeIf { it.isNotBlank() }?.let { withDoctorTitle(it) },
                ).joinToString(" · ")
                canvas.drawText(ellipsize(desc, cell, CONTENT_W - 140), MARGIN + 44, y + 12, cell)
                val amount = (if (positive) "+" else "-") + row.cash.toInt()
                canvas.drawText(amount, PAGE_W - MARGIN - 60, y + 12, paint(9.5f, if (positive) GREEN else RED, bold = true))
                y += 17
                canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            }
            y += 6
        }

        table(if (arabic) "عمليات الدخل" else "Income transactions", income, positive = true)
        table(if (arabic) "المصروفات" else "Expense transactions", expenseRows, positive = false)

        // Commissions per doctor, when any were paid.
        val perDoctor = income.filter { it.commission > 0 }
            .groupBy { it.doctorName.ifBlank { "—" } }
            .mapValues { (_, g) -> g.sumOf { it.commission } }
            .toList()
            .sortedByDescending { it.second }
        if (perDoctor.isNotEmpty()) {
            ensure(50f)
            y += 10
            canvas.drawText(if (arabic) "عمولات الأطباء" else "Doctor commissions", MARGIN, y + 12, heading)
            y += 22
            perDoctor.forEach { (doctor, total) ->
                ensure(20f)
                canvas.drawText(withDoctorTitle(doctor), MARGIN, y + 12, cell)
                canvas.drawText("${total.toInt()}", PAGE_W - MARGIN - 60, y + 12, paint(9.5f, AMBER, bold = true))
                y += 17
                canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            }
        }

        doc.finishPage(page)

        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        // One file per period: asking twice refreshes the same report instead of littering.
        val file = File(dir, "finance-$fromKey-to-$toKey.pdf")
        file.outputStream().use { doc.writeTo(it) }
        doc.close()
        return file
    }

    /**
     * The appointment diary as a printable day sheet.
     *
     * The other half of what the assistant can draw. Grouped by day with a
     * heading per date, because the thing this is printed for — pinning by the
     * chair, handing to a receptionist, sending to a doctor who wants tomorrow
     * on paper — is read a day at a time. Cancellations stay on the sheet and
     * say so: a slot that was freed is information, and silently dropping it
     * makes the printed day disagree with the screen.
     */
    fun writeScheduleReport(
        context: Context,
        appointments: List<Appointment>,
        fromKey: String,
        toKey: String,
        clinicName: String,
        arabic: Boolean,
    ): File {
        val doc = PdfDocument()
        var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, doc.pages.size + 1).create())
        var canvas = page.canvas
        var y = MARGIN

        fun newPage() {
            doc.finishPage(page)
            page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, doc.pages.size + 1).create())
            canvas = page.canvas
            y = MARGIN
        }

        fun ensure(space: Float) {
            if (y + space > PAGE_H - MARGIN) newPage()
        }

        val title = paint(17f, INK, bold = true)
        val sub = paint(10f, SLATE)
        val heading = paint(12f, INK, bold = true)
        val cell = paint(9.5f, INK)
        val cellDim = paint(9.5f, SLATE)
        val line = Paint().apply { color = FAINT; strokeWidth = 1f }

        canvas.drawText(if (arabic) "جدول المواعيد" else "Appointment schedule", MARGIN, y + 16, title)
        canvas.drawText(
            "$clinicName  ·  ${prettyRange(fromKey, toKey, arabic)}  ·  " +
                (if (arabic) "أُنشئ " else "generated ") +
                SimpleDateFormat("d MMM yyyy HH:mm", Locale.US).format(Date()),
            MARGIN, y + 32, sub,
        )
        y += 48
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
        y += 14

        if (appointments.isEmpty()) {
            canvas.drawText(
                if (arabic) "لا توجد مواعيد في هذه الفترة." else "No appointments in this period.",
                MARGIN, y + 14, cellDim,
            )
        }

        // A count per day is what makes the sheet worth printing rather than
        // scrolling: "Tue — 6 booked" answers the question before the rows do.
        appointments.groupBy { it.date }.toSortedMap().forEach { (date, rows) ->
            ensure(58f)
            y += 10
            canvas.drawText(prettyDay(date, arabic), MARGIN, y + 12, heading)
            val count = if (arabic) "${rows.size} موعد" else "${rows.size} booked"
            val countPaint = paint(9.5f, SLATE)
            canvas.drawText(count, PAGE_W - MARGIN - countPaint.measureText(count), y + 12, countPaint)
            y += 20
            canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            y += 4

            rows.forEach { appointment ->
                ensure(20f)
                canvas.drawText(appointment.time.ifBlank { "—" }, MARGIN, y + 12, cellDim)

                val who = appointment.patientName.ifBlank { if (arabic) "بدون اسم" else "No name" }
                canvas.drawText(ellipsize(who, cell, 150f), MARGIN + 64, y + 12, cell)

                val detail = listOfNotNull(
                    appointment.doctor.takeIf { it.isNotBlank() }?.let { withDoctorTitle(it) },
                    appointment.treatment.takeIf { it.isNotBlank() },
                ).joinToString(" · ")
                canvas.drawText(ellipsize(detail, cellDim, CONTENT_W - 300), MARGIN + 220, y + 12, cellDim)

                val status = statusText(appointment.status, arabic)
                val statusPaint = paint(9f, statusColour(appointment.status), bold = true)
                canvas.drawText(status, PAGE_W - MARGIN - statusPaint.measureText(status), y + 12, statusPaint)

                y += 17
                canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, line)
            }
            y += 6
        }

        doc.finishPage(page)

        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        val file = File(dir, "schedule-$fromKey-to-$toKey.pdf")
        file.outputStream().use { doc.writeTo(it) }
        doc.close()
        return file
    }

    /** "Tue, 25 Aug" — the heading a printed day sheet is scanned by. */
    private fun prettyDay(dateKey: String, arabic: Boolean): String {
        val locale = if (arabic) Locale("ar", "EG") else Locale.US
        val parsed = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey) }.getOrNull()
            ?: return dateKey
        return SimpleDateFormat("EEEE, d MMM", locale).format(parsed)
    }

    /**
     * Status on paper. Printed sheets are often photocopied in black and white,
     * so the word carries the meaning and the colour only reinforces it.
     */
    private fun statusText(status: String?, arabic: Boolean): String =
        when (normalizeStatusKey(status)) {
            "Scheduled" -> if (arabic) "غير مؤكد" else "Unconfirmed"
            "Confirmed" -> if (arabic) "مؤكد" else "Confirmed"
            "Checked In" -> if (arabic) "حضر" else "Checked in"
            "In Chair" -> if (arabic) "بالكرسي" else "In chair"
            "Checking Out" -> if (arabic) "خروج" else "Checking out"
            "Completed" -> if (arabic) "تم" else "Done"
            "Cancelled" -> if (arabic) "ملغي" else "Cancelled"
            "No Show" -> if (arabic) "لم يحضر" else "No show"
            "Late" -> if (arabic) "متأخر" else "Late"
            "Delayed" -> if (arabic) "مؤجل" else "Delayed"
            else -> status.orEmpty()
        }

    private fun statusColour(status: String?): Int = when (normalizeStatusKey(status)) {
        "Cancelled", "No Show" -> RED
        "Completed", "Checked In", "In Chair", "Checking Out" -> GREEN
        "Scheduled", "Late", "Delayed" -> AMBER
        else -> SLATE
    }

    /** Same legacy aliases the screens use, so a printed row matches the app. */
    private fun normalizeStatusKey(status: String?): String = when (status) {
        null, "" -> "Scheduled"
        "Arrived" -> "Checked In"
        "Seated", "In Progress" -> "In Chair"
        "Pending" -> "Scheduled"
        else -> status
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = size
        isFakeBoldText = bold
    }

    private fun ellipsize(text: String, paint: Paint, maxWidth: Float): String {
        if (paint.measureText(text) <= maxWidth) return text
        var cut = text
        while (cut.isNotEmpty() && paint.measureText("$cut…") > maxWidth) cut = cut.dropLast(1)
        return "$cut…"
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
