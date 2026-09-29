package com.alphadental.clinic.data

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.alphadental.clinic.Firebase
import com.alphadental.clinic.next.data.Money
import kotlinx.coroutines.tasks.await
import java.io.File
import java.text.NumberFormat
import java.util.Locale

/**
 * The patient's receipt, drawn on the phone.
 *
 * The website prints a numbered receipt for every payment and a statement of the whole account,
 * both laid out from `settings/receipt` — which lines print, the note under the title, the footer.
 * The number itself is minted by the ledger route when the money is saved (`receiptNumber` on the
 * payment row), so the phone never invents one: a receipt with no number is a payment recorded
 * before numbers existed, and says so.
 *
 * Same order and the same words as `src/lib/receiptRender.ts`, so the paper a patient is handed
 * at the desk and the PDF sent from a phone read as one document. A5, like the prescription.
 */
object ReceiptPdf {

    /** The parts of the website's receipt settings a phone honours. */
    data class Settings(
        val arabic: Boolean = true,
        val headerNote: String = "",
        val footerText: String = "",
        val showClinicPhone: Boolean = true,
        val showClinicAddress: Boolean = true,
        val showPatientPhone: Boolean = true,
        val showPaymentMethod: Boolean = true,
        val showCollectedBy: Boolean = true,
        val showChargeProgress: Boolean = true,
        val showAccountBalance: Boolean = true,
        val showPaymentsHistory: Boolean = true,
        val showSignatureLine: Boolean = false,
        val showFooter: Boolean = true,
        val showDiscounts: Boolean = true,
    )

    /** `settings/receipt`, read the way the website reads it; every absent flag is the website's default. */
    suspend fun loadSettings(clinicId: String): Settings = runCatching {
        val d = Firebase.db().collection("clinics").document(clinicId).collection("settings").document("receipt").get().await().data.orEmpty()
        val show = (d["show"] as? Map<*, *>).orEmpty()
        fun flag(key: String, default: Boolean) = (show[key] as? Boolean) ?: default
        Settings(
            arabic = (d["language"]?.toString() ?: "ar") != "en",
            headerNote = d["headerNote"]?.toString().orEmpty().take(200),
            footerText = d["footerText"]?.toString().orEmpty().take(300),
            showClinicPhone = flag("clinicPhone", true),
            showClinicAddress = flag("clinicAddress", true),
            showPatientPhone = flag("patientPhone", true),
            showPaymentMethod = flag("paymentMethod", true),
            showCollectedBy = flag("collectedBy", true),
            showChargeProgress = flag("chargeProgress", true),
            showAccountBalance = flag("accountBalance", true),
            showPaymentsHistory = flag("paymentsHistory", true),
            showSignatureLine = flag("signatureLine", false),
            showFooter = flag("footer", true),
            showDiscounts = flag("discounts", true),
        )
    }.getOrDefault(Settings())

    // A5 at 72dpi, as the prescription.
    private const val PAGE_W = 420
    private const val PAGE_H = 595
    private const val MARGIN = 34f
    private const val CONTENT_BOTTOM = PAGE_H - MARGIN - 40f

    private val INK = Color.rgb(17, 24, 39)
    private val SLATE = Color.rgb(100, 116, 139)
    private val FAINT = Color.rgb(226, 232, 240)
    private val WASH = Color.rgb(248, 250, 252)
    private val RED = Color.rgb(197, 31, 31)

    private val numbers: NumberFormat = NumberFormat.getIntegerInstance(Locale.US)
    private fun money(v: Double) = numbers.format(Math.round(v)) + " EGP"

