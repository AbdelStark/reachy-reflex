import test from "node:test";
import assert from "node:assert/strict";
import { toTypeSafeQuestions } from "reachy-jev";
import { REFLEX_BANK, ReflexPolicy } from "../dist/index.js";

const base = () => ({
  attention_target: { choice: "p1", confidence: 0.9 }, addressed: { noul: 0.2 }, addressed_by_gaze: { noul: 0.2 },
  pause_invites_ack: { noul: 0.1 }, being_ignored: { noul: 0.1 },
  turn_action: { choice: "keep_talking", confidence: 0.9 }, engagement: { score: 2 }, speaker_mood: { choice: "neutral", confidence: 0.8 },
});
const tick = (nowMs, answers = base(), extra = {}) => ({ nowMs, people: [{ id: "p1", bearingDeg: -20 }], mostRecentSpeaker: "p1", robotSpeaking: false, answers, stale: false, ...extra });

test("bank contains 16 typed questions and a dynamic person choice", () => {
  assert.equal(Object.keys(REFLEX_BANK.questions).length, 16);
  assert.deepEqual(REFLEX_BANK.questions.attention_target.options, ["$people.ids", "none"]);
  assert.equal(Object.keys(toTypeSafeQuestions(REFLEX_BANK, ["p1"])).length, 16);
  assert.deepEqual(toTypeSafeQuestions(REFLEX_BANK, []).attention_target.criteria, { none: null });
});

test("gaze requires two stable ticks but direct address snaps immediately", () => {
  const policy = new ReflexPolicy();
  assert.equal(policy.step(tick(0)).gaze, "none");
  assert.equal(policy.step(tick(250)).gaze, "p1");
  const newPolicy = new ReflexPolicy();
  const a = base(); a.addressed.noul = 0.8;
  const result = newPolicy.step(tick(0, a));
  assert.equal(result.gaze, "p1");
  assert.equal(result.events[0].type, "user_addressed");
});

test("nod fires on a rising edge, with refractory and speech inhibition", () => {
  const policy = new ReflexPolicy();
  const high = base(); high.pause_invites_ack.noul = 0.8;
  assert.equal(policy.step(tick(0, high)).nod, true);
  assert.equal(policy.step(tick(250, high)).nod, false);
  policy.step(tick(500));
  assert.equal(policy.step(tick(1000, high)).nod, false);
  policy.step(tick(2000));
  assert.equal(policy.step(tick(3200, high, { robotSpeaking: true })).nod, false);
  policy.step(tick(3400));
  assert.equal(policy.step(tick(3600, high)).nod, true);
});

test("turn events only fire during robot speech and stale answers return to idle", () => {
  const policy = new ReflexPolicy();
  const yieldAnswer = base(); yieldAnswer.turn_action = { choice: "yield", confidence: 0.8 };
  assert.equal(policy.step(tick(0, yieldAnswer)).events.some((e) => e.type === "yield"), false);
  const fresh = policy.step(tick(250, yieldAnswer, { robotSpeaking: true }));
  assert.equal(fresh.events.some((e) => e.type === "yield"), true);
  assert.equal(policy.step(tick(300, yieldAnswer, { robotSpeaking: true })).events.some((e) => e.type === "yield"), false);
  const stale = policy.step(tick(500, yieldAnswer, { stale: true }));
  assert.deepEqual(stale.target, fresh.target);
  assert.deepEqual(stale.events, []);
  assert.equal(policy.step(tick(2600, yieldAnswer, { stale: true })).idle, true);
});

test("new speaker can trigger a fresh address and a moderate address resets ignored timer", () => {
  const policy = new ReflexPolicy();
  const addressed = base(); addressed.addressed.noul = 0.8;
  const first = policy.step(tick(0, addressed));
  assert.equal(first.events.filter((e) => e.type === "user_addressed").length, 1);
  const second = policy.step({ ...tick(250, addressed), people: [{ id: "p2", bearingDeg: 15 }], mostRecentSpeaker: "p2" });
  assert.equal(second.events.find((e) => e.type === "user_addressed")?.person, "p2");

  const ignored = base(); ignored.being_ignored.noul = 0.8;
  policy.step(tick(1000, ignored));
  const partialAddress = base(); partialAddress.addressed.noul = 0.5; partialAddress.being_ignored.noul = 0.8;
  policy.step(tick(19_000, partialAddress));
  assert.notEqual(policy.step(tick(20_999, ignored)).target.zMm, -6);
});

test("ignored timer droops only after 20 seconds", () => {
  const policy = new ReflexPolicy();
  const ignored = base(); ignored.being_ignored.noul = 0.8;
  for (let ms = 0; ms < 20_000; ms += 1000) assert.notEqual(policy.step(tick(ms, ignored)).target.zMm, -6);
  assert.equal(policy.step(tick(20_000, ignored)).target.zMm, -6);
});

test("stale judgments break the ignored streak before a new droop timer starts", () => {
  const policy = new ReflexPolicy();
  const ignored = base(); ignored.being_ignored.noul = 0.8;
  policy.step(tick(0, ignored));
  policy.step(tick(10_000, ignored, { stale: true }));
  assert.notEqual(policy.step(tick(20_000, ignored)).target.zMm, -6);
  for (let ms = 21_000; ms < 40_000; ms += 1000) policy.step(tick(ms, ignored));
  assert.equal(policy.step(tick(40_000, ignored)).target.zMm, -6);
});

test("a hidden-tab gap cannot turn old ignored evidence into an immediate droop", () => {
  const policy = new ReflexPolicy();
  const ignored = base(); ignored.being_ignored.noul = 0.8;
  policy.step(tick(0, ignored));
  policy.step(tick(1000, ignored));
  assert.notEqual(policy.step(tick(30_000, ignored)).target.zMm, -6);
});

test("missing attention target drifts to idle scan after three seconds", () => {
  const policy = new ReflexPolicy();
  policy.step(tick(0));
  assert.equal(policy.step(tick(250)).gaze, "p1");
  const noTarget = base(); noTarget.attention_target = { choice: "none", confidence: 0.9 };
  assert.equal(policy.step(tick(500, noTarget)).gaze, "p1");
  assert.equal(policy.step(tick(3400, noTarget)).idle, false);
  const scan = policy.step(tick(3500, noTarget));
  assert.equal(scan.idle, true);
  assert.equal(scan.gaze, "none");
});
