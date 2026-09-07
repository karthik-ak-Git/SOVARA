"""
Faster-Whisper transcription server for Sovara.
Runs as a local HTTP server — no API keys, no network required.

Usage:
    pip install faster-whisper flask
    python whisper_server.py <port>

Endpoints:
    POST /transcribe  — transcribe audio (PCM float32 base64)
    GET  /health      — always returns 200 (server is up)
    GET  /ready       — model loaded and ready
"""
import sys
import os
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


def get_model(size='tiny'):
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
        sample_rate = data.get('sampleRate', 16000)
        language = data.get('language', 'en')
        model_size = data.get('model', 'tiny')

        if not pcm_b64:
            return jsonify({'error': "missing 'pcm' field"}), 400

        raw_bytes = base64.b64decode(pcm_b64)
        num_samples = len(raw_bytes) // 4
        pcm_data = struct.unpack(f'<{num_samples}f', raw_bytes)
        audio = np.array(pcm_data, dtype=np.float32)

        if audio.max() > 1.0 or audio.min() < -1.0:
            peak = max(abs(audio.max()), abs(audio.min()))
            if peak > 0:
                audio = audio / peak

        model = get_model(model_size)

        kwargs = {}
        if language and language != 'auto':
            kwargs['language'] = language

        segments, info = model.transcribe(
            audio,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=200),
            **kwargs,
        )

        text_parts = [seg.text.strip() for seg in segments]
        full_text = ' '.join(text_parts).strip()

        return jsonify({
            'text': full_text,
            'language': info.language,
            'duration': round(info.duration, 2),
        })

    except Exception as e:
        log.error('Transcription error: %s', e, exc_info=True)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
    # Pre-load default model in background thread
    import threading
    threading.Thread(target=get_model, args=('tiny',), daemon=True).start()
    log.info('Starting faster-whisper server on http://127.0.0.1:%d ...', port)
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)
