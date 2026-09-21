import type { JevResponse } from "reachy-jev";

export class RelayError extends Error {
  constructor(readonly status: number) { super(`Jev relay returned HTTP ${status}`); }
}

/** Browser-side transport; TypeSafe credentials never enter this bundle. */
export class RelayTransport {
  private readonly endpoint: URL;
  constructor(baseURL: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new TypeError("relay must use HTTPS or loopback HTTP");
    if (url.username || url.password || url.search || url.hash) throw new TypeError("relay URL must not contain credentials or query data");
    if (token.length < 32) throw new TypeError("relay token must be at least 32 characters");
    this.endpoint = new URL("/v1/systemone", url);
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
}
