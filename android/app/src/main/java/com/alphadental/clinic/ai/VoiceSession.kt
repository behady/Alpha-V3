package com.alphadental.clinic.ai

import android.content.ComponentName
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
 * Recognition and speech both use engines already on the device, which cost nothing per use — the
 * only paid part of a voice turn is the text sent to the server. That decision is what makes a
 * hands-free assistant affordable for a clinic at all.
 *
 * Neither engine is taken on trust. On Samsung phones the system default for both jobs is often
 * Samsung's own service, and both are unreliable for third-party apps: the recogniser can accept
 * a session and then never deliver a single callback ("listening" at a silent wall), and the
 * text-to-speech bind can simply fail. So this class enumerates what is installed, binds Google's
 * engines by name when present, and walks down a ladder when an engine fails — a watchdog catches
 * the recogniser that goes quiet, and a failed speech engine moves to the next rather than
 * declaring voice impossible.
 *
 * The conversation is a loop: LISTENING → THINKING → SPEAKING → LISTENING. It closes itself —
 * that is the meaning of hands-free — opens only on a tap, and stops closing after two silences,
 * because a phone that re-arms its microphone forever in a pocket is a battery complaint and, in
 * a clinic, a privacy one. Listening and speaking never overlap: the recogniser would hear the
 * phone's own voice and the assistant would answer itself.
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
    private var recognizerStalls = 0
    private var handsFree = false
    private var silences = 0
    private var arabic = false

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    /** How far down the engine ladder speech output has fallen. */
    private var ttsAttempt = 0

    fun start(arabicNow: Boolean) {
        arabic = arabicNow
        handsFree = true
        silences = 0
        listen()
    }

    fun stop() {
        handsFree = false
        watchdogCancel()
        recognizer?.cancel()
        tts?.stop()
        onState(VoiceState.IDLE)
    }

    /** The reply is on its way; keep the mic off while we wait. */
    fun thinking() {
        watchdogCancel()
        onState(VoiceState.THINKING)
    }

    fun destroy() {
        handsFree = false
        watchdogCancel()
        recognizer?.destroy()
        recognizer = null
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    // ------------------------------------------------------------------- listening

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
                // Bound by name, not by default. The best recogniser on the phone is almost
                // always Google's; the system default on a Samsung is Bixby's, which is exactly
                // the one that goes silent.
                val component = bestRecognizer()
                recognizer = if (component != null) {
                    SpeechRecognizer.createSpeechRecognizer(context, component)
                } else {
                    SpeechRecognizer.createSpeechRecognizer(context)
                }
                recognizer?.setRecognitionListener(listener)
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
            watchdogArm()
        }
    }

    /** Google's recognition service if installed, else whatever else answers, else the default. */
    private fun bestRecognizer(): ComponentName? {
        val services = runCatching {
            context.packageManager.queryIntentServices(Intent(RECOGNITION_SERVICE), 0)
        }.getOrDefault(emptyList())
        if (services.isEmpty()) return null

        val pick = services.firstOrNull {
            it.serviceInfo.packageName.startsWith("com.google.android")
        } ?: services.first()
        return ComponentName(pick.serviceInfo.packageName, pick.serviceInfo.name)
    }

    /**
     * The stall detector.
     *
     * A healthy recogniser produces SOME callback within seconds — ready, speech, error,
     * anything. A broken bind produces nothing at all, which without this would leave the screen
     * saying "Listening…" at a wall forever. One stall gets a fresh recogniser; a second gets an
     * honest message instead of an endless lie.
     */
    private val watchdog = Runnable {
        recognizerStalls++
        recognizer?.destroy()
        recognizer = null
        if (recognizerStalls == 1 && handsFree) {
            listen()
        } else {
            onUnavailable(
                if (arabic) "خدمة التعرف على الصوت لا تستجيب على هذا الهاتف. جرّب الكتابة."
                else "This phone's speech service is not responding. Try typing instead."
            )
            stop()
        }
    }

    private fun watchdogArm() {
        main.removeCallbacks(watchdog)
        main.postDelayed(watchdog, WATCHDOG_MS)
    }

    private fun watchdogCancel() {
        main.removeCallbacks(watchdog)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            // The engine is alive; the watchdog's question is answered.
            watchdogCancel()
            recognizerStalls = 0
        }

        override fun onPartialResults(partialResults: Bundle?) {
            watchdogCancel()
            val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()
            if (text.isNotBlank()) onPartial(text)
        }

        override fun onResults(results: Bundle?) {
            watchdogCancel()
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
            watchdogCancel()
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

                else -> {
                    // Transient engine trouble. A fresh recogniser fixes most of it; repeated
                    // failure ends the loop with the error number, so a report from a phone we
                    // cannot see still says which engine code to look up.
                    recognizer?.destroy()
                    recognizer = null
                    if (handsFree && silences < MAX_SILENCES) {
                        silences++
                        listen()
                    } else {
                        onUnavailable(
                            if (arabic) "تعذّر الاستماع (رمز $error)."
                            else "Could not listen (error $error)."
                        )
                        stop()
                    }
                }
            }
        }

        override fun onBeginningOfSpeech() { watchdogCancel() }
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

    // -------------------------------------------------------------------- speaking

    /**
     * Read a reply aloud, then — in hands-free mode — open the mic for the next thing.
     *
     * Symbols the model uses for structure are stripped rather than pronounced: a bullet list
     * read as "asterisk asterisk" is the fastest way to make an assistant sound broken.
     */
    fun speak(text: String) {
        val speakable = text
            .replace(Regex("[*_#`>|]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (speakable.isEmpty()) {
            afterSpeaking()
            return
        }

        val engine = tts
        if (engine == null || !ttsReady) {
            initTts(
                then = { speak(text) },
                giveUp = {
                    // Voice out is gone but the assistant is not: the reply is on screen, and in
                    // hands-free mode the mic still reopens so the conversation continues.
                    onUnavailable(
                        if (arabic) "قراءة الردود صوتياً غير متاحة على هذا الهاتف."
                        else "Spoken replies are not available on this phone."
                    )
                    afterSpeaking()
                },
            )
            return
        }

        // A language the engine cannot speak is an engine failure like any other: fall down the
        // ladder rather than reading Arabic with no Arabic voice installed.
        val result = engine.setLanguage(if (arabic) Locale("ar") else Locale.US)
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            failCurrentTtsEngine()
            speak(text)
            return
        }

        onState(VoiceState.SPEAKING)
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onError(utteranceId: String?) { main.post { afterSpeaking() } }
            override fun onDone(utteranceId: String?) { main.post { afterSpeaking() } }
        })
        if (engine.speak(speakable, TextToSpeech.QUEUE_FLUSH, null, "ai-reply") != TextToSpeech.SUCCESS) {
            failCurrentTtsEngine()
            speak(text)
        }
    }

    private fun afterSpeaking() {
        if (handsFree) listen() else onState(VoiceState.IDLE)
    }

    /**
     * Bring up a speech engine, walking the ladder until one works.
     *
     * Google's engine is tried before the phone's default because on the phones where this
     * matters the default IS the broken one. The device default and Samsung's engine follow, so
     * a phone without Google TTS still gets its own voice.
     */
    private fun initTts(then: () -> Unit, giveUp: () -> Unit) {
        if (ttsAttempt >= TTS_LADDER.size) {
            giveUp()
            return
        }

        val enginePackage = TTS_LADDER[ttsAttempt]
        if (enginePackage != null && !isInstalled(enginePackage)) {
            ttsAttempt++
            initTts(then, giveUp)
            return
        }

        var handle: TextToSpeech? = null
        val onInit = TextToSpeech.OnInitListener { status ->
            main.post {
                if (status == TextToSpeech.SUCCESS) {
                    tts = handle
                    ttsReady = true
                    then()
                } else {
                    handle?.shutdown()
                    ttsAttempt++
                    initTts(then, giveUp)
                }
            }
        }
        handle = if (enginePackage != null) {
            TextToSpeech(context, onInit, enginePackage)
        } else {
            TextToSpeech(context, onInit)
        }
    }

    private fun failCurrentTtsEngine() {
        tts?.shutdown()
        tts = null
        ttsReady = false
        ttsAttempt++
    }

    private fun isInstalled(packageName: String): Boolean = runCatching {
        context.packageManager.getPackageInfo(packageName, 0)
        true
    }.getOrDefault(false)

    private companion object {
        const val MAX_SILENCES = 2
        const val WATCHDOG_MS = 8_000L
        const val RECOGNITION_SERVICE = "android.speech.RecognitionService"

        /** Engines in order of trust: Google's, the device default, Samsung's. */
        val TTS_LADDER = listOf("com.google.android.tts", null, "com.samsung.SMT")
    }
}
