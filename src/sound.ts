/** Opt-in, local-only energy reading from the robot's outbound audio track. */

import type { RoomObservation } from "reachy-jev";

export type SoundReading = NonNullable<RoomObservation["sound"]>;

/** Energy threshold is a coarse activity hint, not speech recognition or VAD. */
export function soundReading(samples: Float32Array): SoundReading {
  if (samples.length === 0) throw new RangeError("empty audio window");
  let sumSquares = 0;
  for (const value of samples) {
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw new RangeError("invalid audio sample");
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const levelDbfs = Math.max(-100, Math.min(0, 20 * Math.log10(Math.max(rms, 1e-5))));
  return { levelDbfs, voiceDetected: levelDbfs >= -35 };
}

export class RobotSoundInput {
  private context: AudioContext | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private analyser: AnalyserNode | undefined;
  private track: MediaStreamTrack | undefined;

  constructor(private readonly stream: MediaStream) {}

  async start(): Promise<void> {
    if (this.context) return;
    const track = this.stream.getAudioTracks().find((candidate) => candidate.readyState === "live");
    if (!track) throw new Error("Robot audio track is unavailable");
    const context = new AudioContext();
    try {
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser); // Deliberately never connect to speakers.
      await context.resume();
      if (context.state !== "running") throw new Error("Robot audio analysis did not start");
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.track = track;
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  snapshot(): SoundReading | undefined {
    if (!this.analyser || this.track?.readyState !== "live" || this.context?.state !== "running") return undefined;
    const samples = new Float32Array(this.analyser.fftSize);
    try {
      this.analyser.getFloatTimeDomainData(samples);
      return soundReading(samples);
    } finally {
      samples.fill(0);
    }
  }

  stop(): void {
    this.source?.disconnect();
    this.analyser?.disconnect();
    void this.context?.close();
    this.source = undefined;
    this.analyser = undefined;
    this.context = undefined;
    this.track = undefined;
    // The host owns the MediaStream and its tracks; never stop them here.
  }
}
