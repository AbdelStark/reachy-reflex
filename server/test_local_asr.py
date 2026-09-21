"""Synthetic local-ASR boundary tests; no model weights or robot."""

from __future__ import annotations

import json
import struct
import threading
import types
import unittest
from http.client import HTTPConnection

from server.local_asr import (
    MAX_BODY,
    LocalWhisperText,
    create_asr_server,
    validate_pcm,
    validate_text,
)

TOKEN = "t" * 32
ORIGIN = "http://127.0.0.1:5173"
PCM = struct.pack("<f", 0.1) * 8_000


class LocalAsrTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def transcribe(body):
            self.calls.append(body)
            return "Reachy, look here"

        self.server = create_asr_server(
            token=TOKEN, allowed_origin=ORIGIN, transcribe=transcribe
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(
        self,
        body=PCM,
        *,
        origin=ORIGIN,
        token=TOKEN,
        content_type="application/octet-stream",
        method="POST",
    ):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request(
                method,
                "/v1/asr",
                body=body if method == "POST" else None,
                headers={
                    "Origin": origin,
                    "Authorization": f"Bearer {token}",
                    "Content-Type": content_type,
                },
            )
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_authenticated_pcm_returns_final_text_only(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"text": "Reachy, look here"})
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.calls, [PCM])

    def test_origin_token_format_and_samples_fail_before_model(self):
        for options, expected in (
            ({"origin": "http://evil.example"}, 403),
            ({"token": "wrong"}, 401),
            ({"content_type": "audio/webm"}, 415),
            ({"body": b"invalid"}, 400),
            ({"body": struct.pack("<f", float("nan")) * 8_000}, 400),
        ):
            with self.subTest(options=options):
                self.assertEqual(self.request(**options)[0], expected)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.request(method="OPTIONS")[0], 204)
        self.assertEqual(
            self.request(method="OPTIONS", origin="http://evil.example")[0], 403
        )

    def test_oversized_body_and_invalid_model_output_fail_closed(self):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.putrequest("POST", "/v1/asr")
            connection.putheader("Origin", ORIGIN)
            connection.putheader("Authorization", f"Bearer {TOKEN}")
            connection.putheader("Content-Type", "application/octet-stream")
            connection.putheader("Content-Length", str(MAX_BODY + 4))
            connection.endheaders()
            self.assertEqual(connection.getresponse().status, 413)
        finally:
            connection.close()
        self.assertEqual(self.calls, [])
        with self.assertRaises(ValueError):
            validate_pcm(b"123")
        with self.assertRaises(ValueError):
            validate_text("x" * 201)
        with self.assertRaises(ValueError):
            create_asr_server(
                token=TOKEN,
                allowed_origin="https://remote.example",
                transcribe=lambda _: "",
            )

    def test_fake_local_whisper_options_and_text_cap(self):
        calls = []

        class Model:
            def transcribe(self, samples, **options):
                calls.append((samples, options))
                return [
                    types.SimpleNamespace(text=" Reachy "),
                    types.SimpleNamespace(text="look here "),
                ], None

        adapter = object.__new__(LocalWhisperText)
        adapter.np = types.SimpleNamespace(frombuffer=lambda body, dtype: (body, dtype))
        adapter.model = Model()
        self.assertEqual(adapter(PCM), "Reachy look here")
        self.assertEqual(calls[0][0], (PCM, "<f4"))
        self.assertEqual(calls[0][1]["condition_on_previous_text"], False)
        self.assertEqual(calls[0][1]["vad_filter"], False)
        with self.assertRaisesRegex(ValueError, "complete local"):
            LocalWhisperText("/definitely/not/a/model")


if __name__ == "__main__":
    unittest.main()
