import { connectToHost } from "@pollen-robotics/reachy-mini-sdk/host/embed";
import { JevClient } from "reachy-jev";
import "reachy-jev/panel";
import type { JevPanelElement } from "reachy-jev/panel";
import { ReflexEngine } from "./engine.js";
import { fixtureAsk } from "./fixture.js";
import { RobotMotionController } from "./motion.js";
import { PerceptionState } from "./perception.js";
import { RelayTransport } from "./relay.js";
import { VideoFaceDetector } from "./vision.js";
import { BrowserSpeechInput, RecentTranscripts, browserRecognition } from "./speech.js";
import { RobotSoundInput } from "./sound.js";
import { LocalRobotAsrPort, RobotSpeechInput } from "./robot_speech.js";
import "./style.css";

type Host = Awaited<ReturnType<typeof connectToHost>>;
const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("root element missing");

export function mountApp(host?: Host): void {
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
        <section class="brain" aria-label="Decision signals"><div class="brain-head"><p class="eyebrow">INSIDE THE LOOP</p><h2>Live judgment stream</h2><p id="stream-note">${preview ? "Deterministic fixture answers" : "Waiting for local Jev relay"}</p></div><jev-panel id="jev-panel"></jev-panel><p class="fine-print">Gauges show typed judgments; code gates every motion. This display is not a safety controller.</p></section>
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
  const panel = q<JevPanelElement>("#jev-panel");
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
    robotSpeechToggle.textContent = "Start robot transcription";
    robotSpeechStatus.textContent = status;
  };
  const speech = new BrowserSpeechInput(
    browserRecognition,
    (text) => {
      if (speechSharing && transcripts.accept(text, performance.now())) {
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
      speechToggle.textContent = "Start transcription";
      speechStatus.textContent = robotSpeechSharing ? "Device microphone off; robot transcription remains active." : "Microphone off; recent text cleared. An in-flight relay request cannot be recalled.";
    } else speechStatus.textContent = "Consent set for this tab. Press Start transcription to listen.";
  });
  speechToggle.addEventListener("click", () => {
    if (speech.active) {
      speech.stop();
      speechSharing = false;
      transcripts.clear();
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
    speechToggle.textContent = "Stop transcription";
    speechStatus.textContent = "Listening on this device. Only final text is kept briefly in this tab.";
  });
  const motion = host ? new RobotMotionController(host.reachy) : undefined;
  let detector: VideoFaceDetector | undefined;
  let engine: ReflexEngine | undefined = preview ? new ReflexEngine(new JevClient({ ask: fixtureAsk })) : undefined;
  let ticks = 0;
  let active = true;
  let busy = false;
  let lastVideoTime = -1;
  let lastFrameAtMs = -Infinity;
  let detectorEpoch = 0;
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
    q<HTMLButtonElement>("#preview-person").addEventListener("click", () => { fixturePerson = true; });
    q<HTMLButtonElement>("#preview-empty").addEventListener("click", () => { fixturePerson = false; perception.clear(); });
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
        if (robotSpeechSharing && epoch === robotSpeechEpoch && transcripts.accept(text, performance.now())) robotSpeechStatus.textContent = "Final robot-stream utterance captured; recent text may be sent to Jev for 30 seconds.";
      }, (status) => {
        if (epoch !== robotSpeechEpoch) return;
        robotSpeechStatus.textContent = status === "segment" ? "Sending one bounded audio segment to local ASR…" : status === "busy" ? "Local ASR busy; extra audio segment dropped." : "Local robot ASR failed; check the local process and token.";
      });
      robotSpeech = candidate;
      robotSpeechSharing = true;
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
        engine = new ReflexEngine(new JevClient({ ask: transport.ask.bind(transport) }));
        motionToggle.disabled = !detector;
        q<HTMLElement>("#status").textContent = "Relay configured. Face tracking or consented final text can trigger judgments; motion needs live video and explicit enablement.";
        q<HTMLInputElement>("#relay-token").value = "";
      } catch (error) {
        q<HTMLElement>("#status").textContent = error instanceof Error ? error.message : "Invalid relay settings";
      }
    });
    motionToggle.addEventListener("change", () => motion?.setEnabled(motionToggle.checked));
    soundToggle.addEventListener("change", () => {
      const epoch = ++soundEpoch;
      sound?.stop();
      sound = undefined;
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
      if (!trackingToggle.checked) {
        detector?.close();
        detector = undefined;
        perception.clear();
        motionToggle.checked = false;
        motionToggle.disabled = true;
        motion?.setEnabled(false);
        panel.update({ gauges: [], stale: true });
        q<HTMLElement>("#status").textContent = "Face tracking off; final consented text can still be judged. Motion is off.";
        return;
      }
      q<HTMLElement>("#status").textContent = "Loading the verified local face model…";
      void VideoFaceDetector.create().then((ready) => {
        if (!active || epoch !== detectorEpoch || !trackingToggle.checked) return ready.close();
        detector = ready;
        motionToggle.disabled = !engine;
        q<HTMLElement>("#status").textContent = "Face tracking ready. Connect the relay to start judgments.";
      }).catch(() => {
        if (epoch !== detectorEpoch) return;
        trackingToggle.checked = false;
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
      perception.acceptFaces(detector.detect(video, now), now);
      lastFrameAtMs = now;
      q<HTMLElement>("#video-fallback").hidden = true;
    }
    catch { q<HTMLElement>("#status").textContent = "Face detection failed; motion paused."; motionToggle.checked = false; motion?.setEnabled(false); }
  }, 100);

  async function tick(): Promise<void> {
    if (!active || busy || !engine || document.visibilityState !== "visible") return;
    const now = performance.now();
    const recent = speechSharing || robotSpeechSharing ? transcripts.snapshot(now) : [];
    const audioOnly = !preview && !detector;
    if (audioOnly && !recent.length) {
      if (audioOnlyActive) {
        audioOnlyActive = false;
        panel.update({ gauges: [], stale: true });
        q<HTMLElement>("#decision").textContent = "Idle";
        q<HTMLElement>("#stream-note").textContent = "No recent final text · motion off";
      }
      return;
    }
    audioOnlyActive = audioOnly;
    busy = true;
    try {
      if (preview) {
        if (fixturePerson) perception.acceptFaces([{ x: 0.6, y: 0.2, width: 0.25, height: 0.3 }], now);
      }
      const observation = perception.snapshot(now);
      if (!preview) {
        const reading = sound?.snapshot();
        if (reading) observation.sound = reading;
      }
      if (preview && fixturePerson) observation.transcriptRecent = [{ who: "p1", text: "Reachy, are you listening?" }];
      if (recent.length) observation.transcriptRecent = recent;
      const result = await engine.tick(observation, now);
      if (!active) return;
      if (audioOnly && (!(speechSharing || robotSpeechSharing) || !transcripts.snapshot(performance.now()).length)) return;
      panel.update(preview ? { ...result.panel, source: "fixture" } : result.panel);
      ticks++;
      q<HTMLElement>("#person-count").textContent = String(observation.people?.length ?? 0);
      q<HTMLElement>("#tick-count").textContent = String(ticks);
      q<HTMLElement>("#decision").textContent = result.stale ? "Stale · idle" : audioOnly ? "Audio only · motion off" : result.output.gaze === "none" ? "Scanning" : `Looking at ${result.output.gaze}`;
      q<HTMLElement>("#stream-note").textContent = preview ? "Deterministic fixture answers" : result.stale ? "Jev unavailable · no new motion" : `${result.model ?? "Model unknown"} · ${Math.round(result.latencyMs ?? 0)} ms`;
      if (result.error) q<HTMLElement>("#status").textContent = `Judgment unavailable (${result.error}); motion paused.`;
      if (host && motion && !audioOnly && !result.stale && detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastFrameAtMs < 1000) {
        motion.apply(result.output, now);
      }
    } catch (error) {
      if (active) q<HTMLElement>("#status").textContent = error instanceof Error ? error.message : "Tick failed";
    } finally { busy = false; }
  }
  const tickTimer = window.setInterval(() => { void tick(); }, 250);
  void tick();
  const dispose = () => {
    active = false;
    detectorEpoch++;
    soundEpoch++;
    clearInterval(tickTimer);
    clearInterval(detectTimer);
    motion?.setEnabled(false);
    detector?.close();
    speech.stop();
    stopRobotSpeech("Robot transcription off.");
    sound?.stop();
    sound = undefined;
    transcripts.clear();
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
