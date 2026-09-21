/** Opt-in robot-stream utterance segmentation and authenticated local ASR. */

const OUTPUT_RATE = 16_000;
const MAX_SECONDS = 12;
const FRAME_MS = 20;
const MIN_PCM_BYTES = OUTPUT_RATE; // 0.25 seconds of float32 samples.
const MAX_PCM_BYTES = OUTPUT_RATE * MAX_SECONDS * 4;

function pcm16k(samples: Float32Array, sampleRate: number): Uint8Array {
  const count = Math.floor(samples.length * OUTPUT_RATE / sampleRate);
  const output = new Uint8Array(count * 4);
  const view = new DataView(output.buffer);
  for (let index = 0; index < count; index++) {
    const at = index * sampleRate / OUTPUT_RATE;
    const left = Math.floor(at);
    const fraction = at - left;
    const sample = samples[left]! * (1 - fraction) + samples[Math.min(left + 1, samples.length - 1)]! * fraction;
    view.setFloat32(index * 4, sample, true);
  }
  return output;
}

/** Energy delimiter, not robust VAD, direction finding, or speaker attribution. */
export class EnergySegmenter {
  private readonly frameSamples: number;
  private pending = new Float32Array();
  private preroll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private voiceFrames = 0;
  private silenceFrames = 0;

  constructor(readonly sampleRate: number, readonly thresholdRms = 0.018) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) throw new RangeError("invalid robot audio rate");
    if (!Number.isFinite(thresholdRms) || thresholdRms <= 0 || thresholdRms > 1) throw new RangeError("invalid energy threshold");
    this.frameSamples = Math.round(sampleRate * FRAME_MS / 1_000);
  }

  reset(): void {
    this.pending.fill(0);
    this.pending = new Float32Array();
    for (const frame of [...this.preroll, ...this.frames]) frame.fill(0);
    this.preroll = [];
    this.frames = [];
    this.voiceFrames = 0;
    this.silenceFrames = 0;
  }

  private finish(): Uint8Array | undefined {
    const frames = this.frames;
    this.frames = [];
    this.preroll = [];
    const voiceFrames = this.voiceFrames;
    this.voiceFrames = 0;
    this.silenceFrames = 0;
    if (voiceFrames < 10) { frames.forEach((frame) => frame.fill(0)); return undefined; }
    const merged = new Float32Array(frames.length * this.frameSamples);
    for (const [index, frame] of frames.entries()) { merged.set(frame, index * this.frameSamples); frame.fill(0); }
    const output = pcm16k(merged, this.sampleRate);
    merged.fill(0);
    return output;
  }

  feed(samples: Float32Array): Uint8Array[] {
    if (!(samples instanceof Float32Array) || !samples.length || samples.length > this.sampleRate) throw new RangeError("invalid robot audio chunk");
    for (const sample of samples) if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new RangeError("invalid robot audio sample");
    const joined = new Float32Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    this.pending.fill(0);
    const completed: Uint8Array[] = [];
    let offset = 0;
    while (offset + this.frameSamples <= joined.length) {
      const frame = joined.slice(offset, offset + this.frameSamples);
      offset += this.frameSamples;
      let power = 0;
      for (const sample of frame) power += sample * sample;
      const voiced = Math.sqrt(power / frame.length) >= this.thresholdRms;
      if (!this.frames.length) {
        if (!voiced) {
          this.preroll.push(frame);
          if (this.preroll.length > 10) this.preroll.shift()!.fill(0);
          continue;
        }
        this.frames = [...this.preroll, frame];
        this.preroll = [];
        this.voiceFrames = 1;
      } else {
        this.frames.push(frame);
        if (voiced) { this.voiceFrames++; this.silenceFrames = 0; }
        else this.silenceFrames++;
      }
      if (this.silenceFrames >= 30 || this.frames.length >= MAX_SECONDS * 1_000 / FRAME_MS) {
        const pcm = this.finish();
        if (pcm) completed.push(pcm);
      }
    }
    this.pending = joined.slice(offset);
    joined.fill(0);
    return completed;
  }
}

