import test from "node:test";
import assert from "node:assert/strict";
import { EnergySegmenter, LocalRobotAsrPort } from "../dist/robot_speech.js";

function feedInChunks(segmenter, samples, chunkSize = 2048) {
  const results = [];
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    results.push(...segmenter.feed(samples.subarray(offset, offset + chunkSize)));
  }
  return results;
}

test("bounded energy segmentation yields 16 kHz final PCM without retaining noise", () => {
  const segmenter = new EnergySegmenter(48_000);
  const silence = new Float32Array(48_000 * 0.3);
  const voice = new Float32Array(48_000 * 0.4).fill(0.2);
  const ending = new Float32Array(48_000 * 0.8);
  assert.equal(feedInChunks(segmenter, silence).length, 0);
  assert.equal(feedInChunks(segmenter, voice).length, 0);
  const utterances = feedInChunks(segmenter, ending);
  assert.equal(utterances.length, 1);
  const pcm = utterances[0];
  assert.ok(pcm.length >= 16_000 * 4 * 0.9 && pcm.length <= 16_000 * 4 * 1.2);
  assert.ok(Math.abs(new DataView(pcm.buffer).getFloat32(16_000 * 4 * 0.2, true) - 0.2) < 0.01);
  segmenter.reset();
  assert.equal(feedInChunks(segmenter, ending).length, 0);
  assert.throws(() => segmenter.feed(new Float32Array([Number.NaN])), RangeError);
  assert.throws(() => segmenter.feed(new Float32Array([1.2])), RangeError);
});

test("brief noise is rejected and long speech is cut at the duration cap", () => {
  const short = new EnergySegmenter(16_000);
  assert.equal(feedInChunks(short, new Float32Array(16_000 * 0.1).fill(0.2)).length, 0);
  assert.equal(feedInChunks(short, new Float32Array(16_000)).length, 0);
  const long = new EnergySegmenter(16_000);
  const utterances = feedInChunks(long, new Float32Array(16_000 * 13).fill(0.2));
  assert.equal(utterances.length, 1);
  assert.ok(utterances[0].length <= 16_000 * 12 * 4);
});

test("numeric-loopback ASR accepts only bounded final text", async () => {
  const calls = [];
  const reply = (value) => new Response(JSON.stringify(value), { status: 200 });
  const port = new LocalRobotAsrPort("http://127.0.0.1:8051", "t".repeat(32), function (url, init) {
    assert.equal(this, globalThis);
    calls.push({ url: String(url), auth: init.headers.Authorization, bytes: init.body.byteLength });
    return Promise.resolve(reply({ text: "Reachy, look here" }));
  });
  assert.equal(await port.transcribe(new Uint8Array(16_000)), "Reachy, look here");
  assert.deepEqual(calls, [{ url: "http://127.0.0.1:8051/v1/asr", auth: `Bearer ${"t".repeat(32)}`, bytes: 16_000 }]);
  assert.throws(() => new LocalRobotAsrPort("https://remote.example", "t".repeat(32)), TypeError);
  assert.throws(() => new LocalRobotAsrPort("http://localhost:8051", "t".repeat(32)), TypeError);
  await assert.rejects(port.transcribe(new Uint8Array(10)), RangeError);
  const bad = new LocalRobotAsrPort("http://127.0.0.1:8051", "t".repeat(32), async () => reply({ text: "hello", who: "p1" }));
  await assert.rejects(bad.transcribe(new Uint8Array(16_000)), TypeError);
  const oversized = new LocalRobotAsrPort("http://127.0.0.1:8051", "t".repeat(32), async () => new Response("x".repeat(1_025)));
  await assert.rejects(oversized.transcribe(new Uint8Array(16_000)), RangeError);
});
