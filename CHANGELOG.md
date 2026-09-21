# Changelog

## Unreleased

- Pin the shared question-bank validator that rejects malformed/unknown question kinds before wire projection; test the 16-question and empty-room expansions against the installed package.
- Recycle an unmatched face label when all nine labels are reserved but a within-cap frame has a newcomer; invalidate the prior policy/model epoch so an in-flight answer cannot follow the reused label. Do not recycle on truncated crowded frames.
- Version local traces as `reflex.tick@2` with explicit policy reset epochs and add a bounded offline replay command for exported judgments; tracing begins from a fresh policy state, while model and robot execution remain outside replay.
- Fence in-flight judgments across observation/consent/motion context changes, reset policy hysteresis and the Jev cache, and require fresh evidence before resuming decisions.
- Add a 30-tick self-authored synthetic policy replay corpus and CI gate for gaze, nod, turn, stale, and ignored transitions; reset the ignored timer on stale judgments or a two-second fresh-data gap so missing model evidence cannot age into a droop.
- Add an off-by-default, bounded five-minute judgment trace with typed answers, policy output, motion-dispatch outcome, browser JSONL download/discard, and no raw text or media fields; fixture and unit tests verify redaction and retention.
- Bind robot motion to a fresh, stable source observation across slow and cached Jev answers; invalidate in-flight motion on tracking or motion changes, and hold commands when faces drift or video stalls.
- Allow separately consented final text to drive panel-only judgments when face tracking is absent; keep person attribution unknown and motion off, and idle the panel when text expires.
- Add separately consented robot-stream ASR through a bounded, authenticated loopback faster-whisper adapter. Ship no model weights and make no robust VAD, DoA, speaker, or robot-validation claim.
- Add opt-in local robot-stream sound-energy observation; only bucketed level and a coarse activity flag can reach the relay. No raw audio, DoA, speaker identity, or live robot claim.
- Add explicit-consent browser transcription with short-lived, bounded final utterances and unknown speaker attribution. Cover the UI with a fake recognizer; no robot-microphone claim.

## 0.0.1 (development preview)

- Add a 16-question Jev decision loop and deterministic gaze, nod, and turn policy.
- Add Reachy Mini browser host, fixture preview, local face-box tracking, opt-in motion, and authenticated loopback relay.
- Add source and browser tests with standalone CI. No robot test or live accuracy claim.
