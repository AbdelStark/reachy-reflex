# Reachy Reflex

An attention and turn-taking layer for Reachy Mini. Sixteen typed Jev judgments describe the room; deterministic policy decides gaze, nods, posture, and local control events. The language model never commands motors directly.

The current release is a tested decision core with an SDK-shaped Jev transport boundary, not yet a browser or on-robot app. Camera/microphone perception, Reachy motion, the live panel, and Conversation App integration are still being built. No live Jev run, presence, latency, cost, or human-agreement target has been measured.

## Decision loop

At each tick, an app builds `room_state@1` using `reachy-jev`, asks the 16-question bank in one Jev call, then feeds validated answers to `ReflexPolicy.step`. The policy holds gaze changes until two identical ticks, limits nods to one per three seconds, only emits turn events while the robot is speaking, and returns to idle on stale answers.

Run `npm ci`, `npm run check`, and `npm test` on Node.js 20+. This checkout currently expects its sibling `reachy-jev` repository for local development. No key or hardware is required for tests.

This is not a safety controller. The Reachy SDK and firmware must enforce motion limits. See [SECURITY.md](SECURITY.md).
