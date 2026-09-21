import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "reachy-jev";
import { ReflexEngine } from "../dist/index.js";

function answers() {
  return {
    attention_target: { type: "choice", choice: "p1", confidence: 0.9 },
    addressed: { type: "noul", noul: 0.2 }, addressed_by_gaze: { type: "noul", noul: 0.2 },
    pause_invites_ack: { type: "noul", noul: 0.1 }, being_ignored: { type: "noul", noul: 0.1 },
    wants_reply: { type: "noul", noul: 0.1 }, someone_leaving: { type: "noul", noul: 0.1 }, someone_arriving: { type: "noul", noul: 0.1 },
    turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
    engagement: { type: "score", score: 2.5 }, speaker_mood: { type: "choice", choice: "neutral", confidence: 0.8 },
    group_talking_to_each_other: { type: "noul", noul: 0.1 }, robot_named: { type: "noul", noul: 0.1 }, question_asked: { type: "noul", noul: 0.1 }, laughter_moment: { type: "noul", noul: 0.1 }, silence_awkward: { type: "noul", noul: 0.1 },
  };
}
const observation = { people: [{ id: "p1", bearingDeg: -20, faceHeightFraction: 0.25 }] };

test("one engine tick batches bank questions, then cached tick skips network", async () => {
  let calls = 0;
  let request;
  const client = new JevClient({ ask: async (state, questions) => {
    calls++;
    request = { state, questions };
    return { model: "jev-test", answers: answers() };
  } });
  const engine = new ReflexEngine(client);
  const first = await engine.tick(observation, 0);
  const second = await engine.tick(observation, 250);
  assert.equal(first.output.gaze, "none");
  assert.equal(second.output.gaze, "p1");
  assert.equal(second.skipped, true);
  assert.equal(first.panel.gauges.length, 16);
  assert.equal(first.panel.gauges.find((gauge) => gauge.key === "engagement").p, 0.625);
  assert.equal(second.panel.skipped, true);
  assert.equal(second.panel.model, "jev-test");
  assert.equal(calls, 1);
  assert.equal(Object.keys(request.questions).length, 16);
  assert.deepEqual(request.questions.attention_target.criteria, { p1: null, none: null });
  assert.equal(request.state.schema, "room_state@1");
});

test("wrong answer kind never actuates from model data", async () => {
  const wrong = answers();
  wrong.attention_target = { type: "noul", noul: 0.9 };
  const engine = new ReflexEngine(new JevClient({ ask: async () => ({ answers: wrong }) }));
  const result = await engine.tick(observation, 0);
  assert.equal(result.stale, true);
  assert.equal(result.output.idle, true);
  assert.equal(result.output.events.length, 0);
  assert.deepEqual(result.panel, { gauges: [], stale: true });
});

test("unknown person choice is rejected before policy and panel projection", async () => {
  const wrong = answers();
  wrong.attention_target = { type: "choice", choice: "p999999999999999999999999", confidence: 0.99 };
  const engine = new ReflexEngine(new JevClient({ ask: async () => ({ answers: wrong }) }));
  const result = await engine.tick(observation, 0);
  assert.equal(result.stale, true);
  assert.equal(result.output.gaze, "none");
  assert.deepEqual(result.panel, { gauges: [], stale: true });
});

test("network failure leaves robot in idle rather than producing a new motion decision", async () => {
  const engine = new ReflexEngine(new JevClient({ ask: async () => { throw new Error("unauthorized"); } }));
  const result = await engine.tick(observation, 0);
  assert.equal(result.stale, true);
  assert.equal(result.output.idle, true);
  assert.deepEqual(result.panel, { gauges: [], stale: true });
});
