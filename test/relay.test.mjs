import test from "node:test";
import assert from "node:assert/strict";
import { createRelayServer } from "../server/relay.mjs";
import { RelayTransport } from "../dist/relay.js";

const token = "r".repeat(40);
const origin = "http://127.0.0.1:5173";
const body = { state: { schema: "room_state@1", people: [] }, questions: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`q${i}`, { type: "noul", instructions: "fixture" }])) };

test("browser relay URL and credentials are constrained", () => {
  assert.throws(() => new RelayTransport("http://example.com", token), TypeError);
  assert.throws(() => new RelayTransport("https://user:pass@example.com", token), TypeError);
  assert.throws(() => new RelayTransport("http://127.0.0.1:8048", "short"), TypeError);
});

test("local relay authenticates, checks origin and shape, and forwards exactly one call", async () => {
  let calls = 0;
  const server = createRelayServer({ token, allowedOrigin: origin, ask: async () => { calls++; return { model: "fixture", answers: { addressed: { type: "noul", noul: 0.8 } } }; } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    const post = (headers, payload = body) => fetch(`${url}/v1/systemone`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
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
