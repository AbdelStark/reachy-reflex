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

test("nine retired IDs cannot hide a newly detected face for a full minute", () => {
  const state = new PerceptionState();
  const original = Array.from({ length: 9 }, (_, index) => ({ x: index * 0.105, y: 0.2, width: 0.08, height: 0.3 }));
  const newcomer = { x: 0.95, y: 0.2, width: 0.04, height: 0.3 };
  assert.equal(state.acceptFaces(original, 0), false);
  assert.equal(state.snapshot(0).people.length, 9);
  assert.equal(state.acceptFaces([...original.slice(1), newcomer], 100), true);
  const people = state.snapshot(100).people;
  assert.equal(people.length, 9);
  assert.equal(people.at(-1)?.id, "p1");
  assert.deepEqual(people.slice(0, 8).map((person) => person.id), ["p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
});

test("an over-capacity frame cannot silently truncate people or retain prior perception", () => {
  const tracker = new FaceTracker();
  const state = new PerceptionState();
  const original = Array.from({ length: 9 }, (_, index) => ({ x: index * 0.105, y: 0.2, width: 0.08, height: 0.3 }));
  const newcomer = { x: 0.95, y: 0.2, width: 0.04, height: 0.3 };
  tracker.update(original, 0);
  state.acceptFaces(original, 0);
  assert.throws(() => tracker.update([...original.slice(1), newcomer, original[0]], 100), /too many faces/);
  assert.throws(() => state.acceptFaces([...original.slice(1), newcomer, original[0]], 100), /too many faces/);
  assert.equal(tracker.identityRevision, 0);
  assert.deepEqual(state.snapshot(100), { people: [] });
  assert.deepEqual(state.acceptFaces(original, 200), false);
  assert.deepEqual(state.snapshot(200).people.map((person) => person.id), ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"]);
});

test("missing video frames expire position observations and reset clears all tracks", () => {
  const state = new PerceptionState();
  state.acceptFaces([a], 100);
  assert.equal(state.snapshot(1099).people.length, 1);
  assert.deepEqual(state.snapshot(1101), { people: [] });
  state.clear();
  assert.deepEqual(state.snapshot(200).people, []);
});
