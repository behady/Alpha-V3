package com.alphadental.clinic.next.design

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import com.alphadental.clinic.R

/**
 * The brand's two faces, as STATIC weights.
 *
 * This is deliberately not the variable fonts the old app shipped. Those were one
 * file per family with a weight axis, which is tidier — but `montserrat.ttf`'s
 * default instance is **Thin (wght 100)**, so any time the axis failed to apply,
 * Compose synthesised bold from a hairline and the type came out looking like
 * nothing in the design. Six static files remove the entire failure mode: the
 * weight you ask for is the weight in the file.
 *
 * Montserrat states, Open Sans explains. That division is the whole type system:
 * headings, screen titles and every figure that matters are Montserrat; anything
 * read as a sentence or a label is Open Sans.
 */
object Face {
    /** Montserrat — headings, titles, and every stated figure. */
    val Display = FontFamily(
        Font(R.font.montserrat_semibold, FontWeight.SemiBold),
        Font(R.font.montserrat_bold, FontWeight.Bold),
        Font(R.font.montserrat_extrabold, FontWeight.ExtraBold),
    )

    /** Open Sans — prose, captions, and form labels. */
    val Body = FontFamily(
        Font(R.font.open_sans_regular, FontWeight.Normal),
        Font(R.font.open_sans_semibold, FontWeight.SemiBold),
        Font(R.font.open_sans_bold, FontWeight.Bold),
    )
}

/**
 * The type scale, as a handful of named roles.
 *
 * Screens call these rather than setting sizes themselves. That is the single
 * biggest reason the old app looked uneven: nineteen screens each picked their
 * own 15sp, 15.5sp, 16sp for the same job, and no amount of recolouring fixes a
 * hierarchy that was never agreed.
 */
object Type {
    /** The slab's headline figure. The loudest thing in the app. */
    val figure = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 46.sp, letterSpacing = (-1.4).sp,
        fontFeatureSettings = "tnum",
    )

    /** A screen's name, on the slab. */
    val title = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 27.sp, letterSpacing = (-0.6).sp,
    )

    /** The name on a card — a patient, a case. */
    val heading = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 17.sp, letterSpacing = (-0.3).sp,
    )

    /** The label on a row or a tool. */
    val label = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 14.sp, letterSpacing = (-0.1).sp,
    )

    /** A figure in the slab's strip, or beside a row. */
    val stat = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 20.sp, letterSpacing = (-0.4).sp,
        fontFeatureSettings = "tnum",
    )

    /** A name in a list. */
    val rowName = TextStyle(
        fontFamily = Face.Body, fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
    )

    /** The quiet line under a name. */
    val caption = TextStyle(
        fontFamily = Face.Body, fontWeight = FontWeight.Normal,
        fontSize = 12.5.sp,
    )

    /** Running text. */
    val body = TextStyle(
        fontFamily = Face.Body, fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
    )

    /**
     * The small uppercase label above a title or a section.
     *
     * The tracking is doing real work: at this size and weight, letters set solid
     * read as a smudge rather than as a word. It is tighter than it looks it
     * should be, because four of these have to fit across a phone in the slab's
     * strip — at wider tracking the fourth ellipsises into "NO SH…".
     */
    val eyebrow = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 10.sp, letterSpacing = 1.1.sp,
    )

    /** A status chip. */
    val chip = TextStyle(
        fontFamily = Face.Display, fontWeight = FontWeight.Bold,
        fontSize = 9.5.sp, letterSpacing = 0.7.sp,
    )
}

/**
 * Text, in one of the scale's roles.
 *
 * A thin wrapper, but it makes the common case — a role and a colour — shorter
 * than setting five properties, which is what stops a screen inventing its own.
 */
@Composable
fun Txt(
    text: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = 1,
    uppercase: Boolean = false,
    align: androidx.compose.ui.text.style.TextAlign? = null,
) {
    Text(
        textAlign = align,
        text = if (uppercase) text.uppercase() else text,
        modifier = modifier,
        style = LocalTextStyle.current.merge(style),
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}
