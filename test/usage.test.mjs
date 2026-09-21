import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "reachy-jev";
import { UsageMeter, formatUsage } from "../dist/usage.js";

test("fresh model call is counted once; cache reuse is not a new charge receipt", async () => {
  let calls = 0;
  const meter = new UsageMeter();
  const client = new JevClient({ ask: meter.wrap(async () => {
    calls++;
    return { answers: {}, usage: { input_tokens: 120, output_tokens: 7 } };
  }) });
  await client.ask({ room: 1 }, { q: 1 });
  await client.ask({ room: 1 }, { q: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(meter.snapshot(), {
    reportedCalls: 1, inputTokens: 120, outputTokens: 7, unresolvedCalls: 0, pendingCalls: 0,
  });
});

test("missing, malformed, failed and late replies remain visible as unresolved", async () => {
  const seen = [];
  const meter = new UsageMeter((snapshot) => seen.push(snapshot));
  let release;
  const pending = meter.wrap(async () => new Promise((resolve) => { release = resolve; }))({}, {});
  assert.equal(meter.snapshot().pendingCalls, 1);
  release({ answers: {}, usage: { input_tokens: 10 } });
  await pending;
  await meter.wrap(async () => ({ answers: {}, usage: { input_tokens: -1, output_tokens: 4 } }))({}, {});
  await assert.rejects(meter.wrap(async () => { throw new Error("network lost"); })({}, {}));
  assert.deepEqual(meter.snapshot(), {
    reportedCalls: 0, inputTokens: 0, outputTokens: 0, unresolvedCalls: 3, pendingCalls: 0,
  });
  assert.ok(seen.some((snapshot) => snapshot.pendingCalls === 1));
  assert.match(formatUsage(meter.snapshot()), /Cost unavailable.*3 calls without complete usage/);
});

test("an old response after a context reset is still an observed transport receipt", async () => {
  let release;
  const meter = new UsageMeter();
  const client = new JevClient({ ask: meter.wrap(async () => new Promise((resolve) => { release = resolve; })) });
  const pending = client.ask({ room: 1 }, { q: 1 });
  await Promise.resolve();
  client.clear();
  release({ answers: {}, usage: { input_tokens: 45, output_tokens: 2 } });
  await pending;
  assert.deepEqual(meter.snapshot(), {
    reportedCalls: 1, inputTokens: 45, outputTokens: 2, unresolvedCalls: 0, pendingCalls: 0,
  });
});
