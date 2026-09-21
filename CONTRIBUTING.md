# Contributing

Reachy Reflex is a development preview. Start with an issue for changes to question semantics, motion bounds, the relay contract, or privacy behavior. Keep model judgments separate from deterministic policy and robot commands. New perception channels need stale-data tests and explicit consent where appropriate.

Run `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run test:e2e`, `python3 -m unittest discover -s server -p 'test_*.py'`, and `python3 server/check_asr_api.py` (with optional ASR requirements installed) before a pull request. Browser tests use fixtures and synthetic audio and do not prove hardware behavior. Never commit model weights, API keys, raw video, audio, transcripts, or identifying room data. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
