import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "reachy-jev";
import { ReflexEngine, SessionTrace } from "../dist/index.js";
import { fixtureAsk } from "../dist/fixture.js";
import { replayTrace } from "../scripts/replay_trace.mjs";

async function recordedFixture() {
  const engine = new ReflexEngine(new JevClient({ ask: fixtureAsk }));
  const trace = new SessionTrace();
  const observation = { people: [{ id: "p1", bearingDeg: -12, faceHeightFraction: 0.3 }] };
  for (const nowMs of [0, 250]) {
    const tick = await engine.tick(observation, nowMs);
    trace.add(observation, tick, nowMs, "off", 0);
  }
  engine.invalidate();
  const afterReset = await engine.tick(observation, 500);
  trace.add(observation, afterReset, 500, "held", 1);
  return trace.toJSONL();
}

test("exported text-free ticks replay across a policy reset", async () => {
  const jsonl = await recordedFixture();
  assert.deepEqual(replayTrace(jsonl), { rows: 3, epochs: 2, mismatches: [] });
  assert.ok(!jsonl.includes("faceHeightFraction"));
  assert.ok(!jsonl.includes("transcript"));
});

test("replay exposes policy drift and a missing reset boundary", async () => {
  const rows = (await recordedFixture()).trim().split("\n").map(JSON.parse);
  rows[1].decision.gaze = "none";
  rows[1].decision.private_note = "PRIVATE_TEXT_NEVER_REPORT";
  const drift = replayTrace(rows.map(JSON.stringify).join("\n"));
  assert.equal(drift.mismatches[0].line, 2);
  assert.equal(JSON.stringify(drift).includes("PRIVATE_TEXT_NEVER_REPORT"), false);
  rows[1].decision.gaze = "p1";
  rows[2].policy_epoch = 0;
  assert.equal(replayTrace(rows.map(JSON.stringify).join("\n")).mismatches[0].line, 3);
});

test("replay rejects malformed, out-of-order, and older trace schemas", async () => {
  const rows = (await recordedFixture()).trim().split("\n").map(JSON.parse);
  assert.throws(() => replayTrace("not json"), /invalid JSON/);
  assert.throws(() => replayTrace(JSON.stringify({ ...rows[0], schema: "reflex.tick@1" })), /invalid trace row/);
  assert.throws(() => replayTrace(JSON.stringify({ ...rows[0], robot_speaking_known: "yes" })), /invalid trace row/);
  assert.throws(() => replayTrace(JSON.stringify({ ...rows[0], robot_speaking_known: false, robot_speaking: true })), /invalid trace row/);
  const legacy = rows.map(({ robot_speaking_known, ...row }) => ({ ...row, schema: "reflex.tick@2" }));
  assert.deepEqual(replayTrace(legacy.map(JSON.stringify).join("\n")), { rows: 3, epochs: 2, mismatches: [] });
  assert.throws(() => replayTrace(JSON.stringify({ ...rows[0], policy_epoch: -1 })), /invalid trace row/);
  assert.throws(() => replayTrace(JSON.stringify({ ...rows[0], answers: { ...rows[0].answers, addressed: 1.5 } })), /invalid recorded answers/);
  assert.throws(() => replayTrace(JSON.stringify({ ...rows[0], people: [rows[0].people[0], rows[0].people[0]] })), /invalid trace row/);
  rows[2].policy_clock_ms = 100;
  assert.throws(() => replayTrace(rows.map(JSON.stringify).join("\n")), /not increasing/);
});
