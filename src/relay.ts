import type { JevResponse } from "reachy-jev";
import type { ReflexEvent } from "./policy.js";

export class RelayError extends Error {
  constructor(readonly status: number) { super(`Jev relay returned HTTP ${status}`); }
}

/** Browser-side transport; TypeSafe credentials never enter this bundle. */
export class RelayTransport {
  private readonly endpoint: URL;
  private readonly eventsEndpoint: URL;
  readonly localEventBridge: boolean;
  constructor(baseURL: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new TypeError("relay must use HTTPS or loopback HTTP");
    if (url.username || url.password || url.search || url.hash) throw new TypeError("relay URL must not contain credentials or query data");
    if (token.length < 32) throw new TypeError("relay token must be at least 32 characters");
    this.endpoint = new URL("/v1/systemone", url);
    this.eventsEndpoint = new URL("/v1/events", url);
    this.localEventBridge = url.protocol === "http:" && url.hostname === "127.0.0.1";
  }
  async ask(state: unknown, questions: unknown): Promise<JevResponse> {
    const response = await this.fetcher.call(globalThis, this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ state, questions }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new RelayError(response.status);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("answers" in data) || !data.answers || typeof data.answers !== "object" || Array.isArray(data.answers)) throw new TypeError("invalid Jev relay response");
    return data as JevResponse;
  }

  /** Publish a typed local control hint; subscriber count is not delivery proof. */
  async publishEvent(event: ReflexEvent): Promise<number> {
    if (!this.localEventBridge) throw new TypeError("event publishing requires a numeric loopback relay");
    const response = await this.fetcher.call(globalThis, this.eventsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(1500),
    });
    if (response.status !== 202) throw new RelayError(response.status);
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("accepted" in value) || value.accepted !== true
      || !("subscribers" in value) || !Number.isSafeInteger(value.subscribers) || (value.subscribers as number) < 0) {
      throw new TypeError("invalid event bridge response");
    }
    return value.subscribers as number;
  }
}
