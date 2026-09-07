"""
Faster-Whisper transcription server for Sovara.
Recreates the ZukuriFlow Elite pipeline locally:
  VAD-filtered capture -> Faster-Whisper with technical initial prompt
  -> Wispr-style TextRefiner (jargon map, capitalization, punctuation).

Runs as a local HTTP server — no API keys, no network required.

Usage:
    pip install -r requirements.txt
    python whisper_server.py <port>

Endpoints:
    POST /transcribe  — transcribe audio (PCM float32 base64)
    GET  /health      — always returns 200 (server is up)
    GET  /ready       — model loaded and ready
"""
import re
import sys
import base64
import struct
import logging
import numpy as np
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format='%(message)s')
log = logging.getLogger('whisper-server')

app = Flask(__name__)

_model = None
_model_name = None

# --- ZukuriFlow: technical vocabulary for the Whisper initial prompt ---
TECHNICAL_KEYWORDS = [
    "Python", "SQL", "RAG", "LangGraph", "SDE", "API", "REST", "GraphQL",
    "Docker", "Kubernetes", "AWS", "React", "TypeScript", "JavaScript",
    "FastAPI", "PostgreSQL", "MongoDB", "Redis", "Nginx", "Git", "CI/CD",
    "DevOps", "LLM", "GPT", "Claude", "OpenAI", "LangChain", "PyTorch",
]

INITIAL_PROMPT = (
    "This is a technical recording containing specialized terminology. "
    f"Common terms include: {', '.join(TECHNICAL_KEYWORDS)}. "
    "Transcribe accurately with proper capitalization and punctuation."
)

# --- ZukuriFlow: Wispr-style jargon map (lowercase -> proper form) ---
JARGON_MAP = {
    "python": "Python", "javascript": "JavaScript", "typescript": "TypeScript",
    "golang": "Go", "rust": "Rust", "kotlin": "Kotlin", "swift": "Swift",
    "rag": "RAG", "llm": "LLM", "gpt": "GPT", "openai": "OpenAI",
    "langchain": "LangChain", "langgraph": "LangGraph",
    "hugging face": "Hugging Face", "pytorch": "PyTorch", "tensorflow": "TensorFlow",
    "sql": "SQL", "nosql": "NoSQL", "postgresql": "PostgreSQL", "mysql": "MySQL",
    "mongodb": "MongoDB", "redis": "Redis", "elasticsearch": "Elasticsearch",
    "api": "API", "rest": "REST", "restful": "RESTful", "graphql": "GraphQL",
    "json": "JSON", "yaml": "YAML", "http": "HTTP", "https": "HTTPS",
    "websocket": "WebSocket", "aws": "AWS", "azure": "Azure", "gcp": "GCP",
    "docker": "Docker", "kubernetes": "Kubernetes", "k8s": "K8s",
    "ci/cd": "CI/CD", "cicd": "CI/CD", "devops": "DevOps", "nginx": "Nginx",
    "react": "React", "vue": "Vue", "angular": "Angular", "django": "Django",
    "flask": "Flask", "fastapi": "FastAPI", "nextjs": "Next.js",
    "next.js": "Next.js", "sde": "SDE", "ui": "UI", "ux": "UX",
    "git": "Git", "github": "GitHub", "gitlab": "GitLab",
    "oauth": "OAuth", "jwt": "JWT", "ssh": "SSH", "cli": "CLI",
}

CONTRACTIONS = {
    r"\bim\b": "I'm", r"\bive\b": "I've", r"\bill\b": "I'll", r"\bid\b": "I'd",
    r"\byoure\b": "you're", r"\bdont\b": "don't", r"\bdoesnt\b": "doesn't",
    r"\bdidnt\b": "didn't", r"\bcant\b": "can't", r"\bcouldnt\b": "couldn't",
    r"\bwont\b": "won't", r"\bisnt\b": "isn't", r"\bits\b": "it's",
    r"\bwere\b": "we're", r"\btheyre\b": "they're",
}


def refine_text(text: str) -> str:
    """Wispr-style refinement: jargon -> spacing -> caps -> punctuation."""
    if not text or not text.strip():
        return ""
    out = text.strip()
    for term_lower, term_proper in JARGON_MAP.items():
        out = re.sub(r"\b" + re.escape(term_lower) + r"\b",
                     term_proper, out, flags=re.IGNORECASE)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s+([.,!?;:])", r"\1", out)
    out = re.sub(r"([.,!?;:])([A-Za-z])", r"\1 \2", out).strip()
    if out:
        out = out[0].upper() + out[1:]
    out = re.sub(r"([.!?])\s+([a-z])",
                 lambda m: m.group(1) + " " + m.group(2).upper(), out)
    for pat, rep in CONTRACTIONS.items():
        out = re.sub(pat, rep, out, flags=re.IGNORECASE)
    if out and out[-1] not in ".!?":
        out += "."
    return out


def get_model(size='base'):
    global _model, _model_name
    if _model is None or _model_name != size:
        from faster_whisper import WhisperModel
        log.info('Loading faster-whisper model: %s ...', size)
        _model = WhisperModel(size, device='cpu', compute_type='int8')
        _model_name = size
        log.info('Model loaded: %s', size)
    return _model


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/ready', methods=['GET'])
def ready():
    return jsonify({'ready': _model is not None, 'model': _model_name})


@app.route('/transcribe', methods=['POST'])
def transcribe():
    try:
        data = request.get_json(force=True)
        pcm_b64 = data.get('pcm')
        language = data.get('language', 'en')
        model_size = data.get('model', 'base')

        if not pcm_b64:
            return jsonify({'error': "missing 'pcm' field"}), 400

        raw_bytes = base64.b64decode(pcm_b64)
        num_samples = len(raw_bytes) // 4
        pcm_data = struct.unpack(f'<{num_samples}f', raw_bytes)
        audio = np.array(pcm_data, dtype=np.float32)

        peak = float(np.abs(audio).max()) if audio.size else 0.0
        if peak > 1.0 and peak > 0:
            audio = audio / peak

        # Drop near-silence early (VAD pre-gate, mirrors ZukuriFlow silence filter)
        if audio.size == 0 or float(np.sqrt(np.mean(audio ** 2))) < 0.005:
            return jsonify({'text': '', 'raw': '', 'language': language, 'duration': 0.0})

        model = get_model(model_size)

        kwargs = {'initial_prompt': INITIAL_PROMPT}
        if language and language != 'auto':
            kwargs['language'] = language

        segments, info = model.transcribe(
            audio,
            beam_size=5,
            best_of=5,
            temperature=0.0,
            vad_filter=True,
            vad_parameters=dict(
                threshold=0.5,
                min_speech_duration_ms=250,
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
            **kwargs,
        )

        raw_text = ' '.join(seg.text.strip() for seg in segments).strip()
        full_text = refine_text(raw_text)

        return jsonify({
            'text': full_text,
            'raw': raw_text,
            'language': info.language,
            'languageProbability': round(float(info.language_probability), 3),
            'duration': round(float(info.duration), 2),
        })

    except Exception as e:
        log.error('Transcription error: %s', e, exc_info=True)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
    # Pre-load default model in background thread
    import threading
    threading.Thread(target=get_model, args=('base',), daemon=True).start()
    log.info('Starting faster-whisper server on http://127.0.0.1:%d ...', port)
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)
