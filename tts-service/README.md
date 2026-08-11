# Alpha Dental — Piper voice service

Self-hosted English voice for the reception assistant. Free per use, faster than the Gemini
fallback once warm (~0.6–0.8s per reply vs. 2.4–5s) — see `app.py` for why this has to run as its
own always-on process rather than inside the main Next.js deployment.

**English only.** Piper's Arabic catalogue is one Jordanian voice at "medium" quality at best;
Arabic replies stay on Gemini regardless of whether this is deployed. Don't try to redirect Arabic
here — the app already won't, on purpose.

## Why this can't just live on Vercel

The main app deploys to Vercel as serverless functions, which start fresh (or near-fresh) per
request and aren't built to keep a ~65MB model loaded in memory between calls — loading it every
time would be slower than just calling Gemini. This needs a small box that stays running.

## Deploy it

Any host that runs a Docker container works. Roughly in order of "least you have to think about":

### Fly.io (free tier covers this comfortably)
```bash
cd tts-service
fly launch --name your-clinic-voice --no-deploy   # answer the prompts, pick a region near the clinic
fly secrets set TTS_SERVICE_TOKEN=$(openssl rand -hex 32)
fly deploy
```
Note the token `fly secrets set` printed, and the URL Fly gives you (`https://your-clinic-voice.fly.dev`).

### Railway / Render
Point either at this folder as a Docker deployment. Both auto-detect the `Dockerfile`. Set
`TTS_SERVICE_TOKEN` as an environment variable in their dashboard before the first deploy.

### A plain VPS you already have
```bash
docker build -t alpha-voice .
docker run -d --restart unless-stopped -p 8080:8080 \
  -e TTS_SERVICE_TOKEN=$(openssl rand -hex 32) \
  --name alpha-voice alpha-voice
```
Put a reverse proxy (Caddy, nginx) in front for HTTPS — the main app calls this over the internet,
so it needs a real TLS certificate, not a bare IP:port.

## Wire it up

In the main app's environment (Vercel project settings, or `.env.local` for local dev):

```
PIPER_SERVICE_URL=https://your-clinic-voice.fly.dev
PIPER_SERVICE_TOKEN=<the same token you set above>
```

Leave both blank and nothing breaks — English replies simply stay on Gemini, same as Arabic
already is. This is additive, never required.

## Verify it after deploying

```bash
curl https://your-clinic-voice.fly.dev/health
# {"status":"ok"}

curl -X POST https://your-clinic-voice.fly.dev/synthesize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your token>" \
  -d '{"text":"Testing, one two three."}' \
  -o test.wav
# should produce a playable WAV file
```

If the main app can reach `/health` but `/synthesize` fails, check the token matches exactly on
both sides — the two values above have to be identical.

## Changing the voice

Amy (`en_US`, medium) is the default — chosen because the receptionist's persona is female
throughout the app. To use a different one, browse
[the voice list](https://github.com/rhasspy/piper/blob/master/VOICES.md), then edit both URLs in
`Dockerfile` to point at the new model, and rebuild/redeploy.
