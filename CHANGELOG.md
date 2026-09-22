# Changelog

## Unreleased

- Refresh the synthetic speaking assertion while the browser event-bridge test waits for `yield`, matching the real advisory writer's heartbeat; bound WebSocket/HTTP teardown so CI timing failures are easier to attribute.
- Detach tracked face boxes and returned room snapshots from caller-owned objects; reject out-of-order camera timestamps so an older frame cannot silently remap a session label. The app's existing perception-error path clears evidence and disarms motion; synthetic tests do not validate camera timing on a robot.
- Pin the local model relay to the reviewed 16-question Reflex wire while validating person-dependent attention choices against bounded, bucketed room state; reject altered instructions and extra/private fields before the model port. Synthetic relay and browser checks do not measure Jev or robot behavior.
- Break a partial gaze switch and no-target idle countdown on stale judgments or a two-second fresh-data gap; extend the self-authored policy replay to 43 ticks across four scenes. No robot timing or behavior claim follows.
- Add a display-only full-screen brain panel with in-page fallback when browser or host policy denies it; browser tests cover entry, exit, and denial without model or robot calls.
- Document the opt-in Reachy Conscience speaking writer now available for this relay; its enqueue and operator-quiet assertions remain unverified on hardware and are not playback receipts.
- Add an opt-in, distinct-token local speaking-state writer/read bridge with bounded monotonic updates and 1.5-second expiry. A synthetic browser-to-relay-to-subscriber test now exercises a camera-gated `yield` hint and verifies expiry; no owned conversation writer, playback-complete signal, or live TTS consumer is claimed.
- Version opt-in traces as `reflex.tick@3` to distinguish asserted quiet from unknown speaking state; the offline replay reader still accepts prior `@2` traces. Hold proposed nod motion while speaking state is unknown.
- Show tab-scoped reported token usage and unresolved requests without inferring a model-specific dollar cost or invoice.
- Add an opt-in, origin- and token-gated loopback event bridge with distinct read-only WebSocket credentials. Browser publication requires current camera evidence; no Conversation App consumer or robot delivery is claimed.
- Exercise the complete synthetic browser-to-loopback-relay-to-WebSocket-subscriber path without TypeSafe calls or robot motion.
- Align the shared `reachy-jev` pin with the typed question-wire release used by the other Reachy apps; the question set and expected wire digest are unchanged.
- Reject frames with more than nine detected faces instead of truncating the room; clear prior labels, pause judgments, disarm motion, and require a recovered scene plus explicit re-arm. Unit and fake-host browser tests cover the overflow and recovery path.
- Pin the shared question-bank validator that rejects malformed/unknown question kinds before wire projection; test the 16-question and empty-room expansions against the installed package.
- Recycle an unmatched face label when all nine labels are reserved but a within-cap frame has a newcomer; invalidate the prior policy/model epoch so an in-flight answer cannot follow the reused label.
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
