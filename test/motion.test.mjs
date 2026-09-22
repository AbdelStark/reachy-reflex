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
  assert.equal(controller.apply(output, 0), "held");
  controller.setEnabled(true);
  assert.equal(controller.apply(output, 0), "accepted");
  assert.equal(controller.apply({ ...output, nod: true }, 250), "accepted");
  assert.equal(controller.apply(output, 500), "held");
  assert.equal(controller.apply(output, 750), "accepted");
  robot.state = "disconnected";
  assert.equal(controller.apply(output, 1000), "unavailable");
  robot.state = "streaming";
  assert.equal(controller.apply(output, 1250), "held");
  controller.setEnabled(true);
  assert.equal(controller.apply(output, 1500), "accepted");
  assert.deepEqual(calls.map(([kind]) => kind), ["set", "goto", "set", "set"]);
});

test("an SDK-rejected pose disarms the controller until explicit re-enable", () => {
  const calls = [];
  let accepts = false;
  const robot = { state: "streaming", setTarget: () => { calls.push("set"); return accepts; }, gotoTarget: () => { calls.push("goto"); return accepts; } };
  const controller = new RobotMotionController(robot);
  const output = { target: attend(-18), gaze: "p1", events: [], idle: false, nod: false };
  controller.setEnabled(true);
  assert.equal(controller.apply(output, 0), "rejected");
  assert.equal(controller.apply(output, 250), "held");
  accepts = true;
  controller.setEnabled(true);
  assert.equal(controller.apply(output, 500), "accepted");
  accepts = false;
  assert.equal(controller.apply({ ...output, nod: true }, 750), "rejected");
  assert.equal(controller.apply(output, 1000), "held");
  assert.deepEqual(calls, ["set", "set", "goto"]);
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
