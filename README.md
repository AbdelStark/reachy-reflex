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

This is a development preview, not a hardware-tested release. The browser app now has the Reachy Mini host shell, WebRTC camera attachment, local face-box detection, a 16-signal panel, an authenticated local Jev relay, and an opt-in bounded motion adapter. Face detection and motion have **not** been validated on a real robot. VAD, speech transcription, direction-of-arrival, Conversation App event integration, hosted relay deployment, and calibration are still missing. No attention accuracy, end-to-end latency, cost, or human-preference result is claimed.

## Run and verify

Node.js 20.19+ and a sibling checkout of `reachy-jev` are currently required (`file:../reachy-jev`). The shared package must become independently installable before public release.

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Run `npm run dev` and open `http://127.0.0.1:5173/?preview=1` for a robot-free fixture preview. Its simulated person and answers exercise the panel and policy but are not Jev or hardware results. The browser suite covers the 16 gauges, room changes, narrow viewport, and locally served MediaPipe WebAssembly files. Unit tests cover tracking, stale observations, relay boundaries, and motion gating.

## Model-backed local use

Set `TYPESAFE_API_KEY` and a random `REFLEX_RELAY_TOKEN` of at least 32 characters in your local shell, then run `npm run relay` separately. It binds to `127.0.0.1:8048`, allows only `REFLEX_ALLOWED_ORIGIN` (default `http://127.0.0.1:5173`), bounds body size, concurrency, and requests per minute, and never logs state or credentials. Enter the URL and session token in the browser app; the token is held only in that tab. Do not put the TypeSafe API key in Vite variables, browser JavaScript, or a static Space secret.

The browser host follows Pollen Robotics' pinned [Reachy Mini JS app guide](https://github.com/pollen-robotics/reachy_mini/blob/main/ts/APP_CREATION_GUIDE.md) using SDK 1.8.0. Camera frames remain in the browser. MediaPipe WebAssembly ships with the built app. At build time, the face model is fetched from Google's versioned model URL and checked against SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`; the browser then loads it from the app's origin. Local dev serves the same verified asset. Face tracking remains off until the user enables it. MediaPipe 1.0.1 can send usage/performance metrics to Google when initialized; [Google's privacy notice](https://github.com/google-ai-edge/mediapipe#privacy-notice) says it does not send frames. This is not a fully offline path. Only bucketed room state, plus any future consented transcript fields, reaches Jev through the relay. The current live path has no ASR, so it does not send utterances.

Faces have session-only IDs `p1`–`p9`, expire after 60 seconds, and are tracked by box overlap, not recognized. The default 60° camera field of view is an uncalibrated estimate; resulting bearing and distance are approximate. Movement remains off until a connected user enables both face tracking and experimental robot motion, and the app suppresses commands on stale judgments or missing video. SDK and firmware limits and physical stop controls remain independent requirements. See [SECURITY.md](SECURITY.md).

The Hugging Face Space frontmatter is build metadata, not evidence of a deployed Space. A hosted static Space needs a separate HTTPS relay with authentication, rate limits, and a strict origin allowlist; a viewer's browser cannot reach your loopback relay.
