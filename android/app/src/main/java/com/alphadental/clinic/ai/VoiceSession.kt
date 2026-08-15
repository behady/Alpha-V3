package com.alphadental.clinic.ai

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * The mouth and ears of the assistant, running entirely on the phone.
 *
 * Recognition and speech both use Android's own engines, which cost nothing per use — the only
 * paid part of a voice turn is the text sent to the server. That decision is what makes a
 * hands-free assistant affordable for a clinic at all: streaming audio to a cloud voice API would
 * bill every second of an eight-hour reception day.
 *
 * The conversation is a loop with four states:
 *
 *   LISTENING → (speech heard) → THINKING → (reply arrives) → SPEAKING → back to LISTENING
 *
 * The loop closes itself — that is the whole meaning of "hands-free". It opens only on a tap, and
 * it stops closing after two silences in a row: a phone that re-arms its microphone forever in a
 * pocket is a battery complaint and, in a clinic, a privacy one.
 *
 * Listening and speaking never overlap. The recogniser would hear the phone's own voice and the
 * assistant would begin answering itself; tapping the mic while it speaks is the interrupt.
 */
class VoiceSession(
    private val context: Context,
    private val onState: (VoiceState) -> Unit,
    private val onPartial: (String) -> Unit,
    private val onHeard: (String) -> Unit,
    private val onUnavailable: (String) -> Unit,
) {
    enum class VoiceState { IDLE, LISTENING, THINKING, SPEAKING }

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var handsFree = false
    private var silences = 0
    private var arabic = false

    fun start(arabicNow: Boolean) {
        arabic = arabicNow
        handsFree = true
        silences = 0
        listen()
    }

    fun stop() {
        handsFree = false
        recognizer?.cancel()
        tts?.stop()
        onState(VoiceState.IDLE)
    }

    /** The reply is on its way; keep the mic off while we wait. */
    fun thinking() {
        onState(VoiceState.THINKING)
    }

    /**
     * Read a reply aloud, then — in hands-free mode — open the mic for the next thing.
     *
     * Symbols the model uses for structure are stripped rather than pronounced: a bullet list
     * read as "asterisk asterisk" is the fastest way to make an assistant sound broken.
     */
    fun speak(text: String) {
        val engine = tts
        if (engine == null || !ttsReady) {
            initTts { speak(text) }
            return
        }

        val speakable = text
            .replace(Regex("[*_#`>|]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (speakable.isEmpty()) {
            if (handsFree) listen() else onState(VoiceState.IDLE)
            return
        }

        onState(VoiceState.SPEAKING)
        engine.language = if (arabic) Locale("ar") else Locale.US
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onError(utteranceId: String?) {
                main.post { if (handsFree) listen() else onState(VoiceState.IDLE) }
            }
            override fun onDone(utteranceId: String?) {
                main.post { if (handsFree) listen() else onState(VoiceState.IDLE) }
            }
        })
        engine.speak(speakable, TextToSpeech.QUEUE_FLUSH, null, "ai-reply")
    }

    fun destroy() {
        handsFree = false
        recognizer?.destroy()
        recognizer = null
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    private fun listen() {
        main.post {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                onUnavailable(
                    if (arabic) "التعرف على الصوت غير متاح على هذا الهاتف."
                    else "Speech recognition is not available on this phone."
                )
                onState(VoiceState.IDLE)
                return@post
            }

            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(listener)
                }
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                // Egyptian Arabic, not generic — the recogniser's Egyptian model hears clinic
                // talk ("حشو", "تقويم") far better than Modern Standard's does.
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (arabic) "ar-EG" else "en-US")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            }

            onPartial("")
            onState(VoiceState.LISTENING)
            recognizer?.startListening(intent)
        }
    }

    private val listener = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()
            if (text.isNotBlank()) onPartial(text)
        }

        override fun onResults(results: Bundle?) {
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()
                .trim()

            if (text.isBlank()) {
                handleSilence()
                return
            }
            silences = 0
            onPartial("")
            onHeard(text)
        }

        override fun onError(error: Int) {
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> handleSilence()

                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                    onUnavailable(
                        if (arabic) "التطبيق يحتاج إذن الميكروفون."
                        else "The app needs microphone permission."
                    )
                    stop()
                }

                // Transient engine states — busy, network hiccup inside the recogniser. One
                // retry keeps the loop alive; more would spin against a broken engine.
                else -> if (handsFree && silences < MAX_SILENCES) {
                    silences++
                    listen()
                } else {
                    stop()
                }
            }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun handleSilence() {
        silences++
        if (handsFree && silences < MAX_SILENCES) {
            listen()
        } else {
            // Quietly close the loop rather than listening at a room forever.
            stop()
        }
    }

    private fun initTts(then: () -> Unit) {
        if (tts != null) return
        tts = TextToSpeech(context) { status ->
            main.post {
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true
                    then()
                } else {
                    onUnavailable(
                        if (arabic) "قراءة الردود صوتياً غير متاحة على هذا الهاتف."
                        else "Spoken replies are not available on this phone."
                    )
                    if (handsFree) listen() else onState(VoiceState.IDLE)
                }
            }
        }
    }

    private companion object {
        const val MAX_SILENCES = 2
    }
}
