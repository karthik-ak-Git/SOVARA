"""
Faster-whisper transcription server for SOVARA.
Runs on localhost, accepts audio via POST /transcribe.
Uses faster-whisper (CTranslate2) with VAD filtering.
"""

import io
import sys
import json
import time
import re
from pathlib import Path

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Global model reference
model = None
model_name = "base"

# Silence threshold — audio below this RMS is considered silence
SILENCE_RMS_THRESHOLD = 0.005
# Minimum audio length in samples (0.3s at 16kHz)
MIN_SAMPLES = 4800


def load_model(name: str = "base"):
    """Load faster-whisper model. Uses CPU with int8 for speed."""
    global model, model_name
    model_name = name
    print(f"[voice] Loading faster-whisper model: {name}", flush=True)
    from faster_whisper import WhisperModel
    model = WhisperModel(name, device="cpu", compute_type="int8")
    print(f"[voice] Model loaded: {name}", flush=True)


# ── Jargon mapping (from ZukuriFlow) ──
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


TECHNICAL_INITIAL_PROMPT = (
    "This is a technical recording containing specialized terminology. "
    "Common terms include: Python, SQL, RAG, LangGraph, SDE, API, REST, GraphQL, "
    "Docker, Kubernetes, AWS, React, Vue, TypeScript, JavaScript, FastAPI, "
    "PostgreSQL, MongoDB, Redis, Nginx, Git, CI/CD, DevOps, LLM, GPT, Claude, OpenAI. "
    "Transcribe accurately with proper capitalization and punctuation."
)

def refine_text(text: str) -> str:
    """Wispr-style refinement — exact ZukuriFlow logic."""
    if not text or not text.strip():
        return ""
    refined = text.strip()
    # Jargon mapping with word boundaries (case-insensitive)
    for term_lower, term_proper in JARGON_MAP.items():
        pattern = r"\b" + re.escape(term_lower) + r"\b"
        refined = re.sub(pattern, term_proper, refined, flags=re.IGNORECASE)
    # Spacing
    refined = re.sub(r"\s+", " ", refined)
    refined = re.sub(r"\s+([.,!?;:])", r"\1", refined)
    refined = re.sub(r"([.,!?;:])([A-Za-z])", r"\1 \2", refined)
    # Capitalize sentences
    if refined:
        refined = refined[0].upper() + refined[1:]
    refined = re.sub(r"([.!?])\s+([a-z])", lambda m: m.group(1) + " " + m.group(2).upper(), refined)
    # Ending punctuation
    if refined and refined[-1] not in ".!?":
        refined += "."
    # Contractions
    contractions = {
        r"\bim\b": "I'm", r"\bive\b": "I've", r"\bill\b": "I'll", r"\bid\b": "I'd",
        r"\byoure\b": "you're", r"\byouve\b": "you've", r"\byoull\b": "you'll", r"\byoud\b": "you'd",
        r"\bhes\b": "he's", r"\bshes\b": "she's", r"\bits\b": "it's",
        r"\bwere\b": "we're", r"\bweve\b": "we've", r"\bwell\b": "we'll", r"\bwed\b": "we'd",
        r"\btheyre\b": "they're", r"\btheyve\b": "they've", r"\btheyll\b": "they'll", r"\btheyd\b": "they'd",
        r"\bdont\b": "don't", r"\bdoesnt\b": "doesn't", r"\bdidnt\b": "didn't",
        r"\bcant\b": "can't", r"\bcouldnt\b": "couldn't", r"\bwouldnt\b": "wouldn't",
        r"\bshouldnt\b": "shouldn't", r"\bwont\b": "won't", r"\bisnt\b": "isn't",
        r"\barent\b": "aren't", r"\bwasnt\b": "wasn't", r"\bwerent\b": "weren't",
        r"\bhasnt\b": "hasn't", r"\bhavent\b": "haven't", r"\bhadnt\b": "hadn't",
    }
    for pat, rep in contractions.items():
        refined = re.sub(pat, rep, refined, flags=re.IGNORECASE)
    return refined


