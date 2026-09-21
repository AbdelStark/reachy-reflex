import test from "node:test";
import assert from "node:assert/strict";
import { attend } from "reachy-jev";
import { RobotMotionController, motionEvidenceCurrent, toSdkTarget } from "../dist/motion.js";

test("SDK target conversion validates app limits and preserves right-left antennas", () => {
  const target = toSdkTarget({ ...attend(-18), rightAntennaDeg: 20, leftAntennaDeg: -20 });
  assert.equal(target.head.length, 16);
  assert.equal(target.antennas.length, 2);
  assert.ok(target.antennas[0] > 0 && target.antennas[1] < 0);
  assert.throws(() => toSdkTarget({ ...attend(0), yawDeg: 46 }), RangeError);
});

test("motion requires an explicit enable and active robot; nod holds continuous commands", () => {
  const calls = [];
  const robot = { state: "streaming", setTarget: (target) => { calls.push(["set", target]); return true; }, gotoTarget: (target) => { calls.push(["goto", target]); return true; } };
  const controller = new RobotMotionController(robot);
  const output = { target: attend(-18), gaze: "p1", events: [], idle: false, nod: false };
  assert.equal(controller.apply(output, 0), false);
  controller.setEnabled(true);
  assert.equal(controller.apply(output, 0), true);
  assert.equal(controller.apply({ ...output, nod: true }, 250), true);
  assert.equal(controller.apply(output, 500), false);
  assert.equal(controller.apply(output, 750), true);
  robot.state = "disconnected";
  assert.equal(controller.apply(output, 1000), false);
  assert.deepEqual(calls.map(([kind]) => kind), ["set", "goto", "set"]);
});

test("model motion requires a recent answer, fresh frames, and a stable set of face bearings", () => {
  const evidence = {
    startedAtMs: 1000, deliveredAtMs: 1250, observedFrameAtMs: 950, latestFrameAtMs: 1200,
    observedPeople: [{ id: "p1", bearingDeg: -12 }], latestPeople: [{ id: "p1", bearingDeg: -9 }],
  };
  assert.equal(motionEvidenceCurrent(evidence), true);
  assert.equal(motionEvidenceCurrent({ ...evidence, deliveredAtMs: 1800, latestFrameAtMs: 1780 }), false);
  assert.equal(motionEvidenceCurrent({ ...evidence, deliveredAtMs: 1500, latestFrameAtMs: 950 }), false);
  assert.equal(motionEvidenceCurrent({ ...evidence, observedFrameAtMs: 400 }), false);
  assert.equal(motionEvidenceCurrent({ ...evidence, latestPeople: [{ id: "p1", bearingDeg: 2 }] }), false);
  assert.equal(motionEvidenceCurrent({ ...evidence, latestPeople: [{ id: "p2", bearingDeg: -9 }] }), false);
  assert.equal(motionEvidenceCurrent({ ...evidence, latestPeople: [] }), false);
  assert.equal(motionEvidenceCurrent({ ...evidence, observedPeople: [], latestPeople: [] }), true);
  assert.equal(motionEvidenceCurrent({ ...evidence, startedAtMs: NaN }), false);
});
