"""
A small, self-hosted speech server — the "on my server" half of the receptionist's voice.

It exists because the Next.js app deploys as Vercel serverless functions, and this needs to keep a
~65MB neural voice model loaded in memory between requests, which a serverless function is not built
to do (loading it fresh on every cold start would erase the speed advantage this whole thing exists
for). So this runs as its own small, always-on process, and the Next.js side calls it over HTTP —
see src/lib/tts/piper.ts.

English only, by design. Piper's entire Arabic catalogue is one Jordanian voice at "medium" quality
at best — real Egyptian Arabic sounds noticeably better through Gemini, so Arabic replies never
come through here regardless of what this returns. Confirmed by ear before this was written, not
assumed: the audio samples are what settled it.

The voice loads once, at startup (see `lifespan` below) — not per request, which is what makes a
typical reply take under a second here instead of several.
"""

import io
import os
import wave
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from piper import PiperVoice

MODEL_PATH = os.environ.get("PIPER_MODEL_PATH", "/app/voice/en_US-amy-medium.onnx")
CONFIG_PATH = os.environ.get("PIPER_CONFIG_PATH", "/app/voice/en_US-amy-medium.onnx.json")

# A shared secret, not full auth — this service does one thing (turn text into a WAV file) and is
# meant to be called only by the Next.js server, never by a browser. Leaving it unset is allowed for
# local testing, but anything reachable from the internet should always set it.
AUTH_TOKEN = os.environ.get("TTS_SERVICE_TOKEN", "")

# Mirrors the cap in the Next.js route (src/app/api/tts/route.ts). Enforced here too because this
# service should be safe to call directly, not safe only because something upstream happens to
# check first.
MAX_CHARS = 600

_voice: PiperVoice | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _voice
    _voice = PiperVoice.load(MODEL_PATH, CONFIG_PATH)
    yield


app = FastAPI(lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    """Polled by whatever platform this is deployed on to decide if the box is alive and warm."""
    return {"status": "ok" if _voice is not None else "loading"}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest, authorization: str = Header(default="")):
    if AUTH_TOKEN and authorization != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"text too long ({len(text)} chars, limit {MAX_CHARS})")
    if _voice is None:
        # Only reachable in the narrow window between process start and the model finishing load.
        raise HTTPException(status_code=503, detail="voice is still loading, try again shortly")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        _voice.synthesize_wav(text, wav_file)

    return Response(content=buffer.getvalue(), media_type="audio/wav")
