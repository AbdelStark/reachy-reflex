# Contributing

Reachy Reflex is a development preview. Start with an issue for changes to question semantics, motion bounds, the relay contract, or privacy behavior. Keep model judgments separate from deterministic policy and robot commands. New perception channels need stale-data tests and explicit consent where appropriate.

Run `npm ci`, `npm run check`, `npm test`, `npm run build`, and `npm run test:e2e` before a pull request. Browser tests use fixtures and do not prove hardware behavior. Never commit API keys, raw video, audio, transcripts, or identifying room data. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
