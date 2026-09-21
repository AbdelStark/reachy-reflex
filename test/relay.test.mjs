import test from "node:test";
import assert from "node:assert/strict";
import { createRelayServer } from "../server/relay.mjs";
import { RelayTransport } from "../dist/relay.js";
import WebSocket from "ws";

const token = "r".repeat(40);
const origin = "http://127.0.0.1:5173";
const body = { state: { schema: "room_state@1", people: [] }, questions: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`q${i}`, { type: "noul", instructions: "fixture" }])) };

test("browser relay URL and credentials are constrained", () => {
  assert.throws(() => new RelayTransport("http://example.com", token), TypeError);
  assert.throws(() => new RelayTransport("https://user:pass@example.com", token), TypeError);
  assert.throws(() => new RelayTransport("http://127.0.0.1:8048", "short"), TypeError);
  const remote = new RelayTransport("https://relay.example.test", token);
  assert.equal(remote.localEventBridge, false);
  assert.rejects(() => remote.publishEvent({ type: "attention", person: "p1" }), /numeric loopback/);
});

test("local relay authenticates, checks origin and shape, and forwards exactly one call", async () => {
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
