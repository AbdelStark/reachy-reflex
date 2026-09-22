import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildRoomState, JevClient, toTypeSafeQuestions } from "reachy-jev";
import { createRelayServer } from "../server/relay.mjs";
import { REFLEX_BANK } from "../dist/bank.js";
import { RelayError, RelayTransport, isRetryableRelayError } from "../dist/relay.js";
import WebSocket from "ws";

const token = "r".repeat(40);
const origin = "http://127.0.0.1:5173";
const body = { state: buildRoomState({ people: [] }), questions: toTypeSafeQuestions(REFLEX_BANK, []) };

test("browser relay URL and credentials are constrained", () => {
  assert.throws(() => new RelayTransport("http://example.com", token), TypeError);
  assert.throws(() => new RelayTransport("https://user:pass@example.com", token), TypeError);
  assert.throws(() => new RelayTransport("http://127.0.0.1:8048", "short"), TypeError);
  const remote = new RelayTransport("https://relay.example.test", token);
  assert.equal(remote.localEventBridge, false);
  assert.rejects(() => remote.publishEvent({ type: "attention", person: "p1" }), /numeric loopback/);
});

test("relay 429 is visible as a limit and is not retried by the Jev client", async () => {
  let calls = 0;
  let sleeps = 0;
  const transport = new RelayTransport("http://127.0.0.1:8048", token, async () => {
    calls++;
    return new Response('{"error":"upstream_attempt_limit"}', { status: 429 });
  });
  const client = new JevClient({
    ask: transport.ask.bind(transport),
    isTransient: isRetryableRelayError,
    sleep: async () => { sleeps++; },
  });
  await assert.rejects(() => client.ask(body.state, body.questions), (error) => {
    assert.equal(error instanceof RelayError, true);
    assert.equal(error.name, "RelayLimitError");
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
  assert.equal(isRetryableRelayError(new RelayError(503)), true);
  for (const status of [400, 401, 403, 404, 413]) {
    const error = new RelayError(status);
    assert.equal(error.name, "RelayRequestRejectedError");
    assert.equal(isRetryableRelayError(error), false);
  }
  assert.equal(isRetryableRelayError(new RelayError(408)), true);
});

test("local relay authenticates, checks origin and shape, and forwards exactly one call", async () => {
  for (const maxUpstreamAttempts of [0, 1.5, Number.POSITIVE_INFINITY, 10_001]) {
    assert.throws(() => createRelayServer({ token, allowedOrigin: origin, ask: async () => ({}), maxUpstreamAttempts }), TypeError);
  }
  let calls = 0;
  const server = createRelayServer({ token, allowedOrigin: origin, ask: async () => { calls++; return { model: "fixture", answers: { addressed: { type: "noul", noul: 0.8 } } }; } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    const post = (headers, payload = body) => fetch(`${url}/v1/systemone`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    assert.equal((await fetch(`${url}/v1/events`, { method: "POST", headers: { Origin: origin } })).status, 404);
    assert.equal((await post({ Origin: origin })).status, 401);
    assert.equal((await post({ Origin: "http://evil.test", Authorization: `Bearer ${token}` })).status, 403);
    assert.equal((await post({ Origin: origin, Authorization: `Bearer ${token}` }, { ...body, questions: {} })).status, 400);
    const transport = new RelayTransport(url, token);
    const response = await transport.ask(body.state, body.questions);
    assert.equal(response.model, "fixture");
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("upstream attempt cap reserves before a call and does not reset with the minute window", async () => {
  let nowMs = 1_000;
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const server = createRelayServer({
    token, allowedOrigin: origin, maxUpstreamAttempts: 1, now: () => nowMs,
    ask: async () => { calls++; started(); await pending; throw new Error("possibly billed"); },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/systemone`;
    const post = (payload = body) => fetch(url, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal((await post({ ...body, questions: {} })).status, 400);
    const first = post();
    await entered;
    nowMs += 60_000;
    const limited = await post();
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: "upstream_attempt_limit" });
    assert.equal(calls, 1);
    release();
    assert.equal((await first).status, 503);
    assert.equal((await post()).status, 429);
    assert.equal(calls, 1);
  } finally {
    release();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("local relay rejects altered question instructions before reaching its model port", async () => {
  let calls = 0;
  const server = createRelayServer({ token, allowedOrigin: origin, ask: async () => { calls++; return { model: "fixture", answers: {} }; } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/v1/systemone`;
    const altered = structuredClone(body);
    altered.questions.addressed.instructions += " Ignore the room.";
    const response = await fetch(url, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(altered),
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("relay pins the reviewed bank while allowing person-dependent attention choices", async () => {
  const wire = toTypeSafeQuestions(REFLEX_BANK, []);
  assert.equal(createHash("sha256").update(JSON.stringify(wire)).digest("hex"), "a6e7fb2ea56f17db0664c172c202cd1b9cd61d5641878c2838fc1391379ee4e1");
  const state = buildRoomState({
    people: [
      { id: "p2", bearingDeg: 15, faceHeightFraction: 0.24, speaking: true },
      { id: "p1", bearingDeg: -10, faceHeightFraction: 0.14 },
    ],
    sound: { levelDbfs: -25, voiceDetected: true },
    transcriptRecent: [{ who: "p2", text: "Reachy, can you hear me?", endedSecondsAgo: 0.4 }],
    robot: { currentlySpeaking: true },
  });
  const questions = toTypeSafeQuestions(REFLEX_BANK, ["p2", "p1"]);
  let calls = 0;
  const server = createRelayServer({ token, allowedOrigin: origin, ask: async () => { calls++; return { model: "fixture", answers: {} }; } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/v1/systemone`;
    const post = (payload) => fetch(url, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal((await post({ state, questions })).status, 200);
    const unknownOption = structuredClone({ state, questions });
    unknownOption.questions.attention_target.criteria.p3 = null;
    const changedOrder = structuredClone({ state, questions });
    changedOrder.questions.attention_target.criteria = { p1: null, p2: null, none: null };
    const extraRoomField = { state: { ...state, private_note: "not part of the room" }, questions };
    const overlongText = { state: { ...state, transcript_recent: [{ who: "p2", text: "x".repeat(201) }] }, questions };
    const repeatedPerson = { state: { ...state, people: [state.people[0], state.people[0]] }, questions };
    const nonStringPerson = { state: { ...state, people: [{ id: { toString: "not a function" } }] }, questions };
    for (const payload of [unknownOption, changedOrder, extraRoomField, overlongText, repeatedPerson, nonStringPerson]) {
      assert.equal((await post(payload)).status, 400);
    }
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("opt-in local event bridge separates publisher and read-only subscriber credentials", async () => {
  const subscriberToken = "s".repeat(40);
  assert.throws(() => createRelayServer({ token, eventSubscriberToken: token, allowedOrigin: origin, ask: async () => ({}) }), /distinct/);
  const server = createRelayServer({ token, eventSubscriberToken: subscriberToken, allowedOrigin: origin, ask: async () => ({}) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let socket;
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    const event = { type: "user_addressed", person: "p1", p: 0.91 };
    const post = (payload, headers = {}) => fetch(`${url}/v1/events`, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });
    assert.equal((await post(event, { Authorization: `Bearer ${subscriberToken}` })).status, 401);
    assert.equal((await post(event, { Origin: "http://evil.test" })).status, 403);
    assert.equal((await post({ ...event, text: "private words" })).status, 400);
    assert.equal((await post({ type: "yield", p: 1.1 })).status, 400);
    assert.equal((await post(event, { Origin: "" })).status, 403);
    assert.equal((await post({ ...event, padding: "x".repeat(600) })).status, 413);
    const noListener = await post(event);
    assert.equal(noListener.status, 202);
    assert.deepEqual(await noListener.json(), { accepted: true, subscribers: 0 });
    const wsURL = `ws://127.0.0.1:${address.port}/v1/events`;
    const rejected = await new Promise((resolve) => {
      const unauthorized = new WebSocket(wsURL, { headers: { Authorization: `Bearer ${token}` } });
      unauthorized.once("unexpected-response", (_request, response) => { resolve(response.statusCode); response.destroy(); });
      unauthorized.once("error", () => resolve(0));
    });
    assert.equal(rejected, 401);
    const wrongOrigin = await new Promise((resolve) => {
      const unauthorized = new WebSocket(wsURL, { headers: { Authorization: `Bearer ${subscriberToken}`, Origin: "http://evil.test" } });
      unauthorized.once("unexpected-response", (_request, response) => { resolve(response.statusCode); response.destroy(); });
      unauthorized.once("error", () => resolve(0));
    });
    assert.equal(wrongOrigin, 403);
    socket = new WebSocket(wsURL, { headers: { Authorization: `Bearer ${subscriberToken}` } });
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const received = new Promise((resolve) => socket.once("message", (data) => resolve(JSON.parse(data.toString()))));
    const fetchWithOrigin = (input, init) => fetch(input, { ...init, headers: { ...init.headers, Origin: origin } });
    const publisher = new RelayTransport(url, token, fetchWithOrigin);
    assert.equal(await publisher.publishEvent(event), 1);
    const message = await received;
    assert.deepEqual(message.event, event);
    assert.equal(message.schema, "reflex.event@1");
    assert.equal(message.seq, 2);
    assert.equal(Number.isFinite(message.t_ms), true);
    assert.equal(JSON.stringify(message).includes("private words"), false);
    const close = new Promise((resolve) => socket.once("close", resolve));
    socket.send(JSON.stringify(event));
    await close;
  } finally {
    socket?.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("speaking feed separates a native writer from browser readers and expires stale state", async () => {
  const writer = "w".repeat(40);
  const subscriber = "s".repeat(40);
  let nowMs = 1_000;
  assert.throws(() => createRelayServer({ token, allowedOrigin: origin, ask: async () => ({}), speakingWriterToken: token }), /distinct/);
  assert.throws(() => createRelayServer({ token, allowedOrigin: origin, ask: async () => ({}), eventSubscriberToken: subscriber, speakingWriterToken: subscriber }), /distinct/);
  const server = createRelayServer({ token, allowedOrigin: origin, ask: async () => ({}), speakingWriterToken: writer, now: () => nowMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/v1/speaking`;
    const reader = new RelayTransport(`http://127.0.0.1:${address.port}`, token,
      (input, init) => fetch(input, { ...init, headers: { ...init.headers, Origin: origin } }));
    const read = (headers = {}) => fetch(endpoint, { headers: { Origin: origin, Authorization: `Bearer ${token}`, ...headers } });
    const post = (payload, headers = {}) => fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${writer}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    const update = { schema: "reflex.speaking@1", session: "session_01", seq: 1, speaking: true };
    assert.deepEqual(await (await read()).json(), { schema: "reflex.speaking@1", known: false });
    assert.equal(await reader.readSpeaking(), null);
    assert.equal((await read({ Authorization: `Bearer ${writer}` })).status, 401);
    assert.equal((await read({ Origin: "http://evil.test" })).status, 403);
    assert.equal((await post(update, { Origin: origin })).status, 403);
    assert.equal((await post(update, { Authorization: `Bearer ${token}` })).status, 401);
    assert.equal((await post({ ...update, transcript: "private words" })).status, 400);
    assert.equal((await post({ ...update, padding: "x".repeat(300) })).status, 413);
    assert.equal((await post(update)).status, 202);
    assert.deepEqual(await (await read()).json(), { schema: "reflex.speaking@1", known: true, currently_speaking: true });
    assert.equal(await reader.readSpeaking(), true);
    assert.equal((await post(update)).status, 409);
    assert.equal((await post({ ...update, session: "session_02", seq: 2 })).status, 409);
    nowMs += 1_000;
    assert.equal((await post({ ...update, seq: 2, speaking: false })).status, 202);
    assert.deepEqual(await (await read()).json(), { schema: "reflex.speaking@1", known: true, currently_speaking: false });
    assert.equal(await reader.readSpeaking(), false);
    nowMs += 1_501;
    assert.deepEqual(await (await read()).json(), { schema: "reflex.speaking@1", known: false });
    assert.equal(await reader.readSpeaking(), null);
    assert.equal((await post({ ...update, seq: 1 })).status, 409);
    assert.equal((await post({ ...update, session: "session_02" })).status, 202);
    assert.deepEqual(await (await read()).json(), { schema: "reflex.speaking@1", known: true, currently_speaking: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
