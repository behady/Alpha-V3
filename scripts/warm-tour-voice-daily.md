# Warming Sara's voice

The tour speaks roughly **670 distinct lines** (about 335 in each language). Each one is
synthesised **once, ever**, and kept in Firebase Storage under `tts-cache/<lang>/<sha1>.wav`,
shared by every clinic. A line that is already there costs nothing and, more importantly, costs
no API request.

## The limit that decides the schedule

    generativelanguage.googleapis.com/generate_requests_per_model_per_day
    limit: 100, model: gemini-2.5-flash-tts

**One hundred requests a day, for the whole project.** Not per clinic, not per user. It resets on
a rolling 24-hour window (the 429 says exactly how long is left).

So warming the full tour takes about **seven days** at 100 a day. Until it is done, voice stays
**off by default** in the tour panel — a person can still switch it on, and every line already in
the cache plays instantly and for free.

## Running it

```bash
npx tsx scripts/warm-tour-voice.mts          # both languages, only what is missing
npx tsx scripts/warm-tour-voice.mts --lang en
npx tsx scripts/warm-tour-voice.mts --dry    # count and price it, synthesise nothing
```

It skips what is cached, backs off on a 429, and stops cleanly when the day's allowance is gone,
printing how many lines are left. Run it again tomorrow; it resumes exactly where it stopped.

## When it is finished

Turn voice back on by default — one line in `GrandTourOverlay.tsx`:

```ts
const [voiceOn, setVoiceOn] = useState(true);           // and readPref(VOICE_KEY, "on")
```

Re-run the warmer after any narration change: new lines are the only ones it will synthesise.

## The two ways to stop waiting

- **Raise the quota.** The limit is a free-tier/Tier-1 ceiling on the TTS model specifically;
  a paid tier and a quota request lift it. Everything else in the product already runs on paid
  Gemini models without hitting this.
- **Self-host the English half.** `getTtsProvider()` already prefers Piper for English when
  `PIPER_SERVICE_URL` is set. Piper costs nothing per character and has no daily ceiling, which
  would take half the tour off Google's quota entirely and leave only Arabic on Gemini.
