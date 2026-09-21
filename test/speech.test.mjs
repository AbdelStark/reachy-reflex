import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSpeechInput, RecentTranscripts } from "../dist/speech.js";

test("final transcripts are bounded, un-attributed, and expire", () => {
  const buffer = new RecentTranscripts();
  assert.equal(buffer.accept("  Reachy,\nare you there?  ", 1000), true);
  assert.equal(buffer.accept(" ", 1100), false);
  assert.equal(buffer.accept("x".repeat(250), 1200), true);
  assert.equal(buffer.accept("third", 1300), true);
  assert.deepEqual(buffer.snapshot(1800), [
    { who: "unknown", text: "x".repeat(200), endedSecondsAgo: 0.6 },
    { who: "unknown", text: "third", endedSecondsAgo: 0.5 },
  ]);
  assert.deepEqual(buffer.snapshot(31_301), []);
  buffer.accept("private", 32_000);
  buffer.clear();
  assert.deepEqual(buffer.snapshot(32_001), []);
  assert.throws(() => buffer.accept("bad", -1), RangeError);
});

class FakeRecognition {
  continuous = false;
  interimResults = true;
  lang = "";
  onresult = null;
  onerror = null;
  onend = null;
  started = false;
  aborted = false;
  start() { this.started = true; }
  abort() { this.aborted = true; }
}

test("browser input emits only unseen final results and aborts without late callbacks", () => {
  const recognitions = [];
  const finals = [];
  const statuses = [];
  const input = new BrowserSpeechInput(
    () => { const instance = new FakeRecognition(); recognitions.push(instance); return instance; },
    (text) => finals.push(text),
    (status) => statuses.push(status),
  );
  assert.equal(input.start(), true);
  const first = recognitions[0];
  assert.equal(first.started, true);
  assert.equal(first.continuous, true);
  assert.equal(first.interimResults, false);
  assert.equal(first.lang, "en-US");
  const event = { resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "ignore" } }, { isFinal: true, 0: { transcript: "hello" } }] };
  first.onresult(event);
  first.onresult({ ...event, resultIndex: 1 });
  assert.deepEqual(finals, ["hello"]);
  const late = first.onresult;
  input.stop();
  assert.equal(first.aborted, true);
  late(event);
  assert.deepEqual(finals, ["hello"]);
  assert.deepEqual(statuses, []);
  assert.equal(input.active, false);
  assert.equal(input.start(), true);
  recognitions[1].onerror();
  assert.deepEqual(statuses, ["error"]);
  assert.equal(input.active, false);
  assert.equal(input.start(), true);
  recognitions[2].onend();
  assert.deepEqual(statuses, ["error", "ended"]);
  assert.equal(recognitions[2].aborted, false);
});

test("unsupported or denied recognition never becomes active", () => {
  const missing = new BrowserSpeechInput(() => null, () => {}, () => {});
  assert.equal(missing.start(), false);
  const denied = new BrowserSpeechInput(() => ({ ...new FakeRecognition(), start() { throw new Error("denied"); } }), () => {}, () => {});
  assert.equal(denied.start(), false);
  assert.equal(denied.active, false);
});
