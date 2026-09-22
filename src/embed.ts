import { connectToHost } from "@pollen-robotics/reachy-mini-sdk/host/embed";
import { JevClient } from "reachy-jev";
import "reachy-jev/panel";
import type { JevPanelElement } from "reachy-jev/panel";
import { ReflexEngine } from "./engine.js";
import { fixtureAsk } from "./fixture.js";
import { RobotMotionController, motionEvidenceCurrent, type MotionEvidence } from "./motion.js";
import { PerceptionState } from "./perception.js";
import { RelayError, RelayTransport, isRetryableRelayError } from "./relay.js";
import { VideoFaceDetector } from "./vision.js";
import { BrowserSpeechInput, RecentTranscripts, browserRecognition } from "./speech.js";
import { RobotSoundInput } from "./sound.js";
import { LocalRobotAsrPort, RobotSpeechInput } from "./robot_speech.js";
import { SessionTrace, type MotionOutcome } from "./trace.js";
import { UsageMeter, formatUsage } from "./usage.js";
import "./style.css";

type Host = Awaited<ReturnType<typeof connectToHost>>;
type FaceDetectorPort = Pick<VideoFaceDetector, "detect" | "close">;
const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("root element missing");

export function mountApp(host?: Host, createFaceDetector: () => Promise<FaceDetectorPort> = () => VideoFaceDetector.create()): void {
  const preview = !host;
  root!.innerHTML = `
    <main class="app">
      <header class="masthead"><div class="brand-mark" aria-hidden="true">⚡</div><div><p class="eyebrow">Reachy Mini · attention layer</p><h1>Reflex</h1></div><span id="connection" class="connection"></span></header>
      <div class="layout">
        <section class="stage" aria-label="Room view and decisions">
          <div class="video-shell"><video id="robot-video" autoplay playsinline muted aria-label="Reachy Mini camera"></video><div id="video-fallback" class="video-fallback"></div><span class="video-label">ROOM PERCEPTION</span></div>
          <div class="stage-foot"><div><span class="metric-label">Visible people</span><strong id="person-count">0</strong></div><div><span class="metric-label">Tick</span><strong id="tick-count">0</strong></div><div><span class="metric-label">Decision</span><strong id="decision">Idle</strong></div></div>
          <div id="preview-controls" class="preview-controls" ${preview ? "" : "hidden"}><p>Fixture preview · no Jev call, camera, or robot motion.</p><button id="preview-person" type="button">Simulate a person</button><button id="preview-empty" type="button">Empty room</button></div>
        </section>
        <section class="brain" aria-label="Decision signals"><div class="brain-head"><div><p class="eyebrow">INSIDE THE LOOP</p><h2>Live judgment stream</h2><p id="stream-note">${preview ? "Deterministic fixture answers" : "Waiting for local Jev relay"}</p></div><button id="brain-fullscreen" type="button" aria-pressed="false">Full-screen panel</button></div><jev-panel id="jev-panel"></jev-panel><p id="usage-note" class="fine-print" role="status">${preview ? "Fixture preview · no model cost." : formatUsage({ reportedCalls: 0, inputTokens: 0, outputTokens: 0, unresolvedCalls: 0, pendingCalls: 0 })}</p><p class="fine-print">Gauges show typed judgments; code gates every motion. This display is not a safety controller.</p><p id="brain-fullscreen-status" class="fine-print" role="status">Panel in page. Full screen changes presentation only.</p></section>
      </div>
      <section class="controls" aria-label="Run controls"><div class="control-copy"><h2>Run the loop</h2><p>${preview ? "Inspect the interface with synthetic faces and answers." : "Only bucketed state is sent to the relay. The API key stays server-side. Face frames stay in this browser."}</p></div>
        <form id="relay-form" ${preview ? "hidden" : ""}><label>Relay URL<input id="relay-url" type="url" value="http://127.0.0.1:8048" required autocomplete="url"></label><label>Session token<input id="relay-token" type="password" required minlength="32" autocomplete="off"></label><button type="submit">Connect Jev relay</button></form>
        <label class="tracking-toggle" ${preview ? "hidden" : ""}><input id="tracking-enable" type="checkbox"><span>Enable face tracking. Frames stay here; MediaPipe may send usage metrics to Google.</span></label>
        <label class="tracking-toggle" ${preview ? "hidden" : ""}><input id="sound-enable" type="checkbox"><span>Use Reachy's incoming audio track for local sound-energy hints. No audio or raw samples are stored or sent to Jev; only a level bucket and coarse activity flag. This is not voice recognition, direction finding, or echo cancellation.</span></label>
        <p id="sound-status" role="status" aria-live="polite" ${preview ? "hidden" : ""}>Robot audio analysis off.</p>
        <label class="tracking-toggle robot-consent" ${preview ? "hidden" : ""}><input id="robot-speech-consent" type="checkbox"><span>Transcribe everyone audible on Reachy's incoming audio track. Audio segments go only to the configured local ASR process; up to two final texts (200 characters each) may go to Jev through the relay. This is an energy delimiter, not reliable VAD, direction finding, or speaker identity. Ask people nearby for consent first.</span></label>
        <div class="robot-asr-config" ${preview ? "hidden" : ""}><label>Local ASR URL<input id="robot-asr-url" type="url" value="http://127.0.0.1:8051" autocomplete="url"></label><label>ASR session token<input id="robot-asr-token" type="password" minlength="32" autocomplete="off"></label><button id="robot-speech-toggle" type="button">Start robot transcription</button></div>
        <p id="robot-speech-status" role="status" aria-live="polite" ${preview ? "hidden" : ""}>Robot transcription off; no robot audio sent to ASR.</p>
        <label class="tracking-toggle speech-consent"><input id="speech-consent" type="checkbox"><span>Use this device's microphone for browser speech recognition. The browser may send audio to its vendor; up to two final utterances (200 characters each) go to Jev through the configured relay. No speaker identity is inferred.</span></label>
        <button id="speech-toggle" type="button">Start transcription</button><p id="speech-status" role="status" aria-live="polite">Microphone off; no transcript is sent.</p>
        <label class="motion-toggle" ${preview ? "hidden" : ""}><input id="motion-enable" type="checkbox" disabled><span>Enable experimental robot motion</span></label>
        <label class="tracking-toggle" ${preview ? "hidden" : ""}><input id="events-enable" type="checkbox" disabled><span>Publish fresh, text-free control hints to the authenticated local event bridge. A separate local subscriber may receive person labels and probabilities; no speech or robot action is sent by this switch.</span></label>
        <p id="events-status" role="status" aria-live="polite" ${preview ? "hidden" : ""}>Local control events off.</p>
        <label class="tracking-toggle" ${preview ? "hidden" : ""}><input id="speaking-enable" type="checkbox" disabled><span>Use a separate local app's short-lived speaking-state assertion for turn-taking judgments. It needs a distinct relay writer token and regular updates; it is not proof that robot audio is playing or silent.</span></label>
        <p id="speaking-status" role="status" aria-live="polite" ${preview ? "hidden" : ""}>Speaking-state feed off; yield/interrupt hints unavailable.</p>
        <div class="trace-controls"><label class="tracking-toggle"><input id="trace-enable" type="checkbox"><span>Record a local, text-free judgment trace for this tab. Ask nearby people first; the export includes approximate face bearings and model answers, but no frames, audio, or transcript text.</span></label><div><button id="trace-download" type="button" disabled>Download trace JSONL</button><button id="trace-clear" type="button" disabled>Discard trace</button></div><p id="trace-status" role="status" aria-live="polite">Trace off. Nothing saved.</p></div>
        <p id="status" role="status" aria-live="polite">${preview ? "Preview running with fixture-only answers." : "Connect a relay before judging the room. Motion stays off until enabled."}</p>
      </section>
      <footer>Face boxes are local and approximate. No identity recognition. No live accuracy, latency, or hardware claim yet.</footer>
    </main>`;
  const q = <T extends HTMLElement>(selector: string): T => {
    const element = root!.querySelector<T>(selector);
    if (!element) throw new Error(`missing element: ${selector}`);
    return element;
  };
  const video = q<HTMLVideoElement>("#robot-video");
  const brain = q<HTMLElement>(".brain");
  const fullscreenButton = q<HTMLButtonElement>("#brain-fullscreen");
  const fullscreenStatus = q<HTMLElement>("#brain-fullscreen-status");
  const syncFullscreen = () => {
    const expanded = document.fullscreenElement === brain;
    fullscreenButton.textContent = expanded ? "Exit full screen" : "Full-screen panel";
    fullscreenButton.setAttribute("aria-pressed", String(expanded));
    fullscreenStatus.textContent = expanded
      ? "Full-screen panel view. Press Escape or the button to leave; this is display only."
      : "Panel in page. Full screen changes presentation only.";
  };
  if (!brain.requestFullscreen || !document.exitFullscreen) {
    fullscreenButton.disabled = true;
    fullscreenStatus.textContent = "Full screen is unavailable in this browser or host.";
  } else {
    fullscreenButton.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement === brain) await document.exitFullscreen();
        else await brain.requestFullscreen();
      } catch {
        fullscreenStatus.textContent = "Full screen was denied by this browser or host; panel remains in page.";
      }
    });
    document.addEventListener("fullscreenchange", syncFullscreen);
  }
  const panel = q<JevPanelElement>("#jev-panel");
  const usageNote = q<HTMLElement>("#usage-note");
  const motionToggle = q<HTMLInputElement>("#motion-enable");
  const trackingToggle = q<HTMLInputElement>("#tracking-enable");
  const soundToggle = q<HTMLInputElement>("#sound-enable");
  const soundStatus = q<HTMLElement>("#sound-status");
  const robotSpeechConsent = q<HTMLInputElement>("#robot-speech-consent");
  const robotSpeechToggle = q<HTMLButtonElement>("#robot-speech-toggle");
  const robotSpeechStatus = q<HTMLElement>("#robot-speech-status");
  const speechConsent = q<HTMLInputElement>("#speech-consent");
  const speechToggle = q<HTMLButtonElement>("#speech-toggle");
  const speechStatus = q<HTMLElement>("#speech-status");
  const eventsToggle = q<HTMLInputElement>("#events-enable");
  const eventsStatus = q<HTMLElement>("#events-status");
  const speakingToggle = q<HTMLInputElement>("#speaking-enable");
  const speakingStatus = q<HTMLElement>("#speaking-status");
  const traceToggle = q<HTMLInputElement>("#trace-enable");
  const traceDownload = q<HTMLButtonElement>("#trace-download");
  const traceClear = q<HTMLButtonElement>("#trace-clear");
  const traceStatus = q<HTMLElement>("#trace-status");
  const trace = new SessionTrace();
  const updateTraceStatus = () => {
    traceDownload.disabled = traceClear.disabled = trace.count === 0;
    traceStatus.textContent = `${traceToggle.checked ? "Recording" : "Trace off"}. ${trace.count} text-free ticks in this tab${preview ? " (fixture only)" : ""}.`;
  };
  traceToggle.addEventListener("change", () => { if (traceToggle.checked) invalidateJudgment(); updateTraceStatus(); });
  traceClear.addEventListener("click", () => { trace.clear(); if (traceToggle.checked) invalidateJudgment(); updateTraceStatus(); });
  traceDownload.addEventListener("click", () => {
    if (!trace.count) return;
    const url = URL.createObjectURL(new Blob([trace.toJSONL()], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "reflex-session.jsonl";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });
  const perception = new PerceptionState();
  const transcripts = new RecentTranscripts();
  let speechSharing = false;
  let robotSpeechSharing = false;
  let robotSpeech: RobotSpeechInput | undefined;
  let robotSpeechEpoch = 0;
  const stopRobotSpeech = (status: string) => {
    const wasRunning = robotSpeechSharing || robotSpeech !== undefined;
    robotSpeechEpoch++;
    robotSpeech?.stop();
    robotSpeech = undefined;
    robotSpeechSharing = false;
    if (wasRunning) transcripts.clear();
    if (wasRunning) invalidateJudgment();
    robotSpeechToggle.textContent = "Start robot transcription";
    robotSpeechStatus.textContent = status;
  };
  const speech = new BrowserSpeechInput(
    browserRecognition,
    (text) => {
      if (speechSharing && transcripts.accept(text, performance.now())) {
        invalidateJudgment();
        speechStatus.textContent = "Final utterance captured. Recent text may be sent to Jev for 30 seconds.";
      }
    },
    (status) => {
      speechToggle.textContent = "Start transcription";
      speechStatus.textContent = status === "error"
        ? "Speech recognition failed. Recent text stays for up to 30 seconds unless you uncheck consent."
        : "Recognition ended. Recent text stays for up to 30 seconds unless you uncheck consent.";
    },
  );
  speechToggle.disabled = !("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  if (speechToggle.disabled) speechStatus.textContent = "SpeechRecognition is unavailable in this browser; no transcript is sent.";
  speechConsent.addEventListener("change", () => {
    if (!speechConsent.checked) {
      speech.stop();
      speechSharing = false;
      if (!robotSpeechSharing) transcripts.clear();
      invalidateJudgment();
      speechToggle.textContent = "Start transcription";
      speechStatus.textContent = robotSpeechSharing ? "Device microphone off; robot transcription remains active." : "Microphone off; recent text cleared. An in-flight relay request cannot be recalled.";
    } else speechStatus.textContent = "Consent set for this tab. Press Start transcription to listen.";
  });
  speechToggle.addEventListener("click", () => {
    if (speech.active) {
      speech.stop();
      speechSharing = false;
      transcripts.clear();
      invalidateJudgment();
      speechToggle.textContent = "Start transcription";
      speechStatus.textContent = "Microphone off; recent text cleared. An in-flight relay request cannot be recalled.";
      return;
    }
    if (!speechConsent.checked) {
      speechStatus.textContent = "Check microphone consent before starting transcription.";
      return;
    }
    if (robotSpeechSharing) stopRobotSpeech("Robot transcription stopped; recent text cleared. An in-flight relay request cannot be recalled.");
    speechSharing = true;
    if (!speech.start()) {
      speechSharing = false;
      speechStatus.textContent = "Speech recognition could not start; check browser support and microphone permission.";
      return;
    }
    invalidateJudgment();
    speechToggle.textContent = "Stop transcription";
    speechStatus.textContent = "Listening on this device. Only final text is kept briefly in this tab.";
  });
  const motion = host ? new RobotMotionController(host.reachy) : undefined;
  let detector: FaceDetectorPort | undefined;
  let engine: ReflexEngine | undefined = preview ? new ReflexEngine(new JevClient({ ask: fixtureAsk })) : undefined;
  let relayTransport: RelayTransport | undefined;
  let relayPaused = false;
  let relayFailures = 0;
  let relayRetryAfterMs = 0;
  let speakingState: boolean | null = null;
  let speakingEpoch = 0;
  let speakingPollBusy = false;
  let ticks = 0;
  let active = true;
  const usageMeter = new UsageMeter((snapshot) => {
    if (active && !preview) usageNote.textContent = formatUsage(snapshot);
  });
  let busy = false;
  let lastVideoTime = -1;
  let lastFrameAtMs = -Infinity;
  let perceptionUnavailable = false;
  let detectorEpoch = 0;
  let motionEpoch = 0;
  let traceEpoch = 0;
  let lastMotionSource: Pick<MotionEvidence, "startedAtMs" | "observedFrameAtMs" | "observedPeople"> | undefined;
  let lastEventSource: Pick<MotionEvidence, "startedAtMs" | "observedFrameAtMs" | "observedPeople"> | undefined;
  function invalidateJudgment() {
    traceEpoch++;
    engine?.invalidate();
    lastMotionSource = undefined;
    lastEventSource = undefined;
  }
  const setSpeakingState = (next: boolean | null, message: string) => {
    if (speakingState !== next) {
      speakingState = next;
      invalidateJudgment();
    }
    speakingStatus.textContent = message;
  };
  speakingToggle.addEventListener("change", () => {
    speakingEpoch++;
    setSpeakingState(null, speakingToggle.checked
      ? "Waiting for a fresh authenticated local speaking assertion; turn hints held."
      : "Speaking-state feed off; yield/interrupt hints unavailable.");
  });
  async function pollSpeaking(): Promise<void> {
    if (!active || !speakingToggle.checked || !relayTransport || speakingPollBusy) return;
    speakingPollBusy = true;
    const transport = relayTransport;
    const epoch = speakingEpoch;
    try {
      const state = await transport.readSpeaking();
      if (!active || !speakingToggle.checked || relayTransport !== transport || epoch !== speakingEpoch) return;
      setSpeakingState(state, state === null
        ? "Local speaking assertion missing or expired; turn hints held."
        : state ? "Local app asserts Reachy may be speaking; turn hints are advisory."
          : "Local app asserts Reachy is quiet; this is not a playback-complete receipt.");
    } catch (error) {
      if (!active || relayTransport !== transport || epoch !== speakingEpoch) return;
      if (error instanceof RelayError && error.status === 404) {
        speakingToggle.checked = false;
        speakingEpoch++;
        setSpeakingState(null, "Relay speaking feed disabled; set a distinct writer token before starting it.");
      } else setSpeakingState(null, "Speaking feed unavailable; turn hints held until a fresh assertion arrives.");
    } finally { speakingPollBusy = false; }
  }
  const speakingTimer = window.setInterval(() => { void pollSpeaking(); }, 500);
  eventsToggle.addEventListener("change", () => {
    invalidateJudgment();
    eventsStatus.textContent = eventsToggle.checked
      ? "Local event publishing armed; waiting for fresh camera judgments and a subscriber."
      : "Local control events off.";
  });
  let soundEpoch = 0;
  let sound: RobotSoundInput | undefined;
  let audioOnlyActive = false;
  let fixturePerson = false;
  const detachVideo = host?.media.attachVideo(video);
  robotSpeechConsent.addEventListener("change", () => {
    if (!robotSpeechConsent.checked) stopRobotSpeech("Robot transcription off. Its recent text was cleared if active; an in-flight relay request cannot be recalled.");
    else robotSpeechStatus.textContent = "Consent set for this tab. Start only after people nearby have agreed.";
  });
  q<HTMLElement>("#connection").textContent = preview ? "FIXTURE PREVIEW" : "ROBOT CONNECTED";
  q<HTMLElement>("#video-fallback").textContent = preview ? "No camera in fixture preview" : "Waiting for robot video…";

  if (preview) {
    q<HTMLButtonElement>("#preview-person").addEventListener("click", () => { fixturePerson = true; invalidateJudgment(); });
    q<HTMLButtonElement>("#preview-empty").addEventListener("click", () => { fixturePerson = false; perception.clear(); invalidateJudgment(); });
  } else {
    robotSpeechToggle.addEventListener("click", () => {
      if (robotSpeechSharing) {
        stopRobotSpeech("Robot transcription stopped; recent text cleared. An in-flight relay request cannot be recalled.");
        return;
      }
      if (!robotSpeechConsent.checked) {
        robotSpeechStatus.textContent = "Check robot-audio consent before starting.";
        return;
      }
      const stream = host.media.robotStream;
      if (!stream?.getAudioTracks().some((track: MediaStreamTrack) => track.readyState === "live")) {
        robotSpeechStatus.textContent = "Robot audio stream unavailable. Try again after reconnecting.";
        return;
      }
      let asr: LocalRobotAsrPort;
      try {
        asr = new LocalRobotAsrPort(q<HTMLInputElement>("#robot-asr-url").value, q<HTMLInputElement>("#robot-asr-token").value);
      } catch (error) {
        robotSpeechStatus.textContent = error instanceof Error ? error.message : "Invalid local ASR settings";
        return;
      }
      q<HTMLInputElement>("#robot-asr-token").value = "";
      speech.stop();
      speechSharing = false;
      transcripts.clear();
      speechToggle.textContent = "Start transcription";
      speechStatus.textContent = "Device microphone off; recent text cleared.";
      const epoch = ++robotSpeechEpoch;
      const candidate = new RobotSpeechInput(stream, asr, (text) => {
        if (robotSpeechSharing && epoch === robotSpeechEpoch && transcripts.accept(text, performance.now())) {
          invalidateJudgment();
          robotSpeechStatus.textContent = "Final robot-stream utterance captured; recent text may be sent to Jev for 30 seconds.";
        }
      }, (status) => {
        if (epoch !== robotSpeechEpoch) return;
        robotSpeechStatus.textContent = status === "segment" ? "Sending one bounded audio segment to local ASR…" : status === "busy" ? "Local ASR busy; extra audio segment dropped." : "Local robot ASR failed; check the local process and token.";
      });
      robotSpeech = candidate;
      robotSpeechSharing = true;
      invalidateJudgment();
      robotSpeechToggle.textContent = "Stop robot transcription";
      robotSpeechStatus.textContent = "Starting robot audio capture…";
      void candidate.start().then(() => {
        if (epoch !== robotSpeechEpoch) { candidate.stop(); return; }
        robotSpeechStatus.textContent = "Listening to Reachy's incoming audio track. Only final text enters room state.";
      }).catch(() => {
        candidate.stop();
        if (epoch === robotSpeechEpoch) stopRobotSpeech("Robot transcription unavailable; check the audio track and browser support.");
      });
    });
    q<HTMLFormElement>("#relay-form").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const transport = new RelayTransport(q<HTMLInputElement>("#relay-url").value, q<HTMLInputElement>("#relay-token").value);
        engine = new ReflexEngine(new JevClient({ ask: usageMeter.wrap(transport.ask.bind(transport)), isTransient: isRetryableRelayError }));
        relayTransport = transport;
        relayPaused = false;
        relayFailures = 0;
        relayRetryAfterMs = 0;
        speakingEpoch++;
        setSpeakingState(null, "Speaking-state feed needs a fresh assertion from a separate local app.");
        speakingToggle.disabled = !transport.localSpeakingBridge;
        if (speakingToggle.disabled) speakingToggle.checked = false;
        traceEpoch++;
        lastMotionSource = undefined;
        lastEventSource = undefined;
        motionToggle.disabled = !detector || perceptionUnavailable;
        eventsToggle.disabled = !transport.localEventBridge;
        if (eventsToggle.disabled) {
          eventsToggle.checked = false;
          eventsStatus.textContent = "Local events require a numeric 127.0.0.1 relay; publishing off.";
        }
        q<HTMLElement>("#status").textContent = "Relay configured. Face tracking or consented final text can trigger judgments; motion needs live video and explicit enablement.";
        q<HTMLInputElement>("#relay-token").value = "";
      } catch (error) {
        q<HTMLElement>("#status").textContent = error instanceof Error ? error.message : "Invalid relay settings";
      }
    });
    motionToggle.addEventListener("change", () => { motionEpoch++; invalidateJudgment(); motion?.setEnabled(motionToggle.checked); });
    soundToggle.addEventListener("change", () => {
      const epoch = ++soundEpoch;
      sound?.stop();
      sound = undefined;
      invalidateJudgment();
      if (!soundToggle.checked) {
        soundStatus.textContent = "Robot audio analysis off; no sound state is sent.";
        return;
      }
      const stream = host.media.robotStream;
      if (!stream) {
        soundToggle.checked = false;
        soundStatus.textContent = "Robot audio stream unavailable. Try again after reconnecting.";
        return;
      }
      const candidate = new RobotSoundInput(stream);
      soundStatus.textContent = "Starting local robot audio analysis…";
      void candidate.start().then(() => {
        if (!active || epoch !== soundEpoch || !soundToggle.checked) { candidate.stop(); return; }
        sound = candidate;
        invalidateJudgment();
        soundStatus.textContent = "Local sound-energy hints active; no raw audio leaves this tab.";
      }).catch(() => {
        candidate.stop();
        if (epoch !== soundEpoch) return;
        soundToggle.checked = false;
        soundStatus.textContent = "Robot audio analysis unavailable or blocked by the browser.";
      });
    });
    trackingToggle.addEventListener("change", () => {
      const epoch = ++detectorEpoch;
      motionEpoch++;
      invalidateJudgment();
      if (!trackingToggle.checked) {
        detector?.close();
        detector = undefined;
        perceptionUnavailable = false;
        perception.clear();
        lastFrameAtMs = -Infinity;
        lastVideoTime = -1;
        motionToggle.checked = false;
        motionToggle.disabled = true;
        motion?.setEnabled(false);
        panel.update({ gauges: [], stale: true });
        q<HTMLElement>("#status").textContent = "Face tracking off; final consented text can still be judged. Motion is off.";
        return;
      }
      q<HTMLElement>("#status").textContent = "Loading the verified local face model…";
      void createFaceDetector().then((ready) => {
        if (!active || epoch !== detectorEpoch || !trackingToggle.checked) return ready.close();
        detector = ready;
        perceptionUnavailable = false;
        invalidateJudgment();
        motionToggle.disabled = !engine;
        q<HTMLElement>("#status").textContent = "Face tracking ready. Connect the relay to start judgments.";
      }).catch(() => {
        if (epoch !== detectorEpoch) return;
        trackingToggle.checked = false;
        perceptionUnavailable = false;
        q<HTMLElement>("#status").textContent = "Face detector unavailable; only consented final text can be judged. Motion is disabled.";
        motionToggle.disabled = true;
      });
    });
  }

  const detectTimer = window.setInterval(() => {
    if (!active || preview || !detector || !video.videoWidth || document.visibilityState !== "visible") return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    try {
      const now = performance.now();
      const recovering = perceptionUnavailable;
      const recycled = perception.acceptFaces(detector.detect(video, now), now);
      perceptionUnavailable = false;
      if (recovering) motionToggle.disabled = !engine;
      lastFrameAtMs = now;
      if (recycled || recovering) {
        invalidateJudgment();
        q<HTMLElement>("#status").textContent = recycled
          ? "Face label recycled; waiting for a fresh judgment before motion."
          : "Face tracking recovered; motion stays off until re-enabled.";
      }
      q<HTMLElement>("#video-fallback").hidden = true;
    }
    catch (error) {
      const firstFailure = !perceptionUnavailable;
      perceptionUnavailable = true;
      perception.clear();
      lastFrameAtMs = -Infinity;
      if (firstFailure) {
        motionEpoch++;
        invalidateJudgment();
        motionToggle.checked = false;
        motionToggle.disabled = true;
        motion?.setEnabled(false);
        panel.update({ gauges: [], stale: true });
        q<HTMLElement>("#person-count").textContent = "0";
        q<HTMLElement>("#decision").textContent = "Held";
        q<HTMLElement>("#stream-note").textContent = "Camera evidence unavailable · motion off";
      }
      q<HTMLElement>("#status").textContent = error instanceof RangeError && error.message.startsWith("too many faces")
        ? "More than nine faces detected; incomplete room state discarded and motion disarmed."
        : "Face detection failed; room state discarded and motion disarmed.";
    }
  }, 100);

  async function tick(): Promise<void> {
    if (!active || busy || !engine || relayPaused || performance.now() < relayRetryAfterMs
      || document.visibilityState !== "visible" || perceptionUnavailable) return;
    const now = performance.now();
    const recent = speechSharing || robotSpeechSharing ? transcripts.snapshot(now) : [];
    const audioOnly = !preview && !detector;
    if (audioOnly && !recent.length) {
      if (audioOnlyActive) {
        audioOnlyActive = false;
        invalidateJudgment();
        panel.update({ gauges: [], stale: true });
        q<HTMLElement>("#decision").textContent = "Idle";
        q<HTMLElement>("#stream-note").textContent = "No recent final text · motion off";
      }
      return;
    }
    audioOnlyActive = audioOnly;
    busy = true;
    try {
      const currentEngine = engine;
      const trackingVersion = detectorEpoch;
      const motionVersion = motionEpoch;
      const observedFrameAtMs = lastFrameAtMs;
      if (preview) {
        if (fixturePerson) perception.acceptFaces([{ x: 0.6, y: 0.2, width: 0.25, height: 0.3 }], now);
      }
      const observation = perception.snapshot(now);
      if (speakingState !== null) observation.robot = { currentlySpeaking: speakingState };
      if (!preview) {
        const reading = sound?.snapshot();
        if (reading) observation.sound = reading;
      }
      if (preview && fixturePerson) observation.transcriptRecent = [{ who: "p1", text: "Reachy, are you listening?" }];
      if (recent.length) observation.transcriptRecent = recent;
      const result = await currentEngine.tick(observation, now);
      if (!active || !result || currentEngine !== engine || document.visibilityState !== "visible" || (!preview && !audioOnly && trackingVersion !== detectorEpoch)) return;
      const deliveredAtMs = performance.now();
      if (audioOnly && (!(speechSharing || robotSpeechSharing) || !transcripts.snapshot(performance.now()).length)) return;
      if (!result.skipped) {
        lastEventSource = !result.stale && !audioOnly && trackingVersion === detectorEpoch
          ? { startedAtMs: now, observedFrameAtMs, observedPeople: observation.people ?? [] }
          : undefined;
        lastMotionSource = !result.stale && !audioOnly && motionToggle.checked && trackingVersion === detectorEpoch && motionVersion === motionEpoch
          ? { startedAtMs: now, observedFrameAtMs, observedPeople: observation.people ?? [] }
          : undefined;
      }
      panel.update(preview ? { ...result.panel, source: "fixture" } : result.panel);
      ticks++;
      q<HTMLElement>("#person-count").textContent = String(observation.people?.length ?? 0);
      q<HTMLElement>("#tick-count").textContent = String(ticks);
      q<HTMLElement>("#decision").textContent = result.stale ? "Stale · idle" : audioOnly ? "Audio only · motion off" : result.output.gaze === "none" ? "Scanning" : `Looking at ${result.output.gaze}`;
      q<HTMLElement>("#stream-note").textContent = preview ? "Deterministic fixture answers" : result.stale ? "Jev unavailable · no new motion" : `${result.model ?? "Model unknown"} · ${Math.round(result.latencyMs ?? 0)} ms`;
      if (result.error === "RelayLimitError") {
        relayPaused = true;
        q<HTMLElement>("#status").textContent = "Relay request limit reached; judgments paused. Let the relay recover or restart/reconfigure its process cap, then reconnect. Motion paused.";
      } else if (result.error === "RelayRequestRejectedError") {
        relayPaused = true;
        q<HTMLElement>("#status").textContent = "Relay rejected the request; judgments paused. Check the URL, token, allowed origin, and app/relay version, then reconnect. Motion paused.";
      } else if (result.requestFailed) {
        relayFailures = Math.min(relayFailures + 1, 5);
        const delayMs = Math.min(30_000, 2_000 * 2 ** (relayFailures - 1));
        relayRetryAfterMs = performance.now() + delayMs;
        q<HTMLElement>("#status").textContent = `Judgment unavailable (${result.error ?? "stale relay answer"}); retrying after ${delayMs / 1000}s. Motion paused.`;
      } else if (result.error) {
        q<HTMLElement>("#status").textContent = `Judgment unavailable (${result.error}); motion paused.`;
      } else if (!result.stale) {
        if (relayFailures > 0 && !result.skipped) {
          q<HTMLElement>("#status").textContent = "Relay recovered; fresh judgments resumed. Robot motion still needs current scene evidence and explicit enablement.";
        }
        relayFailures = 0;
        relayRetryAfterMs = 0;
      }
      const eventReady = Boolean(host && relayTransport && eventsToggle.checked && !audioOnly && !result.stale && detector
        && trackingVersion === detectorEpoch && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && lastEventSource && motionEvidenceCurrent({ ...lastEventSource, deliveredAtMs,
          latestFrameAtMs: lastFrameAtMs, latestPeople: perception.snapshot(deliveredAtMs).people ?? [] }));
      if (eventReady && result.output.events.length) {
        const publisher = relayTransport!;
        for (const event of result.output.events) {
          void publisher.publishEvent(event).then((subscribers) => {
            if (active && eventsToggle.checked && relayTransport === publisher) {
              eventsStatus.textContent = subscribers
                ? `Local event accepted for ${subscribers} connected subscriber${subscribers === 1 ? "" : "s"}; consumer action is unverified.`
                : "Local event accepted, but no subscriber was connected.";
            }
          }).catch(() => {
            if (active && eventsToggle.checked && relayTransport === publisher) {
              eventsToggle.checked = false;
              invalidateJudgment();
              eventsStatus.textContent = "Local event bridge unavailable; publishing stopped. No consumer action is assumed.";
            }
          });
        }
      }
      const motionReady = Boolean(host && motion && !audioOnly && !result.stale && detector && motionToggle.checked
        && trackingVersion === detectorEpoch && motionVersion === motionEpoch
        && (speakingState !== null || !result.output.nod)
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && lastMotionSource && motionEvidenceCurrent({ ...lastMotionSource, deliveredAtMs,
          latestFrameAtMs: lastFrameAtMs, latestPeople: perception.snapshot(deliveredAtMs).people ?? [] }));
      let motionOutcome: MotionOutcome = preview ? "preview" : motionToggle.checked ? "held" : "off";
      if (motionReady) {
        try {
          const dispatch = motion!.apply(result.output, deliveredAtMs);
          motionOutcome = dispatch === "accepted" ? "accepted" : dispatch === "held" ? "held" : "not_accepted";
          if (dispatch === "rejected" || dispatch === "unavailable") {
            motionEpoch++;
            lastMotionSource = undefined;
            motionToggle.checked = false;
            motion!.setEnabled(false);
            q<HTMLElement>("#status").textContent = dispatch === "rejected"
              ? "Robot rejected the motion request; motion disarmed. Check the robot and use the physical stop if needed before re-enabling."
              : "Robot connection became unavailable; motion disarmed. Check the robot before re-enabling.";
          }
        }
        catch {
          motionOutcome = "error";
          motionEpoch++;
          lastMotionSource = undefined;
          motionToggle.checked = false;
          motion!.setEnabled(false);
          q<HTMLElement>("#status").textContent = "Robot motion request failed; motion disarmed. Use the physical stop if needed.";
        }
      } else if (host && motionToggle.checked && !audioOnly && !result.stale) {
        q<HTMLElement>("#stream-note").textContent = "Judgment shown · motion held (scene changed or answer aged)";
      }
      if (traceToggle.checked) {
        trace.add(observation, result, now, motionOutcome, traceEpoch);
        updateTraceStatus();
      }
    } catch (error) {
      if (active) q<HTMLElement>("#status").textContent = error instanceof Error ? error.message : "Tick failed";
    } finally { busy = false; }
  }
  const tickTimer = window.setInterval(() => { void tick(); }, 250);
  const onVisibilityChange = () => { invalidateJudgment(); };
  document.addEventListener("visibilitychange", onVisibilityChange);
  void tick();
  const dispose = () => {
    active = false;
    invalidateJudgment();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("fullscreenchange", syncFullscreen);
    if (document.fullscreenElement === brain) void document.exitFullscreen().catch(() => {});
    detectorEpoch++;
    motionEpoch++;
    lastMotionSource = undefined;
    soundEpoch++;
    clearInterval(tickTimer);
    clearInterval(detectTimer);
    clearInterval(speakingTimer);
    speakingEpoch++;
    speakingToggle.checked = false;
    speakingState = null;
    motion?.setEnabled(false);
    eventsToggle.checked = false;
    detector?.close();
    speech.stop();
    stopRobotSpeech("Robot transcription off.");
    sound?.stop();
    sound = undefined;
    transcripts.clear();
    trace.clear();
    speechSharing = false;
    detachVideo?.();
    perception.clear();
  };
  host?.onLeave(dispose);
  window.addEventListener("pagehide", dispose, { once: true });
}

if (new URLSearchParams(location.search).get("preview") === "1") mountApp();
else void connectToHost().then(mountApp).catch((error: unknown) => {
  root!.textContent = error instanceof Error ? `Could not connect to Reachy Mini: ${error.message}` : "Could not connect to Reachy Mini";
});
