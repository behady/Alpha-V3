# The voice model is baked into the image at build time, not fetched at container startup — a
# machine coming back up after a restart should not depend on Hugging Face being reachable at that
# exact moment just to start speaking again.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Amy (en_US, medium) — chosen because the receptionist's persona is female throughout the app;
# swap both URLs for a different voice at https://github.com/rhasspy/piper/blob/master/VOICES.md
# if you want a different one.
RUN mkdir -p /app/voice && \
    curl -sL -A "Mozilla/5.0" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true" \
      -o /app/voice/en_US-amy-medium.onnx && \
    curl -sL -A "Mozilla/5.0" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true" \
      -o /app/voice/en_US-amy-medium.onnx.json && \
    test -s /app/voice/en_US-amy-medium.onnx && test -s /app/voice/en_US-amy-medium.onnx.json

COPY app.py .

ENV PIPER_MODEL_PATH=/app/voice/en_US-amy-medium.onnx
ENV PIPER_CONFIG_PATH=/app/voice/en_US-amy-medium.onnx.json

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
