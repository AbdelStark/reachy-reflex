import test from "node:test";
import assert from "node:assert/strict";
import { REFLEX_BANK, ReflexPolicy } from "../dist/index.js";

const base = () => ({
  attention_target: { choice: "p1", confidence: 0.9 }, addressed: { noul: 0.2 }, addressed_by_gaze: { noul: 0.2 },
  pause_invites_ack: { noul: 0.1 }, being_ignored: { noul: 0.1 },
  turn_action: { choice: "keep_talking", confidence: 0.9 }, engagement: { score: "medium" }, speaker_mood: { choice: "neutral", confidence: 0.8 },
});
const tick = (nowMs, answers = base(), extra = {}) => ({ nowMs, people: [{ id: "p1", bearingDeg: -20 }], mostRecentSpeaker: "p1", robotSpeaking: false, answers, stale: false, ...extra });

test("bank contains 16 typed questions and a dynamic person choice", () => {
  assert.equal(Object.keys(REFLEX_BANK.questions).length, 16);
  assert.deepEqual(REFLEX_BANK.questions.attention_target.options, ["$people.ids", "none"]);
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
  const stale = policy.step(tick(500, yieldAnswer, { stale: true }));
  assert.deepEqual(stale.target, fresh.target);
  assert.deepEqual(stale.events, []);
  assert.equal(policy.step(tick(2600, yieldAnswer, { stale: true })).idle, true);
});

test("ignored timer droops only after 20 seconds", () => {
  const policy = new ReflexPolicy();
  const ignored = base(); ignored.being_ignored.noul = 0.8;
  assert.notDeepEqual(policy.step(tick(0, ignored)).target.zMm, -6);
  assert.equal(policy.step(tick(20_000, ignored)).target.zMm, -6);
});
