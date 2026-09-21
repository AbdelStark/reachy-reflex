# Reachy Reflex

An attention and turn-taking layer for Reachy Mini. Sixteen typed Jev judgments describe the room; deterministic policy decides gaze, nods, posture, and local control events. The language model never commands motors directly.

The current release is a tested decision core with an SDK-shaped Jev transport boundary and a validated projection for the shared `reachy-jev/panel` component. It is not yet a browser or on-robot app. Camera/microphone perception, Reachy motion, a mounted live panel, and Conversation App integration are still being built. No live Jev run, presence, latency, cost, or human-agreement target has been measured.

## Decision loop

At each tick, an app builds `room_state@1` using `reachy-jev`, asks the 16-question bank in one Jev call, then feeds validated answers to `ReflexPolicy.step`. The policy holds gaze changes until two identical ticks, limits nods to one per three seconds, only emits turn events while the robot is speaking, and returns to idle on stale answers.

`ReflexEngine.tick()` also returns a `panel` frame. A browser host can import `reachy-jev/panel`, mount `<jev-panel>`, and call `panel.update(tick.panel)`. The frame includes eight currently policy-relevant gauges plus model, latency, cache, and stale metadata. Invalid answer kinds and unknown person IDs produce an empty stale frame; the panel is display-only and never feeds motion decisions.

Run `npm ci`, `npm run check`, and `npm test` on Node.js 20+. This checkout currently expects its sibling `reachy-jev` repository for local development. No key or hardware is required for tests.

This is not a safety controller. The Reachy SDK and firmware must enforce motion limits. See [SECURITY.md](SECURITY.md).
