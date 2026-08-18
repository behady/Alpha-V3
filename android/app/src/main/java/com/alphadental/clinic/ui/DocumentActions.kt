package com.alphadental.clinic.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import androidx.core.content.FileProvider
import com.alphadental.clinic.BuildConfig
import java.io.File

/**
 * What can be done with a generated PDF once it exists: print it, hand it to
 * another app, or open it.
 *
 * All three go through the same FileProvider grant the reports folder already
 * uses, so a document is only ever readable by the app the user picked.
 */
object DocumentActions {

    private fun uriFor(context: Context, file: File) =
        FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".files", file)

    /**
     * Send the file to Android's print dialog — any Wi-Fi or Bluetooth printer
     * the phone knows about, or "Save as PDF".
     */
    fun print(context: Context, file: File, jobName: String) {
        runCatching {
            val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
            manager.print(jobName, FilePrintAdapter(file, jobName), PrintAttributes.Builder().build())
        }
    }

    /** The share sheet, with WhatsApp among the options. */
    fun share(context: Context, file: File, subject: String) {
        runCatching {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uriFor(context, file))
                putExtra(Intent.EXTRA_SUBJECT, subject)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(
                Intent.createChooser(send, subject).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    /**
     * Straight to WhatsApp with the PDF attached, for the staff member to pick
     * the chat and press send themselves.
     *
     * Falls back to the ordinary share sheet when WhatsApp is not installed —
     * better than a button that silently does nothing.
     */
    fun shareToWhatsapp(context: Context, file: File, subject: String) {
        val uri = runCatching { uriFor(context, file) }.getOrNull() ?: return
        val direct = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, subject)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            setPackage("com.whatsapp")
        }
        val ok = runCatching { context.startActivity(direct); true }.getOrDefault(false)
        if (!ok) {
            // WhatsApp Business, then anything at all.
            val business = Intent(direct).apply { setPackage("com.whatsapp.w4b") }
            val okBusiness = runCatching { context.startActivity(business); true }.getOrDefault(false)
            if (!okBusiness) share(context, file, subject)
        }
    }

    fun open(context: Context, file: File, title: String) {
        runCatching {
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uriFor(context, file), "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(view, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/**
 * Hands an already-written PDF to the print framework.
 *
 * The document exists on disk before printing starts, so this adapter only has
 * to copy bytes — no re-rendering, and what prints is byte-for-byte what was
 * sent on WhatsApp.
 */
private class FilePrintAdapter(private val file: File, private val name: String) : PrintDocumentAdapter() {

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes?,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }
        callback.onLayoutFinished(
            PrintDocumentInfo.Builder(name)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build(),
            true,
        )
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback,
    ) {
        runCatching {
            file.inputStream().use { input ->
                java.io.FileOutputStream(destination.fileDescriptor).use { output ->
                    input.copyTo(output)
                }
            }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        }.onFailure { callback.onWriteFailed(it.message) }
    }
}
