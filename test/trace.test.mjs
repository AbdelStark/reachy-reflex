import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "reachy-jev";
import { ReflexEngine, SessionTrace, TRACE_SCHEMA, MAX_TRACE_ROWS } from "../dist/index.js";
import { fixtureAsk } from "../dist/fixture.js";

test("trace keeps inspectable judgment and dispatch data without raw text or image fields", async () => {
  const engine = new ReflexEngine(new JevClient({ ask: fixtureAsk }));
  const observation = {
    people: [{ id: "p1", bearingDeg: -12, faceHeightFraction: 0.3 }],
    transcriptRecent: [{ who: "unknown", text: "PRIVATE_WORDS_NEVER_EXPORT", endedSecondsAgo: 0 }],
  };
  const tick = await engine.tick(observation, 100);
  tick.answers.turn_action.probabilities = { interrupt: 0.1, secret: "PRIVATE_ANSWER_FIELD" };
  const trace = new SessionTrace();
  trace.add(observation, tick, 130, "held", 1);
  observation.people[0].bearingDeg = 40;
  const raw = trace.toJSONL();
  const record = JSON.parse(raw.trim());
  assert.equal(record.schema, TRACE_SCHEMA);
  assert.equal(record.policy_epoch, 1);
  assert.deepEqual(record.people, [{ id: "p1", bearing_deg: -12 }]);
  assert.equal(record.recent_text_present, true);
  assert.equal(record.answers.addressed, 0.2);
  assert.equal(record.decision.motion, "held");
  assert.equal(record.model, "fixture-only");
  assert.ok(!raw.includes("PRIVATE_WORDS_NEVER_EXPORT"));
  assert.ok(!raw.includes("PRIVATE_ANSWER_FIELD"));
  assert.ok(!raw.includes("faceHeightFraction"));
  assert.ok(!raw.includes("transcript"));
  trace.add({ people: [{ id: "PRIVATE_PERSON", bearingDeg: 5 }] }, tick, 140, "off", 1);
  assert.ok(!trace.toJSONL().includes("PRIVATE_PERSON"));
  assert.throws(() => trace.add(observation, tick, 150, "PRIVATE_MOTION", 1), TypeError);
  assert.throws(() => trace.add(observation, tick, 150, "off", 0), RangeError);
  assert.throws(() => trace.add(observation, tick, 140, "off", 1), RangeError);
});

test("trace bounds session rows, records stale calls, and clears without persistence", async () => {
  const engine = new ReflexEngine(new JevClient({ ask: async () => { throw new Error("PRIVATE_FAILURE"); } }));
  const tick = await engine.tick({ people: [] }, 0);
  const trace = new SessionTrace();
  for (let i = 0; i < MAX_TRACE_ROWS + 3; i++) trace.add({ people: [] }, tick, i * 250, "off", 0);
  assert.equal(trace.count, MAX_TRACE_ROWS);
  const rows = trace.toJSONL().trim().split("\n").map(JSON.parse);
  assert.equal(rows[0].elapsed_ms, 750);
  assert.equal(rows.at(-1).stale, true);
  assert.equal(rows.at(-1).decision.motion, "off");
  assert.ok(!trace.toJSONL().includes("PRIVATE_FAILURE"));
  trace.clear();
  assert.equal(trace.count, 0);
  assert.equal(trace.toJSONL(), "");
});
