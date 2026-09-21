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
import "./style.css";

type Host = Awaited<ReturnType<typeof connectToHost>>;
const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("root element missing");

function mountApp(host?: Host): void {
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
  const perception = new PerceptionState();
  const motion = host ? new RobotMotionController(host.reachy) : undefined;
  let detector: VideoFaceDetector | undefined;
  let engine: ReflexEngine | undefined = preview ? new ReflexEngine(new JevClient({ ask: fixtureAsk })) : undefined;
  let ticks = 0;
  let active = true;
  let busy = false;
  let lastVideoTime = -1;
  let lastFrameAtMs = -Infinity;
  let detectorEpoch = 0;
  let fixturePerson = false;
  const detachVideo = host?.media.attachVideo(video);
  q<HTMLElement>("#connection").textContent = preview ? "FIXTURE PREVIEW" : "ROBOT CONNECTED";
  q<HTMLElement>("#video-fallback").textContent = preview ? "No camera in fixture preview" : "Waiting for robot video…";

  if (preview) {
    q<HTMLButtonElement>("#preview-person").addEventListener("click", () => { fixturePerson = true; });
    q<HTMLButtonElement>("#preview-empty").addEventListener("click", () => { fixturePerson = false; perception.clear(); });
  } else {
    q<HTMLFormElement>("#relay-form").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const transport = new RelayTransport(q<HTMLInputElement>("#relay-url").value, q<HTMLInputElement>("#relay-token").value);
        engine = new ReflexEngine(new JevClient({ ask: transport.ask.bind(transport) }));
        motionToggle.disabled = !detector;
        q<HTMLElement>("#status").textContent = "Relay configured. Judgments will run when video is available; motion remains off.";
        q<HTMLInputElement>("#relay-token").value = "";
      } catch (error) {
        q<HTMLElement>("#status").textContent = error instanceof Error ? error.message : "Invalid relay settings";
      }
    });
    motionToggle.addEventListener("change", () => motion?.setEnabled(motionToggle.checked));
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
        q<HTMLElement>("#status").textContent = "Face tracking off; no judgments or motion.";
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
        q<HTMLElement>("#status").textContent = "Face detector unavailable; judgments and motion are disabled.";
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
    if (!active || busy || !engine || document.visibilityState !== "visible" || (!preview && !detector)) return;
    busy = true;
    const now = performance.now();
    try {
      if (preview) {
        if (fixturePerson) perception.acceptFaces([{ x: 0.6, y: 0.2, width: 0.25, height: 0.3 }], now);
      }
      const observation = perception.snapshot(now);
      if (preview && fixturePerson) observation.transcriptRecent = [{ who: "p1", text: "Reachy, are you listening?" }];
      const result = await engine.tick(observation, now);
      if (!active) return;
      panel.update(preview ? { ...result.panel, source: "fixture" } : result.panel);
      ticks++;
      q<HTMLElement>("#person-count").textContent = String(observation.people?.length ?? 0);
      q<HTMLElement>("#tick-count").textContent = String(ticks);
      q<HTMLElement>("#decision").textContent = result.stale ? "Stale · idle" : result.output.gaze === "none" ? "Scanning" : `Looking at ${result.output.gaze}`;
      q<HTMLElement>("#stream-note").textContent = preview ? "Deterministic fixture answers" : result.stale ? "Jev unavailable · no new motion" : `${result.model ?? "Model unknown"} · ${Math.round(result.latencyMs ?? 0)} ms`;
      if (result.error) q<HTMLElement>("#status").textContent = `Judgment unavailable (${result.error}); motion paused.`;
      if (host && motion && !result.stale && detector && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastFrameAtMs < 1000) {
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
    clearInterval(tickTimer);
    clearInterval(detectTimer);
    motion?.setEnabled(false);
    detector?.close();
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
