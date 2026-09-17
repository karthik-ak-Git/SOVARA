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


# ── OCR (unlimited models) — mirrors test/infer.py Unlimited-OCR via SGLang ──
# Default best = baidu/Unlimited-OCR (document parsing, image+PDF). Fallback = rapidocr (offline).
# infer.py pattern: SGLang OpenAI-compat at 127.0.0.1:10000, prompt="document parsing.", image as data URL.
_ocr_engines: dict[str, object] = {}
_ocr_default = "baidu/Unlimited-OCR"
UNLIMITED_OCR_MODEL_DIR = "baidu/Unlimited-OCR"
SGLANG_URL = "http://127.0.0.1:10000"
SGLANG_MODEL = "Unlimited-OCR"

def _get_ocr(model_id: str = "rapidocr"):
    """Lazy-load OCR engine by name. Unlimited — any HF id or 'rapidocr' allowed."""
    if model_id in _ocr_engines:
        return _ocr_engines[model_id]
    mid = model_id.lower().strip() or "rapidocr"
    if mid in ("rapidocr", "default", "best"):
        from rapidocr_onnxruntime import RapidOCR
        eng = RapidOCR()
        _ocr_engines[mid] = eng
        print(f"[ocr] Loaded RapidOCR ({mid})", flush=True)
        return eng
    # HF TrOCR/Paddle generic — download unlimited via huggingface_hub
    try:
        from huggingface_hub import snapshot_download
        from pathlib import Path as _P
        cache = _P.home() / ".cache" / "sovara" / "ocr" / mid.replace("/", "__")
        snapshot_download(repo_id=model_id, local_dir=str(cache), local_dir_use_symlinks=False)
        # wrap as RapidOCR if onnx else fallback to transformers TrOCR
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
        from PIL import Image
        proc = TrOCRProcessor.from_pretrained(str(cache))
        m = VisionEncoderDecoderModel.from_pretrained(str(cache))
        eng = (proc, m)
        _ocr_engines[mid] = eng
        print(f"[ocr] Loaded HF OCR {model_id} -> {cache}", flush=True)
        return eng
    except Exception as e:
        print(f"[ocr] Failed to load {model_id}: {e}", flush=True)
        raise

def _run_ocr(image_bytes: bytes, model_id: str = "baidu/Unlimited-OCR"):
    """How to use — matches test/infer.py: image -> base64 data URL -> SGLang /v1/chat/completions."""
    import base64
    mid = (model_id or _ocr_default).strip()
    ml = mid.lower()
    # Unlimited-OCR via SGLang if requested (best for document parsing, unlimited pages/models)
    if ml in ("unlimited-ocr", "baidu/unlimited-ocr", "unlimited", "best", "default"):
        import requests as _req
        b64 = base64.b64encode(image_bytes).decode()
        # infer.py: {"type":"image_url","image_url":{"url":"data:image/png;base64,..."}} + text "document parsing."
        mime = "image/png"
        if image_bytes[:2] == b'\xff\xd8':
            mime = "image/jpeg"
        payload = {
            "model": SGLANG_MODEL,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": "document parsing."},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}
            ]}],
            "temperature": 0,
            "stream": False,
        }
        try:
            r = _req.post(f"{SGLANG_URL}/v1/chat/completions", json=payload, timeout=120)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"] or ""
            return {"text": text, "lines": text.splitlines(), "confidences": [1.0]*len(text.splitlines()), "model": mid}
        except Exception as e:
            print(f"[ocr] Unlimited-OCR SGLang failed, fallback to RapidOCR: {e}", flush=True)
            mid = "rapidocr"
            ml = "rapidocr"
    from PIL import Image
    import io as _io
    img = Image.open(_io.BytesIO(image_bytes)).convert("RGB")
    if ml in ("rapidocr", "default", "best"):
        eng = _get_ocr("rapidocr")
        result, _ = eng(np.array(img))
        texts, confs = [], []
        if result:
            for _, txt, c in result:
                texts.append(txt); confs.append(float(c))
        return {"text": "\n".join(texts), "lines": texts, "confidences": confs, "model": "rapidocr"}
    # Any other HF id — unlimited download
    proc, m = _get_ocr(mid)
    pixel_values = proc(images=img, return_tensors="pt").pixel_values
    import torch
    with torch.no_grad():
        ids = m.generate(pixel_values)
    text = proc.batch_decode(ids, skip_special_tokens=True)[0]
    return {"text": text, "lines": [text], "confidences": [1.0], "model": mid}


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": model_name, "ready": model is not None, "ocr_models": list(_ocr_engines.keys()), "ocr_ready": True})


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


@app.route("/ocr", methods=["POST"])
def ocr():
    t0 = time.time()
    ct = request.content_type or ""
    model_id = request.args.get("model") or request.form.get("model") or "rapidocr"
    if "application/json" in ct:
        data = request.get_json() or {}
        model_id = data.get("model") or model_id
        if "image_base64" not in data:
            return jsonify({"error": "missing image_base64"}), 400
        import base64
        raw = base64.b64decode(data["image_base64"])
    else:
        # multipart or raw bytes
        if "file" in request.files:
            raw = request.files["file"].read()
            model_id = request.form.get("model") or model_id
        else:
            raw = request.get_data()
            if not raw:
                return jsonify({"error": "missing image bytes"}), 400
    try:
        out = _run_ocr(raw, model_id)
        out["ocrTime"] = time.time() - t0
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/ocr/models", methods=["GET"])
def ocr_models():
    # curate best OCR models — unlimited download by name (as in request: allow any model name)
    best = [
        {"id": "baidu/Unlimited-OCR", "name": "Unlimited-OCR (best, document parsing — via SGLang, see test/infer.py)", "installed": False},
        {"id": "rapidocr", "name": "RapidOCR (offline fallback, fast)", "installed": "rapidocr" in _ocr_engines},
        {"id": "microsoft/trocr-base-printed", "name": "TrOCR Base Printed"},
        {"id": "microsoft/trocr-large-printed", "name": "TrOCR Large Printed"},
        {"id": "microsoft/trocr-base-handwritten", "name": "TrOCR Handwritten"},
        {"id": "naver-clova-ix/donut-base", "name": "Donut (document OCR)"},
        {"id": "PaddlePaddle/paddleocr", "name": "PaddleOCR"},
    ]
    return jsonify({"models": best, "loaded": list(_ocr_engines.keys()), "default": _ocr_default})


@app.route("/ocr/download", methods=["POST"])
def ocr_download():
    data = request.get_json() or {}
    mid = (data.get("model") or "").strip()
    if not mid:
        return jsonify({"error": "model required"}), 400
    try:
        _get_ocr(mid)
        return jsonify({"ok": True, "model": mid})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    model_name = sys.argv[1] if len(sys.argv) > 1 else "base"
    load_model(model_name)
    print(f"[voice] Server starting on http://127.0.0.1:51820", flush=True)
    # Try production WSGI server (waitress) to avoid Flask dev-server warning
    # Fallback to Flask with suppressed warning if not available
    try:
        from waitress import serve
        print(f"[voice] Serving with waitress (production) on http://127.0.0.1:51820", flush=True)
        serve(app, host="127.0.0.1", port=51820, threads=4)
    except ImportError:
        import logging
        logging.getLogger('werkzeug').setLevel(logging.ERROR)
        app.run(host="127.0.0.1", port=51820, debug=False, threaded=True, use_reloader=False)