export class LocalRobotAsrPort {
  private readonly endpoint: URL;

  constructor(baseURL: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new TypeError("ASR URL must be numeric loopback HTTP with a port");
    if (!/^[\x20-\x7e]{32,}$/.test(token)) throw new TypeError("ASR token must be at least 32 printable ASCII characters");
    this.endpoint = new URL("/v1/asr", url);
  }

  async transcribe(pcm: Uint8Array, signal?: AbortSignal): Promise<string> {
    if (!(pcm instanceof Uint8Array) || pcm.length < MIN_PCM_BYTES || pcm.length > MAX_PCM_BYTES || pcm.length % 4) throw new RangeError("invalid bounded 16 kHz PCM");
    const body = new Uint8Array(pcm);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await this.fetcher.call(globalThis, this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${this.token}` },
        body: body.buffer,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Local robot ASR returned HTTP ${response.status}`);
      if (!response.body) throw new TypeError("missing ASR response body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 1_024) throw new RangeError("ASR response too large");
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const encoded = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { encoded.set(chunk, offset); offset += chunk.length; }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded));
      encoded.fill(0);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid ASR response");
      const record = value as Record<string, unknown>;
      if (Object.keys(record).join() !== "text" || typeof record.text !== "string" || record.text.length > 200) throw new TypeError("invalid ASR transcript");
      return record.text.trim();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      body.fill(0);
    }
  }
}

/** One bounded in-flight segment; additional segments are dropped, never queued. */
export class RobotSpeechInput {
  private context: AudioContext | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private node: AudioWorkletNode | undefined;
  private segmenter: EnergySegmenter | undefined;
  private request: AbortController | undefined;
  private epoch = 0;
  private active = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly asr: LocalRobotAsrPort,
    private readonly onFinal: (text: string) => void,
    private readonly onStatus: (status: "segment" | "busy" | "error") => void,
  ) {}

  async start(): Promise<void> {
    if (this.active || this.context) throw new Error("robot speech input already started");
    const epoch = ++this.epoch;
    const track = this.stream.getAudioTracks().find((candidate) => candidate.readyState === "live");
    if (!track) throw new Error("robot audio track unavailable");
    const context = new AudioContext();
    this.context = context;
    try {
      await context.audioWorklet.addModule("/robot-voice-worklet.js");
      if (epoch !== this.epoch) throw new Error("robot speech startup cancelled");
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const node = new AudioWorkletNode(context, "reflex-robot-voice");
      const segmenter = new EnergySegmenter(context.sampleRate);
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.active || epoch !== this.epoch) return;
        try {
          for (const pcm of segmenter.feed(event.data)) {
            if (this.request) { pcm.fill(0); this.onStatus("busy"); continue; }
            this.onStatus("segment");
            void this.transcribe(pcm, epoch);
          }
        } catch { this.stop(); this.onStatus("error"); }
      };
      source.connect(node);
      node.connect(context.destination); // Processor writes no samples.
      this.source = source;
      this.node = node;
      this.segmenter = segmenter;
      this.active = true;
      await context.resume();
      if (epoch !== this.epoch || context.state !== "running") throw new Error("robot speech input unavailable");
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  private async transcribe(pcm: Uint8Array, epoch: number): Promise<void> {
    const request = new AbortController();
    this.request = request;
    try {
      const text = await this.asr.transcribe(pcm, request.signal);
      if (this.active && epoch === this.epoch && !request.signal.aborted && text.trim()) this.onFinal(text);
    } catch {
      if (this.active && epoch === this.epoch && !request.signal.aborted) this.onStatus("error");
    } finally {
      pcm.fill(0);
      if (this.request === request) this.request = undefined;
    }
  }

  stop(): void {
    this.epoch++;
    this.active = false;
    this.request?.abort();
    this.request = undefined;
    this.segmenter?.reset();
    this.segmenter = undefined;
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) { this.node.port.onmessage = null; this.node.port.close(); }
    void this.context?.close();
    this.context = undefined;
    this.source = undefined;
    this.node = undefined;
    // The host owns the MediaStream and tracks; never stop them here.
  }
}
