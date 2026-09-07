"""
Faster-whisper transcription server for SOVARA.
Runs on localhost, accepts audio via POST /transcribe.
Uses faster-whisper (CTranslate2) with VAD filtering.
"""

import io
import sys
import json
import time
import tempfile
import os
import wave
import struct
from pathlib import Path

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Global model reference
model = None
model_name = "base"


def load_model(name: str = "base"):
    """Load faster-whisper model. Uses CPU with int8 for speed."""
    global model, model_name
    model_name = name
    print(f"[voice] Loading faster-whisper model: {name}", flush=True)
    from faster_whisper import WhisperModel
    model = WhisperModel(name, device="cpu", compute_type="int8")
    print(f"[voice] Model loaded: {name}", flush=True)


# ── Jargon mapping (106 entries from ZukuriFlow) ──
JARGON_MAP = {
    "python": "Python",
    "typescript": "TypeScript",
    "javascript": "JavaScript",
    "react": "React",
    "nextjs": "Next.js",
    "next js": "Next.js",
    "next.js": "Next.js",
    "node js": "Node.js",
    "node.js": "Node.js",
    "nodejs": "Node.js",
    "electron": "Electron",
    "langgraph": "LangGraph",
    "fast api": "FastAPI",
    "fastapi": "FastAPI",
    "django": "Django",
    "flask": "Flask",
    "graph ql": "GraphQL",
    "graphql": "GraphQL",
    "postgre sql": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "postgres": "PostgreSQL",
    "sqlite": "SQLite",
    "my sql": "MySQL",
    "mysql": "MySQL",
    "mongo db": "MongoDB",
    "mongodb": "MongoDB",
    "redis": "Redis",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "k eight s": "Kubernetes",
    "k8s": "Kubernetes",
    "terraform": "Terraform",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "llm": "LLM",
    "rag": "RAG",
    "api": "API",
    "cli": "CLI",
    "ide": "IDE",
    "ui": "UI",
    "ux": "UX",
    "ci": "CI",
    "cd": "CD",
    "ssh": "SSH",
    "http": "HTTP",
    "https": "HTTPS",
    "json": "JSON",
    "yaml": "YAML",
    "xml": "XML",
    "html": "HTML",
    "css": "CSS",
    "dom": "DOM",
    "rest": "REST",
    "jwt": "JWT",
    "oauth": "OAuth",
    "url": "URL",
    "gpu": "GPU",
    "cpu": "CPU",
    "ram": "RAM",
    "ssd": "SSD",
    "git": "Git",
    "github": "GitHub",
    "vs code": "VS Code",
    "vscode": "VS Code",
    "whisper": "Whisper",
    "sovara": "SOVARA",
    "sde": "SDE",
    "sql": "SQL",
    "nosql": "NoSQL",
    "dev ops": "DevOps",
    "devops": "DevOps",
    "machine learning": "Machine Learning",
    "deep learning": "Deep Learning",
    "neural network": "Neural Network",
    "open ai": "OpenAI",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "claude": "Claude",
    "gpt": "GPT",
    "gemini": "Gemini",
    "copilot": "Copilot",
    "npm": "npm",
    "pnpm": "pnpm",
    "yarn": "yarn",
    "bun": "Bun",
    "deno": "Deno",
    "vite": "Vite",
    "webpack": "webpack",
    "babel": "Babel",
    "eslint": "ESLint",
    "prettier": "Prettier",
    "prisma": "Prisma",
    "drizzle": "Drizzle",
    "next auth": "NextAuth",
    "nextauth": "NextAuth",
    "tailwind": "Tailwind",
    "sass": "SASS",
    "figma": "Figma",
    "vercel": "Vercel",
    "netlify": "Netlify",
    "cloudflare": "Cloudflare",
    "supabase": "Supabase",
    "firebase": "Firebase",
    "stripe": "Stripe",
    "webhook": "Webhook",
    "endpoint": "endpoint",
    "payload": "payload",
    "boolean": "boolean",
    "string": "string",
    "integer": "integer",
    "array": "array",
    "object": "object",
    "function": "function",
    "variable": "variable",
    "constant": "constant",
    "callback": "callback",
    "promise": "Promise",
    "async": "async",
    "await": "await",
    "middleware": "middleware",
    "repository": "repository",
    "refactor": "refactor",
    "debugging": "debugging",
    "deployment": "deployment",
    "authentication": "authentication",
    "authorization": "authorization",
    "encryption": "encryption",
}