    /**
     * One numbered receipt for one payment, with the charge it settles and where the account
     * stands after it — what the patient is handed.
     */
    fun writePayment(
        context: Context,
        clinic: ClinicInfo,
        settings: Settings,
        patientName: String,
        patientPhone: String,
        payment: Money,
        /** The charge this payment was recorded against, if any. */
        charge: Money?,
        /** Paid against that charge BEFORE this payment. */
        paidBefore: Double,
        /** The whole account after this payment: positive owes, negative in credit. */
        accountBalance: Double,
    ): File {
        val ar = settings.arabic
        val doc = PdfDocument()
        val page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, 1).create())
        val c = page.canvas
        var y = MARGIN

        y = letterhead(c, clinic, settings, y, if (ar) "إيصال استلام نقدية" else "Payment receipt")

        // Number and date, on one line under the rule.
        val number = payment.receiptNumber.ifBlank { if (ar) "بدون رقم — دفعة مسجّلة قبل الترقيم" else "No number — recorded before numbering" }
        row(c, y, if (ar) "رقم الإيصال" else "Receipt no.", number, bold = payment.receiptNumber.isNotBlank()); y += 16
        row(c, y, if (ar) "التاريخ" else "Date", prettyDate(payment.date, ar)); y += 22

        // The patient.
        y = box(c, y, if (ar) "اسم المريض" else "PATIENT", patientName.ifBlank { "—" }, if (settings.showPatientPhone) patientPhone else "")

        // The big line: how much was received, and for what.
        c.drawRoundRect(MARGIN, y, PAGE_W - MARGIN, y + 58f, 6f, 6f, Paint().apply { color = WASH })
        c.drawText(if (ar) "المبلغ المستلم" else "RECEIVED", MARGIN + 10, y + 15, paint(7.5f, SLATE, bold = true))
        val forWhat = charge?.description?.ifBlank { null } ?: payment.description.ifBlank { if (ar) "دفعة على الحساب" else "Payment on account" }
        val forLines = splitLines((if (ar) "مقابل: " else "For: ") + forWhat, PAGE_W - 2 * MARGIN - 130, paint(9.5f, INK, bold = true))
        forLines.take(2).forEachIndexed { i, l -> c.drawText(l, MARGIN + 10, y + 33 + i * 12, paint(9.5f, INK, bold = true)) }
        if (charge != null && charge.amount - paidBefore - payment.amount > 0.005) {
            c.drawText(if (ar) "دفعة جزئية" else "Partial payment", MARGIN + 10, y + 52, paint(8.5f, SLATE))
        }
        val big = paint(20f, INK, bold = true)
        val bigText = money(payment.amount)
        c.drawText(bigText, PAGE_W - MARGIN - 10 - big.measureText(bigText), y + 38, big)
        y += 72

        // The detail lines, each only when the clinic wants it — the website's flags.
        if (settings.showPaymentMethod) { row(c, y, if (ar) "طريقة الدفع" else "Method", payment.method.ifBlank { if (ar) "نقدي" else "Cash" }, bold = true); y += 16 }
        if (settings.showCollectedBy && payment.by.isNotBlank()) { row(c, y, if (ar) "استلمها" else "Collected by", payment.by, bold = true); y += 16 }
        if (charge != null && settings.showChargeProgress) {
            val struck = settings.showDiscounts && charge.discount > 0 && charge.listPrice > charge.amount
            row(c, y, if (ar) "قيمة العلاج" else "Treatment cost", (if (struck) "(${money(charge.listPrice)}) " else "") + money(charge.amount), bold = true); y += 16
            if (paidBefore > 0.005) { row(c, y, if (ar) "مدفوع سابقاً" else "Paid before", money(paidBefore)); y += 16 }
            val remaining = charge.amount - paidBefore - payment.amount
            row(c, y, if (ar) "المتبقي على العلاج" else "Remaining on treatment", if (remaining > 0.005) money(remaining) else if (ar) "مسدد بالكامل" else "Paid in full", bold = true); y += 16
        }
        if (settings.showAccountBalance) {
            y += 6
            c.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = INK; strokeWidth = 1.5f }); y += 4
            val due = accountBalance > 0.005
            val credit = accountBalance < -0.005
            row(
                c, y + 2,
                if (credit) (if (ar) "رصيد لصالح المريض" else "Credit") else if (ar) "رصيد الحساب بعد الدفعة" else "Account balance after this payment",
                if (due) money(accountBalance) else if (credit) money(-accountBalance) else if (ar) "مسدد بالكامل" else "Paid in full",
                bold = true, size = 11f, colour = if (due) RED else INK,
            )
            y += 24
        }

        foot(c, settings, ar)
        doc.finishPage(page)
        return save(context, doc, "receipt-${payment.receiptNumber.ifBlank { payment.id }}.pdf")
    }

    /** The whole account: every charge, every payment, and where it stands. */
    fun writeStatement(
        context: Context,
        clinic: ClinicInfo,
        settings: Settings,
        patientName: String,
        patientPhone: String,
        lines: List<Money>,
    ): File {
        val ar = settings.arabic
        val charges = lines.filter { it.isCharge }.sortedBy { it.date }
        val payments = lines.filter { it.isPayment }.sortedBy { it.date }
        val totalTreatment = charges.sumOf { it.amount }
        val totalDiscount = charges.sumOf { it.discount }
        val totalPaid = payments.sumOf { it.amount }
        val balance = totalTreatment - totalPaid

        val doc = PdfDocument()
        var pageNumber = 1
        var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
        var c = page.canvas
        var y = MARGIN
        y = letterhead(c, clinic, settings, y, if (ar) "كشف حساب" else "Account statement")
        row(c, y, if (ar) "التاريخ" else "Date", prettyDate(java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(java.util.Date()), ar)); y += 22
        y = box(c, y, if (ar) "اسم المريض" else "PATIENT", patientName.ifBlank { "—" }, if (settings.showPatientPhone) patientPhone else "")

        fun ensure(space: Float) {
            if (y + space > CONTENT_BOTTOM) {
                c.drawText(if (ar) "صفحة $pageNumber — يتبع" else "Page $pageNumber — continued", MARGIN, PAGE_H - MARGIN + 10, paint(8f, SLATE))
                doc.finishPage(page)
                pageNumber += 1
                page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
                c = page.canvas
                y = MARGIN
                c.drawText("$patientName · ${if (ar) "تكملة كشف الحساب" else "Statement, continued"}", MARGIN, y + 11, paint(9f, SLATE, bold = true))
                y += 24
            }
        }

        fun table(title: String, heads: List<String>, rows: List<List<String>>, widths: List<Float>) {
            ensure(40f)
            c.drawText(title, MARGIN, y + 10, paint(8f, SLATE, bold = true)); y += 18
            val x = FloatArray(heads.size); var acc = MARGIN
            heads.indices.forEach { i -> x[i] = acc; acc += widths[i] }
            heads.forEachIndexed { i, h -> drawCell(c, h, x[i], widths[i], y + 10, paint(7.5f, SLATE, bold = true), end = i > 0) }
            y += 14
            c.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = FAINT }); y += 4
            if (rows.isEmpty()) { c.drawText("—", MARGIN, y + 11, paint(9f, SLATE)); y += 16 }
            rows.forEach { r ->
                ensure(16f)
                r.forEachIndexed { i, cell -> drawCell(c, cell, x[i], widths[i], y + 11, paint(8.5f, INK, bold = i == r.lastIndex), end = i > 0) }
                y += 15
                c.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = FAINT }); y += 2
            }
            y += 8
        }

        val w = PAGE_W - 2 * MARGIN
        table(
            if (ar) "العلاجات" else "TREATMENTS",
            listOf(if (ar) "التاريخ" else "Date", if (ar) "الإجراء" else "Procedure", if (ar) "الخصم" else "Discount", if (ar) "الإجمالي" else "Total"),
            charges.map { listOf(prettyDate(it.date, ar), it.description.ifBlank { if (ar) "علاج" else "Treatment" }, if (it.discount > 0) money(it.discount) else "—", money(it.amount)) },
            listOf(w * 0.18f, w * 0.47f, w * 0.15f, w * 0.20f),
        )
        if (settings.showPaymentsHistory) table(
            if (ar) "المدفوعات" else "PAYMENTS",
            listOf(if (ar) "التاريخ" else "Date", if (ar) "البيان" else "Description", if (ar) "الطريقة" else "Method", if (ar) "المدفوع" else "Paid"),
            payments.map { listOf(prettyDate(it.date, ar), listOf(it.description.ifBlank { if (ar) "دفعة" else "Payment" }, it.receiptNumber).filter { s -> s.isNotBlank() }.joinToString(" · "), if (settings.showPaymentMethod) it.method.ifBlank { "—" } else "", money(it.amount)) },
            listOf(w * 0.18f, w * 0.47f, w * 0.15f, w * 0.20f),
        )

        ensure(80f)
        row(c, y, if (ar) "إجمالي العلاج" else "Total treatment", money(totalTreatment)); y += 16
        if (settings.showDiscounts && totalDiscount > 0) { row(c, y, if (ar) "إجمالي الخصومات" else "Total discounts", money(totalDiscount)); y += 16 }
        row(c, y, if (ar) "إجمالي المدفوع" else "Total paid", money(totalPaid), bold = true); y += 18
        c.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = INK; strokeWidth = 1.5f }); y += 6
        val due = balance > 0.005
        row(c, y, if (balance < -0.005) (if (ar) "رصيد لصالح المريض" else "Credit") else if (ar) "الرصيد المستحق" else "Balance due", if (due) money(balance) else if (balance < -0.005) money(-balance) else if (ar) "مسدد بالكامل" else "Paid in full", bold = true, size = 11f, colour = if (due) RED else INK)
        y += 24

        foot(c, settings, ar)
        doc.finishPage(page)
        return save(context, doc, "statement-${patientName.replace(Regex("[^A-Za-z0-9\\u0600-\\u06FF]+"), "_").ifBlank { "patient" }}.pdf")
    }

    // ------------------------------------------------------------------------------ pieces

    private fun letterhead(c: android.graphics.Canvas, clinic: ClinicInfo, s: Settings, top: Float, title: String): Float {
        var y = top
        c.drawText(clinic.name.ifBlank { if (s.arabic) "عيادة أسنان" else "Dental Clinic" }, MARGIN, y + 15, paint(15f, INK, bold = true))
        val sub = listOfNotNull(
            clinic.phone.takeIf { it.isNotBlank() && s.showClinicPhone },
            clinic.address.takeIf { it.isNotBlank() && s.showClinicAddress },
        ).joinToString("  ·  ")
        if (sub.isNotBlank()) c.drawText(sub, MARGIN, y + 29, paint(8.5f, SLATE))
        val titlePaint = paint(11f, INK, bold = true)
        c.drawText(title, PAGE_W - MARGIN - titlePaint.measureText(title), y + 15, titlePaint)
        if (s.headerNote.isNotBlank()) {
            val notePaint = paint(8.5f, SLATE)
            c.drawText(s.headerNote, PAGE_W - MARGIN - notePaint.measureText(s.headerNote), y + 29, notePaint)
        }
        y += 40
        c.drawLine(MARGIN, y, PAGE_W - MARGIN, y, Paint().apply { color = INK; strokeWidth = 2f })
        return y + 18
    }

    private fun box(c: android.graphics.Canvas, top: Float, label: String, name: String, phone: String): Float {
        c.drawRoundRect(MARGIN, top, PAGE_W - MARGIN, top + 46f, 6f, 6f, Paint().apply { color = WASH })
        c.drawText(label, MARGIN + 10, top + 15, paint(7.5f, SLATE, bold = true))
        c.drawText(name, MARGIN + 10, top + 31, paint(11.5f, INK, bold = true))
        if (phone.isNotBlank()) {
            val p = paint(9f, SLATE)
            c.drawText(phone, PAGE_W - MARGIN - 10 - p.measureText(phone), top + 31, p)
        }
        return top + 60
    }

    private fun row(c: android.graphics.Canvas, y: Float, label: String, value: String, bold: Boolean = false, size: Float = 9.5f, colour: Int = INK) {
        c.drawText(label, MARGIN, y + 10, paint(size, SLATE))
        val p = paint(size, colour, bold = bold)
        c.drawText(value, PAGE_W - MARGIN - p.measureText(value), y + 10, p)
    }

    private fun drawCell(c: android.graphics.Canvas, text: String, x: Float, width: Float, baseline: Float, p: Paint, end: Boolean) {
        var t = text
        while (t.length > 1 && p.measureText(t) > width - 6) t = t.dropLast(2) + "…"
        c.drawText(t, if (end) x + width - 4 - p.measureText(t) else x, baseline, p)
    }

    private fun foot(c: android.graphics.Canvas, s: Settings, ar: Boolean) {
        var y = PAGE_H - MARGIN - 22f
        if (s.showSignatureLine) {
            c.drawLine(PAGE_W - MARGIN - 120, y - 14, PAGE_W - MARGIN, y - 14, Paint().apply { color = SLATE })
            val sig = if (ar) "التوقيع" else "Signature"
            val p = paint(8f, SLATE)
            c.drawText(sig, PAGE_W - MARGIN - 60 - p.measureText(sig) / 2, y - 2, p)
            y -= 4
        }
        if (s.showFooter) {
            val text = s.footerText.ifBlank { if (ar) "وثيقة مُنشأة آلياً من نظام العيادة · لا تتطلب توقيع" else "Generated by the clinic system · no signature required" }
            val p = paint(7.5f, SLATE)
            c.drawLine(MARGIN, y + 6, PAGE_W - MARGIN, y + 6, Paint().apply { color = FAINT })
            c.drawText(text, (PAGE_W - p.measureText(text)) / 2, y + 20, p)
        }
    }

    private fun save(context: Context, doc: PdfDocument, name: String): File {
        val dir = File(context.cacheDir, "reports").apply { mkdirs() }
        val file = File(dir, name)
        file.outputStream().use { doc.writeTo(it) }
        doc.close()
        return file
    }

    private fun paint(size: Float, color: Int, bold: Boolean = false) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = size
        typeface = if (bold) Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) else Typeface.SANS_SERIF
    }

    private fun splitLines(text: String, maxWidth: Float, p: Paint): List<String> {
        val out = mutableListOf<String>()
        var line = ""
        text.split(" ").forEach { word ->
            val next = if (line.isEmpty()) word else "$line $word"
            if (p.measureText(next) > maxWidth && line.isNotEmpty()) { out += line; line = word } else line = next
        }
        if (line.isNotEmpty()) out += line
        return out
    }

    private fun prettyDate(key: String, ar: Boolean): String {
        val parts = key.take(10).split("-")
        if (parts.size < 3) return key
        val months = if (ar) listOf("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر")
        else listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
        val m = parts[1].toIntOrNull() ?: return key
        return "${parts[2].toIntOrNull() ?: parts[2]} ${months.getOrNull(m - 1) ?: parts[1]} ${parts[0]}"
    }
}
