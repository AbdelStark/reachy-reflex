# Changelog

## Unreleased

- Allow separately consented final text to drive panel-only judgments when face tracking is absent; keep person attribution unknown and motion off, and idle the panel when text expires.
- Add separately consented robot-stream ASR through a bounded, authenticated loopback faster-whisper adapter. Ship no model weights and make no robust VAD, DoA, speaker, or robot-validation claim.
- Add opt-in local robot-stream sound-energy observation; only bucketed level and a coarse activity flag can reach the relay. No raw audio, DoA, speaker identity, or live robot claim.
- Add explicit-consent browser transcription with short-lived, bounded final utterances and unknown speaker attribution. Cover the UI with a fake recognizer; no robot-microphone claim.

## 0.0.1 (development preview)

- Add a 16-question Jev decision loop and deterministic gaze, nod, and turn policy.
- Add Reachy Mini browser host, fixture preview, local face-box tracking, opt-in motion, and authenticated loopback relay.
- Add source and browser tests with standalone CI. No robot test or live accuracy claim.
