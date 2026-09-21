# Security and privacy

Reflex's judgments are not a safety controller. Keep motion inside Reachy Mini's SDK and firmware limits and preserve physical stop controls. Motion is opt-in and must stop on stale judgments or lost video; do not bypass that gate when integrating a new sensor or host. The 60° camera FOV is uncalibrated, so face-bearing estimates are not safety-grade.

The browser sends frames only to local MediaPipe inference. The build/dev server fetches a versioned Google model and verifies its SHA-256; the browser loads both model and WebAssembly from the app's origin. MediaPipe 1.0.1 attempts usage-metrics requests to Google after initialization, so face tracking is opt-in and the UI discloses this. The upstream [privacy notice](https://github.com/google-ai-edge/mediapipe#privacy-notice) says input frames stay on-device and users may need informed consent for metrics. We do not claim the browser is fully offline.

The local relay binds to loopback, requires a long bearer token, allowlists one exact origin, rate-limits calls, caps bodies, and does not log state. It is not a production HTTPS service. Do not place a TypeSafe API key in a browser bundle. If transcription is added later, obtain consent, cap text, and keep it in data fields as untrusted input. Report vulnerabilities privately through GitHub without credentials or personal recordings.
