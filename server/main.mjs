import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createRelayServer } from "./relay.mjs";

const token = process.env.REFLEX_RELAY_TOKEN;
const apiKey = process.env.TYPESAFE_API_KEY;
const allowedOrigin = process.env.REFLEX_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173";
const eventSubscriberToken = process.env.REFLEX_EVENT_SUBSCRIBER_TOKEN;
const port = Number(process.env.REFLEX_RELAY_PORT ?? "8048");
if (!apiKey || !token) throw new Error("TYPESAFE_API_KEY and REFLEX_RELAY_TOKEN are required");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("invalid relay port");
const client = new TypeSafeClient({ apiKey });
const server = createRelayServer({
  token,
  allowedOrigin,
  eventSubscriberToken,
  ask: (state, questions) => client.systemOne(
    { state, questions, model: "jev-latest" },
    { timeout: 5000, retry: { maxRetries: 0 } },
  ),
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Reflex relay listening on 127.0.0.1:${port} for ${allowedOrigin}\n`);
});
