package com.alphadental.clinic.next

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize

/**
 * Real photographs, cut to the shape of the tooth.
 *
 * The owner wanted the chart to show the actual materials — gutta-percha in a treated root, a
 * real crown filling the whole crown — not a drawing of them. The chart does that here: the
 * tooth's crown or root outline is used as a mask, and a photograph is drawn through it, scaled
 * to cover the region. The outline is the placeholder; the photo is what shows.
 *
 * The photographs are files under `assets/teeth/`, named for what they are, and every one of
 * them is optional. A missing file means the chart falls back to the drawn convention for that
 * treatment, so a clinic with no photographs still gets a correct chart. Nothing is downloaded
 * and nothing is fetched at runtime — the pictures ship inside the app.
 *
 * Expected names (jpg or png), square or nearly square, a few hundred pixels across:
 *
 *   gutta_percha    the obturated root — pink/orange gutta-percha
 *   crown_zirconia  a zirconia / all-ceramic crown
 *   crown_pfm       a porcelain-fused-to-metal crown
 *   crown_metal     a full metal or gold crown
 *   composite       a cured composite surface
 *   amalgam         an amalgam surface
 *   implant         a titanium implant fixture
 *   veneer          a porcelain veneer face
 */
object ToothTextures {

    private val cache = mutableMapOf<String, ImageBitmap?>()

    /** The photograph for a key, or null when no file ships for it. Cached after the first read. */
    fun get(context: Context, key: String): ImageBitmap? = synchronized(cache) {
        cache.getOrPut(key) {
            val assets = context.applicationContext.assets
            val name = listOf("teeth/$key.jpg", "teeth/$key.png", "teeth/$key.webp").firstOrNull { path ->
                runCatching { assets.open(path).close(); true }.getOrDefault(false)
            } ?: return@getOrPut null
            runCatching {
                assets.open(name).use { stream ->
                    // Sampled down: a chart cell is fifty pixels wide, and a four-megapixel
                    // photograph decoded at full size for each of thirty-two teeth is how an app
                    // runs out of memory drawing a mouth.
                    val options = BitmapFactory.Options().apply { inSampleSize = 2 }
                    BitmapFactory.decodeStream(stream, null, options)?.asImageBitmap()
                }
            }.getOrNull()
        }
    }

    /**
     * Draw a photograph through a region.
     *
     * Scaled to COVER the region's bounds, centred, so the picture fills the crown or the root
     * edge to edge and the outline crops it — the way a photograph sits behind a cut-out.
     */
    fun DrawScope.paintPhoto(region: Path, photo: ImageBitmap, alpha: Float = 1f) {
        val bounds = region.getBounds()
        if (bounds.width <= 0f || bounds.height <= 0f) return
        // Cover, then a little more: the crops still carry a sliver of their own background at
        // the edges, and a chart cell is too small to hide one.
        val scale = maxOf(bounds.width / photo.width, bounds.height / photo.height) * 1.25f
        val dw = (photo.width * scale).toInt().coerceAtLeast(1)
        val dh = (photo.height * scale).toInt().coerceAtLeast(1)
        val dx = (bounds.left + (bounds.width - dw) / 2f).toInt()
        val dy = (bounds.top + (bounds.height - dh) / 2f).toInt()
        clipPath(region) {
            drawImage(
                image = photo,
                srcOffset = IntOffset.Zero,
                srcSize = IntSize(photo.width, photo.height),
                dstOffset = IntOffset(dx, dy),
                dstSize = IntSize(dw, dh),
                alpha = alpha,
            )
        }
    }

    /** A rectangle as a region, for the parts of a tooth that are not a whole crown or root. */
    fun rect(left: Float, top: Float, right: Float, bottom: Float): Path =
        Path().apply { addRect(androidx.compose.ui.geometry.Rect(left, top, right, bottom)) }

    @Suppress("unused")
    private fun unused(o: Offset, s: Size) = Unit
}