def refine_text(text: str) -> str:
    """Apply jargon mapping, spacing fixes, sentence capitalization."""
    if not text.strip():
        return text

    # Apply jargon (word-boundary aware, case-insensitive)
    words = text.split()
    refined = []
    for word in words:
        lower = word.lower().strip(".,!?;:")
        punct = ""
        if word and word[-1] in ".,!?;:":
            punct = word[-1]
        replacement = JARGON_MAP.get(lower, word)
        refined.append(replacement + punct)
    text = " ".join(refined)

    # Spacing fixes
    text = " ".join(text.split())
    text = text.replace(" .", ".").replace(" ,", ",").replace(" !", "!").replace(" ?", "?")

    # Sentence capitalization
    import re
    text = re.sub(r'(^|[.!?]\s+)(\w)', lambda m: m.group(1) + m.group(2).upper(), text)

    # Ensure trailing punctuation
    if text and text[-1] not in ".!?":
        text += "."

    return text


def pcm_to_float32(pcm_data: bytes, sample_rate: int = 16000) -> np.ndarray:
    """Convert raw PCM int16 to float32 numpy array."""
    samples = np.frombuffer(pcm_data, dtype=np.int16)
    return samples.astype(np.float32) / 32768.0


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": model_name, "ready": model is not None})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if model is None:
        return jsonify({"error": "model not loaded"}), 503

    t0 = time.time()

    content_type = request.content_type or ""

    if "application/octet-stream" in content_type:
        # Raw PCM int16 mono
        pcm_data = request.get_data()
        audio = pcm_to_float32(pcm_data)
    elif "application/json" in content_type:
        data = request.get_json()
        if not data or "wav_base64" not in data:
            return jsonify({"error": "missing wav_base64 in JSON body"}), 400
        import base64
        raw_b64 = data["wav_base64"]
        raw_bytes = base64.b64decode(raw_b64)
        # Decode any audio format (WebM/Opus, WAV, MP3, etc.) via av
        import av
        container = av.open(io.BytesIO(raw_bytes))
        audio_frames = []
        for frame in container.decode(audio=0):
            audio_frames.append(frame.to_ndarray().flatten())
        container.close()
        if audio_frames:
            audio = np.concatenate(audio_frames).astype(np.float32)
            # Normalize int16 to float32 if needed
            if audio.max() > 1.0 or audio.min() < -1.0:
                audio = audio / 32768.0
        else:
            audio = np.array([], dtype=np.float32)
    else:
        # Try treating body as raw audio bytes
        pcm_data = request.get_data()
        audio = pcm_to_float32(pcm_data)

    if len(audio) < 1600:  # Less than 0.1s at 16kHz
        return jsonify({"text": "", "raw": "", "language": "unknown", "duration": 0, "transcribeTime": 0})

    # Transcribe with VAD
    segments, info = model.transcribe(
        audio,
        beam_size=5,
        language=None,  # auto-detect
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=200,
        ),
    )

    raw_parts = []
    for segment in segments:
        raw_parts.append(segment.text.strip())

    raw = " ".join(raw_parts)
    text = refine_text(raw)
    elapsed = time.time() - t0

    print(f"[voice] Transcribed in {elapsed:.2f}s: \"{text[:60]}...\"", flush=True)

    return jsonify({
        "text": text,
        "raw": raw,
        "language": info.language,
        "duration": len(audio) / 16000,
        "transcribeTime": elapsed,
    })


if __name__ == "__main__":
    model_name = sys.argv[1] if len(sys.argv) > 1 else "base"
    load_model(model_name)
    print(f"[voice] Server starting on http://127.0.0.1:51820", flush=True)
    app.run(host="127.0.0.1", port=51820, debug=False, threaded=True)
