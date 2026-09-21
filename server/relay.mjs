import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

const MAX_BODY = 32 * 1024;
const MAX_INFLIGHT = 2;
const MAX_PER_MINUTE = 300;
const MAX_EVENT_BYTES = 512;
const MAX_EVENT_SUBSCRIBERS = 8;
const MAX_EVENTS_PER_MINUTE = 600;
const MAX_SPEAKING_BYTES = 256;
const SPEAKING_TTL_MS = 1500;
const MAX_SPEAKING_PER_MINUTE = 120;
// Digest of the reviewed reflex.core@0.1.0 wire with no people. At request
// time only attention_target.criteria varies with the validated room IDs.
const QUESTION_HASH = "a6e7fb2ea56f17db0664c172c202cd1b9cd61d5641878c2838fc1391379ee4e1";
const BEARINGS = new Set(["far left", "left", "slightly left", "center", "slightly right", "right", "far right"]);
const DISTANCES = new Set(["very near", "near", "medium", "far"]);
const ELAPSED = new Set(["just now", "a few seconds", "about 10 seconds", "about half a minute", "about a minute", "over a minute", "never"]);
const RECENT_ELAPSED = new Set([...ELAPSED].filter((value) => value !== "never"));
const MOVING = new Set(["still", "shifting", "walking"]);
const SOUND_LEVELS = new Set(["silent", "quiet", "conversational", "loud"]);
const POSTURES = new Set(["idle", "attending", "nodding", "drooping"]);
const PERSON_KEYS = new Set(["id", "bearing", "distance", "facing_robot", "looking_at_robot", "speaking", "seconds_since_last_spoke", "moving"]);
const ROOM_KEYS = new Set(["schema", "people", "sound", "transcript_recent", "robot"]);
const SOUND_KEYS = new Set(["loudest_bearing", "level", "voice_detected"]);
const TRANSCRIPT_KEYS = new Set(["who", "text", "ended"]);
const ROBOT_KEYS = new Set(["currently_speaking", "looking_at", "seconds_since_own_last_turn", "posture"]);
const REQUEST_KEYS = new Set(["state", "questions"]);
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value, allowed, required = []) {
  return record(value) && Object.keys(value).every((key) => allowed.has(key))
    && required.every((key) => Object.hasOwn(value, key));
}
function validPerson(person) {
  return onlyKeys(person, PERSON_KEYS, ["id"]) && typeof person.id === "string" && /^p[1-9]$/.test(person.id)
    && (person.bearing === undefined || BEARINGS.has(person.bearing))
    && (person.distance === undefined || DISTANCES.has(person.distance))
    && (person.facing_robot === undefined || typeof person.facing_robot === "boolean")
    && (person.looking_at_robot === undefined || typeof person.looking_at_robot === "boolean")
    && (person.speaking === undefined || typeof person.speaking === "boolean")
    && (person.seconds_since_last_spoke === undefined || ELAPSED.has(person.seconds_since_last_spoke))
    && (person.moving === undefined || MOVING.has(person.moving));
}
function validRoom(state) {
  if (!onlyKeys(state, ROOM_KEYS, ["schema", "people"]) || state.schema !== "room_state@1"
    || !Array.isArray(state.people) || state.people.length > 9 || !state.people.every(validPerson)) return false;
  const ids = state.people.map((person) => person.id);
  if (new Set(ids).size !== ids.length) return false;
  if (state.sound !== undefined && (!onlyKeys(state.sound, SOUND_KEYS)
    || (state.sound.loudest_bearing !== undefined && !BEARINGS.has(state.sound.loudest_bearing))
    || (state.sound.level !== undefined && !SOUND_LEVELS.has(state.sound.level))
    || (state.sound.voice_detected !== undefined && typeof state.sound.voice_detected !== "boolean"))) return false;
  if (state.transcript_recent !== undefined && (!Array.isArray(state.transcript_recent)
    || state.transcript_recent.length > 4 || !state.transcript_recent.every((item) =>
      onlyKeys(item, TRANSCRIPT_KEYS, ["who", "text"])
      && typeof item.who === "string" && (item.who === "unknown" || /^p[1-9]$/.test(item.who))
      && typeof item.text === "string" && item.text.length <= 200
      && (item.ended === undefined || RECENT_ELAPSED.has(item.ended))))) return false;
  if (state.robot !== undefined && (!onlyKeys(state.robot, ROBOT_KEYS)
    || (state.robot.currently_speaking !== undefined && typeof state.robot.currently_speaking !== "boolean")
    || (state.robot.looking_at !== undefined && (typeof state.robot.looking_at !== "string"
      || (state.robot.looking_at !== "none" && !/^p[1-9]$/.test(state.robot.looking_at))))
    || (state.robot.seconds_since_own_last_turn !== undefined && !RECENT_ELAPSED.has(state.robot.seconds_since_own_last_turn))
    || (state.robot.posture !== undefined && !POSTURES.has(state.robot.posture)))) return false;
  return true;
}
function validQuestions(questions, ids) {
  if (!record(questions) || !record(questions.attention_target) || !record(questions.attention_target.criteria)) return false;
  const criteria = questions.attention_target.criteria;
  const names = Object.keys(criteria);
  if (names.length !== ids.length + 1 || names.some((name, index) => name !== (ids[index] ?? "none") || criteria[name] !== null)) return false;
  const pinned = { ...questions, attention_target: { ...questions.attention_target, criteria: { none: null } } };
  return createHash("sha256").update(JSON.stringify(pinned)).digest("hex") === QUESTION_HASH;
}

