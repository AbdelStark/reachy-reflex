import test from "node:test";
import assert from "node:assert/strict";
import { RobotSoundInput, soundReading } from "../dist/sound.js";
import { buildRoomState } from "reachy-jev";

test("sound energy is bounded, bucketed, and contains no raw audio", () => {
  const silent = soundReading(new Float32Array(1024));
  assert.deepEqual(silent, { levelDbfs: -100, voiceDetected: false });
  const quiet = soundReading(new Float32Array(1024).fill(0.01));
  assert.equal(quiet.voiceDetected, false);
  const active = soundReading(new Float32Array(1024).fill(0.1));
  assert.equal(active.voiceDetected, true);
  assert.ok(Math.abs(active.levelDbfs + 20) < 0.001);
  const state = buildRoomState({ sound: active });
  assert.deepEqual(state.sound, { level: "conversational", voice_detected: true });
  assert.equal(JSON.stringify(state).includes("0.1"), false);
});

test("invalid sample windows fail rather than creating misleading sound state", () => {
  assert.throws(() => soundReading(new Float32Array()), RangeError);
  assert.throws(() => soundReading(new Float32Array([Number.NaN])), RangeError);
  assert.throws(() => soundReading(new Float32Array([1.2])), RangeError);
});

test("robot stream analyser starts only on demand and never drives a speaker", async () => {
  const originalContext = globalThis.AudioContext;
  const originalStream = globalThis.MediaStream;
  const events = [];
  const track = { readyState: "live", stop() { events.push("track_stop"); } };
  class FakeStream {
    constructor(tracks = [track]) { this.tracks = tracks; }
    getAudioTracks() { return this.tracks; }
  }
  class FakeContext {
    state = "suspended";
    createMediaStreamSource(stream) {
      assert.deepEqual(stream.getAudioTracks(), [track]);
      return { connect(target) { events.push(["connect", target]); }, disconnect() { events.push("source_disconnect"); } };
    }
    createAnalyser() {
      const analyser = {
        fftSize: 0,
        getFloatTimeDomainData(samples) { samples.fill(0.1); },
        disconnect() { events.push("analyser_disconnect"); },
      };
      events.push(["analyser", analyser]);
      return analyser;
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; events.push("context_close"); }
  }
  globalThis.MediaStream = FakeStream;
  globalThis.AudioContext = FakeContext;
  try {
    const input = new RobotSoundInput(new FakeStream());
    assert.equal(input.snapshot(), undefined);
    await input.start();
    assert.equal(input.snapshot().voiceDetected, true);
    assert.deepEqual(events[1], ["connect", events[0][1]]);
    track.readyState = "ended";
    assert.equal(input.snapshot(), undefined);
    input.stop();
    assert.equal(input.snapshot(), undefined);
    assert.equal(events.includes("track_stop"), false);
    assert.ok(events.includes("context_close"));
  } finally {
    globalThis.AudioContext = originalContext;
    globalThis.MediaStream = originalStream;
  }
});