def decode_audio(raw_bytes: bytes) -> np.ndarray:
    """Decode audio bytes (WebM/Opus, WAV, raw PCM) to float32 mono 16kHz numpy array."""
    if raw_bytes[:4] == b'RIFF':
        import wave
        with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
            sr = wf.getframerate()
            nch = wf.getnchannels()
            frames = wf.readframes(wf.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            if nch == 2:
                audio = audio.reshape(-1, 2).mean(axis=1)
            if sr != 16000:
                duration = len(audio) / sr
                target_len = int(duration * 16000)
                audio = np.interp(
                    np.linspace(0, len(audio) - 1, target_len),
                    np.arange(len(audio)), audio
                ).astype(np.float32)
                print(f"[voice] Resampled WAV {sr}Hz -> 16000Hz", flush=True)
            return audio

    if raw_bytes[:4] == b'\x1a\x45\xdf\xa3':
        import av
        container = av.open(io.BytesIO(raw_bytes))
        audio_frames: list[np.ndarray] = []
        src_rate: int | None = None
        for frame in container.decode(audio=0):
            if src_rate is None:
                src_rate = frame.sample_rate
            arr = frame.to_ndarray()
            # arr is (channels, samples) for planar or (samples, channels)
            if arr.ndim == 2:
                # average channels to mono
                arr = arr.mean(axis=0) if arr.shape[0] <= 2 else arr.flatten()
            else:
                arr = arr.flatten()
            # av Opus returns float32 planar in [-1,1] or s16 — normalize if needed
            if arr.dtype == np.int16:
                arr = arr.astype(np.float32) / 32768.0
            else:
                arr = arr.astype(np.float32)
            audio_frames.append(arr)
        container.close()
        if not audio_frames:
            return np.array([], dtype=np.float32)
        audio = np.concatenate(audio_frames).astype(np.float32)
        if src_rate and src_rate != 16000:
            print(f"[voice] Resampling {src_rate}Hz -> 16000Hz ({len(audio)} -> ", end="", flush=True)
            duration = len(audio) / src_rate
            target_len = int(duration * 16000)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, target_len),
                np.arange(len(audio)), audio
            ).astype(np.float32)
            print(f"{len(audio)} samples)", flush=True)
        return audio

    # Fallback: raw PCM int16 at 16kHz mono
    return np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0


def is_silence(audio: np.ndarray) -> bool:
    """Check if audio is silence (RMS below threshold)."""
    if len(audio) < MIN_SAMPLES:
        return True
    rms = np.sqrt(np.mean(audio ** 2))
    return rms < SILENCE_RMS_THRESHOLD


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": model_name, "ready": model is not None})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if model is None:
        return jsonify({"error": "model not loaded"}), 503

    t0 = time.time()

    content_type = request.content_type or ""

    if "application/json" in content_type:
        data = request.get_json()
        if not data or "wav_base64" not in data:
            return jsonify({"error": "missing wav_base64 in JSON body"}), 400
        import base64
        raw_bytes = base64.b64decode(data["wav_base64"])
        audio = decode_audio(raw_bytes)
    elif "application/octet-stream" in content_type:
        raw_bytes = request.get_data()
        audio = decode_audio(raw_bytes)
    else:
        raw_bytes = request.get_data()
        audio = decode_audio(raw_bytes)

    # ── Silence detection — prevent Whisper hallucination ──
    if is_silence(audio):
        print(f"[voice] Silence detected (len={len(audio)}, rms={np.sqrt(np.mean(audio**2)):.6f})", flush=True)
        return jsonify({
            "text": "",
            "raw": "",
            "language": "unknown",
            "duration": len(audio) / 16000,
            "transcribeTime": time.time() - t0,
        })

    print(f"[voice] Audio: {len(audio)} samples, {len(audio)/16000:.2f}s, rms={np.sqrt(np.mean(audio**2)):.4f}", flush=True)

    # Transcribe — exact ZukuriFlow WhisperEngine params
    segments, info = model.transcribe(
        audio,
        language="en",
        initial_prompt=TECHNICAL_INITIAL_PROMPT,
        beam_size=5,
        best_of=5,
        temperature=0.0,
        vad_filter=True,
        vad_parameters=dict(threshold=0.5, min_speech_duration_ms=250, min_silence_duration_ms=500),
    )

    raw_parts = []
    for segment in segments:
        raw_parts.append(segment.text.strip())

    raw = " ".join(raw_parts)
    text = refine_text(raw)
    elapsed = time.time() - t0

    print(f"[voice] Transcribed in {elapsed:.2f}s: \"{text[:80]}\"", flush=True)

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
