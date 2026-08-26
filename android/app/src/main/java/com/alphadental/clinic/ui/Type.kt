package com.alphadental.clinic.ui

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.alphadental.clinic.R

/**
 * The two typefaces the brand kit names, and nothing else.
 *
 * Montserrat is the primary face and Open Sans the secondary, so the app stops
 * running on whatever sans the phone happens to ship — which was Roboto on most
 * of them and something else entirely on Samsung, meaning no two clinics saw the
 * same product.
 *
 * There used to be a third face: figures were set in the system serif, on the
 * argument that a number in a serif reads as a stated figure rather than as form
 * data. That argument still holds, but a brand with two faces does not get a
 * third — so the distinction is now carried by Montserrat's weight and width
 * against Open Sans, which is the contrast the kit was designed around.
 *
 * Both files are variable fonts with a weight axis, so one file per family
 * covers every weight the app asks for. [FontVariation] needs API 26, which is
 * this app's minimum.
 */
object AlphaType {

    /** Montserrat: headings, screen titles, and every figure that matters. */
    val Display = FontFamily(
        weighted(R.font.montserrat, FontWeight.Normal, 400),
        weighted(R.font.montserrat, FontWeight.Medium, 500),
        weighted(R.font.montserrat, FontWeight.SemiBold, 600),
        weighted(R.font.montserrat, FontWeight.Bold, 700),
        weighted(R.font.montserrat, FontWeight.ExtraBold, 800),
    )

    /** Open Sans: everything that is read as prose or as a label. */
    val Body = FontFamily(
        weighted(R.font.open_sans, FontWeight.Normal, 400),
        weighted(R.font.open_sans, FontWeight.Medium, 500),
        weighted(R.font.open_sans, FontWeight.SemiBold, 600),
        weighted(R.font.open_sans, FontWeight.Bold, 700),
    )

    /**
     * One weight of a variable font.
     *
     * Without the variation setting Compose would load the file at its default
     * instance for every weight and then fake the rest by smearing the glyphs,
     * which is exactly the muddy look a real typeface is bought to avoid.
     */
    @OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
    private fun weighted(resId: Int, weight: FontWeight, axis: Int) = Font(
        resId = resId,
        weight = weight,
        variationSettings = FontVariation.Settings(FontVariation.weight(axis)),
    )
}
