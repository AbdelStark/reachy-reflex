/** Opt-in browser speech input. No audio is retained or sent by this module. */

export interface FinalTranscript { who: "unknown"; text: string; endedSecondsAgo: number }
interface StoredTranscript { text: string; endedAtMs: number }

/** Only final, recent text crosses into room state; speaker identity is unknown. */
export class RecentTranscripts {
  private items: StoredTranscript[] = [];

  accept(text: string, endedAtMs: number): boolean {
    if (!Number.isFinite(endedAtMs) || endedAtMs < 0) throw new RangeError("invalid transcript time");
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!clean) return false;
    this.items = [...this.items, { text: clean, endedAtMs }].slice(-2);
    return true;
  }

  snapshot(nowMs: number): FinalTranscript[] {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError("invalid snapshot time");
    this.items = this.items.filter(({ endedAtMs }) => nowMs >= endedAtMs && nowMs - endedAtMs <= 30_000);
    return this.items.map(({ text, endedAtMs }) => ({ who: "unknown", text, endedSecondsAgo: (nowMs - endedAtMs) / 1000 }));
  }

  clear(): void { this.items = []; }
}

export interface SpeechResultLike { isFinal: boolean; 0: { transcript: string } }
export interface SpeechEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

/** Explicit start only. Browser implementations may send microphone audio to a vendor. */
export class BrowserSpeechInput {
  private recognition: RecognitionLike | undefined;

  constructor(
    private readonly create: () => RecognitionLike | null,
    private readonly onFinal: (text: string) => void,
    private readonly onStatus: (status: "ended" | "error") => void,
  ) {}

  get active(): boolean { return this.recognition !== undefined; }

  start(): boolean {
    if (this.recognition) return true;
    const recognition = this.create();
    if (!recognition) return false;
    const seenFinal = new Set<number>();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      for (let i = Math.max(0, event.resultIndex); i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal || seenFinal.has(i)) continue;
        seenFinal.add(i);
        this.onFinal(result[0]?.transcript ?? "");
      }
    };
    recognition.onerror = () => { if (this.recognition === recognition) { this.stop(); this.onStatus("error"); } };
    recognition.onend = () => { if (this.recognition === recognition) { this.detach(false); this.onStatus("ended"); } };
    try {
      recognition.start();
      this.recognition = recognition;
      return true;
    } catch {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      return false;
    }
  }

  private detach(abort: boolean): void {
    const recognition = this.recognition;
    if (!recognition) return;
    this.recognition = undefined;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    if (abort) {
      try { recognition.abort(); }
      catch { /* The browser may already have ended this session. */ }
    }
  }

  stop(): void { this.detach(true); }
}

export function browserRecognition(): RecognitionLike | null {
  const browser = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}