function send(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}
function authorized(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function validBody(body) {
  return onlyKeys(body, REQUEST_KEYS, ["state", "questions"])
    && validRoom(body.state) && validQuestions(body.questions, body.state.people.map((person) => person.id));
}

function validEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const keys = Object.keys(event).sort().join();
  const person = typeof event.person === "string" && /^p[1-9]$/.test(event.person);
  const probability = typeof event.p === "number" && Number.isFinite(event.p) && event.p >= 0 && event.p <= 1;
  if (event.type === "attention") return keys === "person,type" && person;
  if (event.type === "user_addressed") return keys === "p,person,type" && person && probability;
  if (event.type === "yield" || event.type === "interrupt") return keys === "p,type" && probability;
  return false;
}

function validSpeakingUpdate(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === "schema,seq,session,speaking"
    && value.schema === "reflex.speaking@1"
    && typeof value.session === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value.session)
    && Number.isSafeInteger(value.seq) && value.seq >= 1
    && typeof value.speaking === "boolean";
}

function rejectUpgrade(socket, status) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Local-only, authenticated and bounded Jev relay. Never logs state or secrets. */
export function createRelayServer({ token, allowedOrigin, ask, eventSubscriberToken, speakingWriterToken, now = Date.now }) {
  if (typeof token !== "string" || token.length < 32) throw new TypeError("relay token must be at least 32 characters");
  if (typeof allowedOrigin !== "string" || !/^https?:\/\/[^/]+$/.test(allowedOrigin)) throw new TypeError("invalid allowed origin");
  if (typeof ask !== "function") throw new TypeError("ask function required");
  if (eventSubscriberToken !== undefined && (typeof eventSubscriberToken !== "string" || eventSubscriberToken.length < 32 || eventSubscriberToken === token)) throw new TypeError("event subscriber token must be distinct and at least 32 characters");
  if (speakingWriterToken !== undefined && (typeof speakingWriterToken !== "string" || speakingWriterToken.length < 32 || speakingWriterToken === token || speakingWriterToken === eventSubscriberToken)) throw new TypeError("speaking writer token must be distinct and at least 32 characters");
  const events = eventSubscriberToken ? new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_EVENT_BYTES }) : undefined;
  events?.on("connection", (socket) => {
    socket.on("message", () => socket.close(1008, "read only"));
    socket.on("error", () => {});
  });
  let inflight = 0;
  let windowStart = now();
  let calls = 0;
  let eventWindowStart = now();
  let eventCalls = 0;
  let eventSequence = 0;
  let speakingWindowStart = now();
  let speakingCalls = 0;
  let speakingState;
  const speakingSequences = new Map();
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin === allowedOrigin ? allowedOrigin : undefined;
    if (request.headers.origin && !origin) return send(response, 403, { error: "origin_forbidden" });
    if (request.url === "/v1/speaking") {
      if (!speakingWriterToken) return send(response, 404, { error: "speaking_disabled" }, origin);
      if (request.method === "OPTIONS") {
        if (!origin) return send(response, 403, { error: "origin_forbidden" });
        response.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization",
          Vary: "Origin",
        });
        return response.end();
      }
      if (request.method === "GET") {
        if (!origin) return send(response, 403, { error: "origin_required" });
        if (!authorized(request.headers.authorization, token)) return send(response, 401, { error: "unauthorized" }, origin);
        const age = speakingState ? now() - speakingState.receivedAtMs : Infinity;
        const known = age >= 0 && age <= SPEAKING_TTL_MS;
        return send(response, 200, { schema: "reflex.speaking@1", known, ...(known ? { currently_speaking: speakingState.speaking } : {}) }, origin);
      }
      if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" }, origin);
      if (request.headers.origin) return send(response, 403, { error: "browser_write_forbidden" });
      if (!authorized(request.headers.authorization, speakingWriterToken)) return send(response, 401, { error: "unauthorized" });
      if (!request.headers["content-type"]?.startsWith("application/json")) return send(response, 415, { error: "json_required" });
      if (now() - speakingWindowStart >= 60_000) { speakingWindowStart = now(); speakingCalls = 0; }
      if (speakingCalls >= MAX_SPEAKING_PER_MINUTE) return send(response, 429, { error: "speaking_rate_limited" });
      speakingCalls++;
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_SPEAKING_BYTES) return send(response, 413, { error: "too_large" });
          chunks.push(chunk);
        }
        let update;
        try { update = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return send(response, 400, { error: "invalid_json" }); }
        if (!validSpeakingUpdate(update)) return send(response, 400, { error: "invalid_speaking_update" });
        const previousAge = speakingState ? now() - speakingState.receivedAtMs : Infinity;
        if ((speakingSequences.get(update.session) ?? 0) >= update.seq
          || (previousAge >= 0 && previousAge <= SPEAKING_TTL_MS && update.session !== speakingState.session)) {
          return send(response, 409, { error: "stale_speaking_update" });
        }
        speakingState = { session: update.session, seq: update.seq, speaking: update.speaking, receivedAtMs: now() };
        speakingSequences.set(update.session, update.seq);
        if (speakingSequences.size > 32) speakingSequences.delete(speakingSequences.keys().next().value);
        return send(response, 202, { accepted: true });
      } catch {
        return send(response, 503, { error: "speaking_unavailable" });
      }
    }
    if (request.url === "/v1/events") {
      if (!events) return send(response, 404, { error: "events_disabled" }, origin);
      if (request.method === "OPTIONS") {
        if (!origin) return send(response, 403, { error: "origin_forbidden" });
        response.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          Vary: "Origin",
        });
        return response.end();
      }
      if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" }, origin);
      if (!origin) return send(response, 403, { error: "origin_required" });
      if (!authorized(request.headers.authorization, token)) return send(response, 401, { error: "unauthorized" }, origin);
      if (!request.headers["content-type"]?.startsWith("application/json")) return send(response, 415, { error: "json_required" }, origin);
      if (now() - eventWindowStart >= 60_000) { eventWindowStart = now(); eventCalls = 0; }
      if (eventCalls >= MAX_EVENTS_PER_MINUTE) return send(response, 429, { error: "event_rate_limited" }, origin);
      eventCalls++;
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_EVENT_BYTES) return send(response, 413, { error: "too_large" }, origin);
          chunks.push(chunk);
        }
        let event;
        try { event = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return send(response, 400, { error: "invalid_json" }, origin); }
        if (!validEvent(event)) return send(response, 400, { error: "invalid_event" }, origin);
        const message = JSON.stringify({ schema: "reflex.event@1", seq: ++eventSequence, t_ms: now(), event });
        let subscribers = 0;
        for (const socket of events.clients) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          if (socket.bufferedAmount > 16_384) { socket.terminate(); continue; }
          socket.send(message);
          subscribers++;
        }
        return send(response, 202, { accepted: true, subscribers }, origin);
      } catch {
        return send(response, 503, { error: "event_unavailable" }, origin);
      }
    }
    if (request.url !== "/v1/systemone") return send(response, 404, { error: "not_found" }, origin);
    if (request.method === "OPTIONS") {
      if (!origin) return send(response, 403, { error: "origin_forbidden" });
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        Vary: "Origin",
      });
      return response.end();
    }
    if (request.method !== "POST") return send(response, 405, { error: "method_not_allowed" }, origin);
    if (!authorized(request.headers.authorization, token)) return send(response, 401, { error: "unauthorized" }, origin);
    if (!request.headers["content-type"]?.startsWith("application/json")) return send(response, 415, { error: "json_required" }, origin);
    if (now() - windowStart >= 60_000) { windowStart = now(); calls = 0; }
    if (calls >= MAX_PER_MINUTE || inflight >= MAX_INFLIGHT) return send(response, 429, { error: "busy" }, origin);
    calls++;
    inflight++;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) return send(response, 413, { error: "too_large" }, origin);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return send(response, 400, { error: "invalid_json" }, origin); }
      if (!validBody(body)) return send(response, 400, { error: "invalid_request" }, origin);
      const result = await ask(body.state, body.questions);
      return send(response, 200, { model: result.model, answers: result.answers, usage: result.usage }, origin);
    } catch {
      return send(response, 503, { error: "judgment_unavailable" }, origin);
    } finally {
      inflight--;
    }
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/v1/events" || !events) return rejectUpgrade(socket, "404 Not Found");
    if (request.headers.origin && request.headers.origin !== allowedOrigin) return rejectUpgrade(socket, "403 Forbidden");
    if (!authorized(request.headers.authorization, eventSubscriberToken)) return rejectUpgrade(socket, "401 Unauthorized");
    if (events.clients.size >= MAX_EVENT_SUBSCRIBERS) return rejectUpgrade(socket, "429 Too Many Requests");
    try { events.handleUpgrade(request, socket, head, (ws) => events.emit("connection", ws, request)); }
    catch { socket.destroy(); }
  });
  return server;
}
