"""Authenticated loopback ASR for bounded robot-stream utterance segments.

No model is downloaded by this module. It accepts complete 16 kHz mono
float32 PCM and returns final text only; speaker identity is never inferred.
"""

from __future__ import annotations

import argparse
import hmac
import json
import math
import os
import struct
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import BoundedSemaphore
from typing import Any
from urllib.parse import urlsplit

SAMPLE_RATE = 16_000
MIN_BODY = SAMPLE_RATE  # 0.25 s of float32 PCM
MAX_BODY = SAMPLE_RATE * 12 * 4
MAX_TEXT = 200


def validate_pcm(body: bytes) -> None:
    if (
        not isinstance(body, bytes)
        or not MIN_BODY <= len(body) <= MAX_BODY
        or len(body) % 4
    ):
        raise ValueError(
            "PCM must contain 0.25 to 12 seconds of complete float32 samples"
        )
    for (sample,) in struct.iter_unpack("<f", body):
        if not math.isfinite(sample) or abs(sample) > 1:
            raise ValueError("PCM contains invalid samples")


def validate_text(value: Any) -> str:
    if (
        not isinstance(value, str)
        or len(value) > MAX_TEXT
        or any(ord(char) < 32 and char not in "\t\n" for char in value)
    ):
        raise ValueError("invalid ASR transcript")
    return " ".join(value.split())


class LocalWhisperText:
    """Caller-provided, self-contained faster-whisper CPU model, local only."""

    def __init__(self, model_path: str | Path) -> None:
        path = Path(model_path)
        if not path.is_dir() or any(
            not (path / name).is_file()
            for name in ("model.bin", "config.json", "tokenizer.json")
        ):
            raise ValueError(
                "model path must be a complete local converted model directory"
            )
        try:
            import numpy as np
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("install the optional ASR requirements first") from exc
        self.np = np
        self.model = WhisperModel(
            str(path), device="cpu", compute_type="int8", local_files_only=True
        )

    def __call__(self, body: bytes) -> str:
        samples = self.np.frombuffer(body, dtype="<f4")
        segments, _info = self.model.transcribe(
            samples,
            language="en",
            beam_size=1,
            condition_on_previous_text=False,
            vad_filter=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return validate_text(text)


def create_asr_server(
    *,
    token: str,
    allowed_origin: str,
    transcribe: Callable[[bytes], str],
    port: int = 0,
) -> ThreadingHTTPServer:
    if (
        not isinstance(token, str)
        or len(token) < 32
        or any(ord(char) < 32 or ord(char) > 126 for char in token)
    ):
        raise ValueError(
            "ASR token must contain at least 32 printable ASCII characters"
        )
    origin = urlsplit(allowed_origin)
    if (
        origin.scheme not in ("http", "https")
        or origin.hostname not in ("127.0.0.1", "::1", "localhost")
        or not origin.netloc
        or origin.path
        or origin.query
        or origin.fragment
    ):
        raise ValueError("allowed origin must be an exact local browser origin")
    if not callable(transcribe):
        raise TypeError("transcribe callable required")
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("invalid ASR port")
    gate = BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            pass  # Never log audio, text, token, or request URLs.

        def _send(self, status: int, payload: dict[str, str] | None = None) -> None:
            body = json.dumps(payload or {}, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if self.headers.get("Origin") == allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            if self.path != "/v1/asr":
                return self._send(404)
            if self.headers.get("Origin") != allowed_origin:
                return self._send(403)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Authorization, Content-Type"
            )
            self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self) -> None:
            self.connection.settimeout(20)
            if self.path != "/v1/asr":
                return self._send(404)
            if self.headers.get("Origin") != allowed_origin:
                return self._send(403)
            supplied = self.headers.get("Authorization", "")
            if not supplied.startswith("Bearer ") or not hmac.compare_digest(
                supplied[7:], token
            ):
                return self._send(401)
            if self.headers.get("Content-Type") != "application/octet-stream":
                return self._send(415)
            if self.headers.get("Transfer-Encoding"):
                return self._send(400)
            try:
                length = int(self.headers.get("Content-Length", ""))
            except (TypeError, ValueError):
                return self._send(411)
            if length > MAX_BODY:
                return self._send(413)
            if length < MIN_BODY or length % 4:
                return self._send(400)
            if not gate.acquire(blocking=False):
                return self._send(429)
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    return self._send(400)
                try:
                    validate_pcm(body)
                except ValueError:
                    return self._send(400)
                try:
                    text = validate_text(transcribe(body))
                except Exception:  # noqa: BLE001 - do not expose model errors or text
                    return self._send(503)
                self._send(200, {"text": text})
            finally:
                gate.release()

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Local robot-stream ASR for Reachy Reflex"
    )
    parser.add_argument(
        "--model-path", required=True, help="Existing converted model directory"
    )
    parser.add_argument("--port", type=int, default=8051)
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    args = parser.parse_args()
    server = create_asr_server(
        token=os.environ.get("REFLEX_ASR_TOKEN", ""),
        allowed_origin=args.origin,
        transcribe=LocalWhisperText(args.model_path),
        port=args.port,
    )
    print(
        f"Local ASR listening on 127.0.0.1:{server.server_port} for {args.origin}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
