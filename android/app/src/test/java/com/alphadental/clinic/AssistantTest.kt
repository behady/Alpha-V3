package com.alphadental.clinic

import com.alphadental.clinic.ai.interpretYesNo
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The words that approve a staged action by voice.
 *
 * Worth testing line by line because a wrong true here executes something — a deletion, a payment,
 * a message to a patient's phone — on the strength of a mumble. The rule under test: only a short,
 * clear yes approves; anything else must NOT.
 */
class AssistantTest {

    @Test
    fun `clear yeses approve`() {
        listOf("yes", "Yes.", "yeah", "okay", "confirm", "do it", "go ahead", "sure",
            "نعم", "ايوه", "أكد", "تمام", "موافق", "ماشي").forEach {
            assertEquals("expected '$it' to approve", true, interpretYesNo(it))
        }
    }

    @Test
    fun `clear nos refuse`() {
        listOf("no", "No!", "cancel", "stop", "reject",
            "لا", "لأ", "إلغاء", "بلاش").forEach {
            assertEquals("expected '$it' to refuse", false, interpretYesNo(it))
        }
    }

    @Test
    fun `no beats yes when both are said`() {
        // "no, don't do it" contains "do it". Approving that would be catastrophic.
        assertEquals(false, interpretYesNo("no don't do it"))
        assertEquals(false, interpretYesNo("لا بلاش تمام"))
    }

    @Test
    fun `a sentence that merely contains a yes is not an approval`() {
        // Long utterances are conversation, not consent — they fall through to a fresh question.
        assertEquals(null, interpretYesNo("yes I saw him yesterday about the crown payment"))
        assertEquals(null, interpretYesNo("نعم هو جه امبارح وقعد يسأل عن السعر"))
    }

    @Test
    fun `anything unclear does nothing`() {
        assertEquals(null, interpretYesNo(""))
        assertEquals(null, interpretYesNo("what?"))
        assertEquals(null, interpretYesNo("who is booked tomorrow"))
        // "maybe" is neither, and must never approve.
        assertEquals(null, interpretYesNo("maybe"))
    }

    @Test
    fun `punctuation and case do not change the answer`() {
        assertEquals(true, interpretYesNo("  YES!!  "))
        assertEquals(false, interpretYesNo("لا."))
    }
}
