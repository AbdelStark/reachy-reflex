---
title: Reachy Reflex
emoji: ⚡
colorFrom: teal
colorTo: blue
sdk: static
app_file: dist/index.html
app_build_command: npm ci && npm run build
hf_oauth: true
tags:
  - reachy_mini
  - reachy_mini_js_app
---

# Reachy Reflex

A social-attention layer for Reachy Mini. Sixteen typed Jev judgments describe the room; deterministic policy chooses gaze, nods, posture, and local control events. Jev never sends motor commands directly.

This is a development preview, not a hardware-tested release. The browser app now has the Reachy Mini host shell, WebRTC camera attachment, local face-box detection, opt-in robot-stream sound-energy hints, opt-in local robot-stream ASR, an opt-in browser-device transcription path, a 16-signal panel, an authenticated local Jev relay, and an opt-in bounded motion adapter. Face detection, robot audio, browser microphone access inside the host, and motion have **not** been validated on a real robot. Robust VAD, direction-of-arrival, speaker attribution, Conversation App event integration, hosted relay deployment, and calibration are still missing. No attention accuracy, end-to-end latency, cost, or human-preference result is claimed.

## Run and verify

Node.js 20.19+ is required. `reachy-jev` is installed from a pinned commit of its [public source repository](https://github.com/AbdelStark/reachy-jev); no sibling checkout or registry release is required. npm runs that package's `prepare` build during installation. Review the pinned source when updating the dependency.

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Run `npm run dev` and open `http://127.0.0.1:5173/?preview=1` for a robot-free fixture preview. Its simulated person and answers exercise the panel and policy but are not Jev or hardware results. The browser suite covers the 16 gauges, room changes, opt-in transcript path with a fake recognizer, a synthetic connected-host text-only judgment with no motion, narrow viewport, and locally served MediaPipe WebAssembly files. Unit tests cover tracking, stale observations, relay boundaries, motion gating, and transcript bounds.

## Model-backed local use

Set `TYPESAFE_API_KEY` and a random `REFLEX_RELAY_TOKEN` of at least 32 characters in your local shell, then run `npm run relay` separately. It binds to `127.0.0.1:8048`, allows only `REFLEX_ALLOWED_ORIGIN` (default `http://127.0.0.1:5173`), bounds body size, concurrency, and requests per minute, and never logs state or credentials. Enter the URL and session token in the browser app; the token is held only in that tab. Do not put the TypeSafe API key in Vite variables, browser JavaScript, or a static Space secret.

The browser host follows Pollen Robotics' pinned [Reachy Mini JS app guide](https://github.com/pollen-robotics/reachy_mini/blob/main/ts/APP_CREATION_GUIDE.md) using SDK 1.8.0. Camera frames remain in the browser. MediaPipe WebAssembly ships with the built app. At build time, the face model is fetched from Google's versioned model URL and checked against SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`; the browser then loads it from the app's origin. Local dev serves the same verified asset. Face tracking remains off until the user enables it. MediaPipe 1.0.1 can send usage/performance metrics to Google when initialized; [Google's privacy notice](https://github.com/google-ai-edge/mediapipe#privacy-notice) says it does not send frames. This is not a fully offline path. Only bucketed room state, plus separately consented final transcript fields, reaches Jev through the relay.

Robot sound-energy hints use the pinned host SDK's `media.robotStream` audio track only after the connected user enables the separate toggle. A Web Audio analyser is never connected to speakers; a 1,024-sample window is reduced locally to RMS level and a coarse threshold flag, then the shared room-state builder converts the level into a word bucket before relay transmission. The app does not retain or send raw robot audio. The threshold flag is **not** reliable VAD: it can fire on noise or robot speech, and gives no direction or speaker identity. Turning it off closes the analyser without stopping the host-owned track. If the robot stream has no live audio track, no sound state is sent. This path has unit tests but no on-robot validation.

Browser transcription requires two explicit actions: check the microphone/data-sharing disclosure, then press **Start transcription**. The host permits iframe microphone capture but does not start it automatically. This path uses this device's microphone, **not** Reachy's microphone. The browser's `SpeechRecognition` may process audio on a vendor server and is unavailable in some browsers. The app keeps at most two final utterances of 200 characters each for 30 seconds in tab memory, labels their speaker `unknown`, and sends that text with room state to the configured relay only while sharing is enabled. Interim results are ignored; no audio is recorded by the app. Unchecking consent or pressing Stop clears local text and aborts recognition, but cannot retract a request already in flight. The fixture browser test uses a fake recognizer, not a real microphone or vendor service.

Robot-stream transcription is a separate local-only option. Install `requirements-asr.txt` in a separate Python environment, supply an existing self-contained converted faster-whisper model directory, set a fresh `REFLEX_ASR_TOKEN` of at least 32 printable ASCII characters, and run `python3 -m server.local_asr --model-path /path/to/local/model`. The optional model is **not bundled or downloaded** by Reflex; CPU/int8 inference is forced with `local_files_only=True`. The ASR server listens on `127.0.0.1:8051` and accepts only the exact browser origin (`http://127.0.0.1:5173` by default, configurable with `--origin`). Set that URL and token in the app, check the robot-audio disclosure after obtaining consent from people nearby, then press **Start robot transcription**. The host's `media.robotStream` audio is segmented in-tab by an energy threshold and sent as bounded 16 kHz PCM to that local process. Only final text enters the same 30-second, two-utterance buffer, marked `unknown`, and can reach Jev through the separately configured relay. Browser-device and robot-stream transcription cannot run simultaneously. Turning either off clears its recent text and aborts pending ASR, but an already-started relay call cannot be recalled. The energy threshold is not robust VAD: ambient noise, Reachy playback, and overlapping voices can be missegmented. It provides no DoA, echo cancellation, or speaker identification. Do not expose either loopback service to the network. The worklet/browser test uses a synthetic oscillator and fake ASR, not a robot or real model.

When face tracking is off or unavailable, a consented **final transcript** can still trigger the 16-signal Jev panel. That request contains no camera-derived person IDs; the speaker stays `unknown`, the decision reads “Audio only · motion off,” and no robot command is sent. Sound-energy hints alone do not start a text-only judgment. When the 30-second final-text window expires or consent is withdrawn, the panel returns to idle/stale and discards a late text-only response. This path may incur relay/model calls while recent text is present; it has a fake-host browser test, not an on-robot result.

Faces have session-only IDs `p1`–`p9`, expire after 60 seconds, and are tracked by box overlap, not recognized. The default 60° camera field of view is an uncalibrated estimate; resulting bearing and distance are approximate. Movement remains off until a connected user enables both face tracking and experimental robot motion. Even then, motion is held if the source answer is over 750 ms old, either camera frame is over 500 ms old, face IDs or bearings change materially, or tracking/motion is toggled during the call. Cached answers keep their original source age instead of being treated as fresh. The panel may still show a judgment when motion is held. These are application-level freshness limits, not calibrated safety thresholds; SDK and firmware limits and physical stop controls remain independent requirements. A fake-host browser test covers slow and cached answers, not robot timing. See [SECURITY.md](SECURITY.md).

The Hugging Face Space frontmatter is build metadata, not evidence of a deployed Space. A hosted static Space needs a separate HTTPS relay with authentication, rate limits, and a strict origin allowlist; a viewer's browser cannot reach your loopback relay. See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and [CITATION.cff](CITATION.cff).
