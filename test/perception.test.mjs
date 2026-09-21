import test from "node:test";
import assert from "node:assert/strict";
import { FaceTracker, PerceptionState, overlap } from "../dist/perception.js";

const a = { x: 0.1, y: 0.2, width: 0.2, height: 0.3 };
const b = { x: 0.6, y: 0.2, width: 0.2, height: 0.3 };

test("IoU is bounded and rejects malformed normalized boxes", () => {
  assert.equal(overlap(a, a), 1);
  assert.equal(overlap(a, b), 0);
  assert.throws(() => overlap(a, { x: -1, y: 0, width: 1, height: 1 }), RangeError);
});

test("session-only IDs remain stable across small movements and recycle after expiry", () => {
  const tracker = new FaceTracker(60);
  const first = tracker.update([a, b], 0);
  assert.deepEqual(first.map((person) => person.id), ["p1", "p2"]);
  assert.equal(first[0].bearingDeg, -18);
  assert.equal(first[0].faceHeightFraction, 0.3);
  assert.deepEqual(tracker.update([{ ...a, x: 0.11 }, b], 100).map((person) => person.id), ["p1", "p2"]);
  assert.deepEqual(tracker.update([b, a], 150).map((person) => person.id), ["p2", "p1"]);
  assert.deepEqual(tracker.update([], 200), []);
  assert.equal(tracker.update([a], 300)[0].id, "p1");
  assert.equal(tracker.update([a], 60_301)[0].id, "p1");
});

test("missing video frames expire position observations and reset clears all tracks", () => {
  const state = new PerceptionState();
  state.acceptFaces([a], 100);
  assert.equal(state.snapshot(1099).people.length, 1);
  assert.deepEqual(state.snapshot(1101), { people: [] });
  state.clear();
  assert.deepEqual(state.snapshot(200).people, []);
});
