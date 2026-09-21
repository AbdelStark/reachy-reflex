import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("fixture preview renders all 16 signals and reacts to synthetic room changes", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/v1/systemone")) requests.push(request.url()); });
  await page.goto("/?preview=1");
  await expect(page.locator("#connection")).toHaveText("FIXTURE PREVIEW");
  await expect(page.locator("#usage-note")).toHaveText("Fixture preview · no model cost.");
  await expect(page.locator("jev-panel").locator("jev-gauge")).toHaveCount(16);
  await expect(page.locator("jev-panel").locator(".status")).toHaveText("fixture");
  await expect(page.locator("#person-count")).toHaveText("0");
  await page.getByRole("button", { name: "Simulate a person" }).click();
  await expect(page.locator("#person-count")).toHaveText("1");
  await expect(page.locator("#decision")).toHaveText("Looking at p1");
  await expect(page.locator("jev-panel").locator("jev-gauge").filter({ hasText: "Addressed" }).first().locator(".value")).toHaveText("90%");
  await page.getByRole("button", { name: "Empty room" }).click();
  await expect(page.locator("#person-count")).toHaveText("0");
  expect(requests).toEqual([]);
});

test("trace is opt-in, bounded to this tab, downloadable, and text-free", async ({ page }) => {
  await page.goto("/?preview=1");
  await expect(page.locator("#trace-download")).toBeDisabled();
  await page.locator("#trace-enable").check();
  await page.getByRole("button", { name: "Simulate a person" }).click();
  await expect(page.locator("#trace-download")).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#trace-download").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const rows = (await readFile(path!, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(rows[0].schema).toBe("reflex.tick@2");
  expect(Number.isSafeInteger(rows[0].policy_epoch)).toBe(true);
  expect(rows[0].decision.motion).toBe("preview");
  expect(rows.some((row) => row.people.some((person: { id: string }) => person.id === "p1"))).toBe(true);
  expect(rows.every((row) => !("transcript" in row) && !("frames" in row))).toBe(true);
  const replay = await execFileAsync("npm", ["run", "replay:trace", "--", path!]);
  expect(replay.stdout).toContain("0 mismatches");
  await page.locator("#trace-enable").uncheck();
  await page.locator("#trace-clear").click();
  await expect(page.locator("#trace-download")).toBeDisabled();
  await expect(page.locator("#trace-status")).toContainText("Trace off. 0 text-free ticks");
});

test("preview fits a narrow mobile viewport and serves local MediaPipe Wasm", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=1");
  await expect(page.locator("jev-panel").locator("jev-gauge")).toHaveCount(16);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const wasm = await request.get("/mediapipe/wasm/vision_wasm_internal.wasm");
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()["content-type"]).toContain("application/wasm");
});

test("verified local model initializes MediaPipe with browser assets on this origin", async ({ page }) => {
  const thirdParty: string[] = [];
  const localAssets: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:5173/")) thirdParty.push(request.url());
    if (request.url().includes("/mediapipe/")) localAssets.push(request.url());
  });
  await page.goto("/?preview=1");
  const loaded = await page.evaluate(async () => {
    const { VideoFaceDetector } = await import("/src/vision.ts");
    const detector = await VideoFaceDetector.create();
    detector.close();
    return true;
  });
  expect(loaded).toBe(true);
  expect(localAssets.some((url) => url.endsWith("face_detector.tflite"))).toBe(true);
  expect(localAssets.some((url) => url.endsWith(".wasm"))).toBe(true);
  expect(thirdParty.every((url) => url.startsWith("https://odml.pa.googleapis.com/v1/log"))).toBe(true);
});

test("microphone transcript path is opt-in, final-only, and cleared on stop", async ({ page }) => {
  const jevRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/v1/systemone")) jevRequests.push(request.url()); });
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = "";
      onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() { (window as unknown as { fakeRecognition: FakeRecognition }).fakeRecognition = this; }
      abort() {}
      emit(text: string, isFinal: boolean) { this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] }); }
    }
    (window as unknown as { SpeechRecognition: typeof FakeRecognition }).SpeechRecognition = FakeRecognition;
  });
  await page.goto("/?preview=1");
  const addressed = page.locator("jev-panel").locator("jev-gauge").filter({ hasText: "Addressed" }).first().locator(".value");
  await expect(addressed).toHaveText("20%");
  await page.getByRole("button", { name: "Start transcription" }).click();
  await expect(page.locator("#speech-status")).toContainText("Check microphone consent");
  await page.locator("#speech-consent").check();
  await page.getByRole("button", { name: "Start transcription" }).click();
  await page.evaluate(() => (window as unknown as { fakeRecognition: { emit(text: string, isFinal: boolean): void } }).fakeRecognition.emit("Reachy, please look here", false));
  await expect(addressed).toHaveText("20%");
  await page.evaluate(() => (window as unknown as { fakeRecognition: { emit(text: string, isFinal: boolean): void } }).fakeRecognition.emit("Reachy, please look here", true));
  await expect(page.locator("#speech-status")).toContainText("Final utterance captured");
  await expect(addressed).toHaveText("90%");
  await page.getByRole("button", { name: "Stop transcription" }).click();
  await expect(page.locator("#speech-status")).toContainText("recent text cleared");
  await expect(addressed).toHaveText("20%");
  expect(jevRequests).toEqual([]);
});

test("local robot-stream analyser reads synthetic audio without speaker output", async ({ page }) => {
  await page.goto("/?preview=1");
  const result = await page.evaluate(async () => {
    const { RobotSoundInput } = await import("/src/sound.ts");
    const generator = new AudioContext();
    const oscillator = generator.createOscillator();
    const destination = generator.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    await generator.resume();
    const input = new RobotSoundInput(destination.stream);
    try {
      await input.start();
      let reading = input.snapshot();
      for (let attempt = 0; attempt < 40 && (!reading || reading.levelDbfs <= -60); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        reading = input.snapshot();
      }
      return reading;
    } finally {
      input.stop();
      oscillator.stop();
      await generator.close();
    }
  });
  expect(result?.levelDbfs).toBeGreaterThan(-60);
  expect(result?.voiceDetected).toBe(true);
});

test("synthetic robot-stream worklet sends a final segment only to the local ASR port", async ({ page }) => {
  await page.goto("/?preview=1");
  await expect(page.locator("#robot-speech-toggle")).toBeHidden();
  const result = await page.evaluate(async () => {
    const { RobotSpeechInput } = await import("/src/robot_speech.ts");
    const generator = new AudioContext();
    const oscillator = generator.createOscillator();
    const gain = generator.createGain();
    gain.gain.value = 0.2;
    const destination = generator.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    const finals: string[] = [];
    const segments: number[] = [];
    const input = new RobotSpeechInput(destination.stream, {
      async transcribe(pcm: Uint8Array) { segments.push(pcm.length); return "Reachy, look here"; },
    }, (text: string) => finals.push(text), () => {});
    try {
      await generator.resume();
      await input.start();
      oscillator.start();
      await new Promise((resolve) => setTimeout(resolve, 350));
      oscillator.stop();
      await new Promise((resolve) => setTimeout(resolve, 850));
      return { finals, segments, trackState: destination.stream.getAudioTracks()[0]?.readyState };
    } finally {
      input.stop();
      await generator.close();
    }
  });
  expect(result.finals).toEqual(["Reachy, look here"]);
  expect(result.segments).toHaveLength(1);
  expect(result.segments[0]).toBeGreaterThanOrEqual(16_000);
  expect(result.trackState).toBe("live");
});

test("stopping robot transcription discards a late ASR result and preserves the host track", async ({ page }) => {
  await page.goto("/?preview=1");
  const result = await page.evaluate(async () => {
    const { RobotSpeechInput } = await import("/src/robot_speech.ts");
    const generator = new AudioContext();
    const oscillator = generator.createOscillator();
    const gain = generator.createGain();
    gain.gain.value = 0.2;
    const destination = generator.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    let resolveText: ((text: string) => void) | undefined;
    let called = false;
    const finals: string[] = [];
    const input = new RobotSpeechInput(destination.stream, {
      transcribe: () => { called = true; return new Promise<string>((resolve) => { resolveText = resolve; }); },
    }, (text: string) => finals.push(text), () => {});
    try {
      await generator.resume();
      await input.start();
      oscillator.start();
      await new Promise((resolve) => setTimeout(resolve, 350));
      oscillator.stop();
      await new Promise((resolve) => setTimeout(resolve, 850));
      input.stop();
      resolveText?.("late transcript");
      await Promise.resolve();
      return { called, finals, trackState: destination.stream.getAudioTracks()[0]?.readyState };
    } finally {
      input.stop();
      await generator.close();
    }
  });
  expect(result).toEqual({ called: true, finals: [], trackState: "live" });
});

test("connected app judges consented final text without a camera and never commands motion", async ({ page }) => {
  const states: Array<{ people: unknown[]; transcript_recent?: Array<{ who: string; text: string }> }> = [];
  let blockNext = false;
  let releaseBlocked: (() => void) | undefined;
  await page.route("http://127.0.0.1:8048/v1/systemone", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const { state } = route.request().postDataJSON();
    states.push(state);
    if (blockNext) {
      blockNext = false;
      await new Promise<void>((resolve) => { releaseBlocked = resolve; });
    }
    const noul = (value: number) => ({ type: "noul", noul: value });
    const answers = {
      attention_target: { type: "choice", choice: "none", confidence: 0.99 },
      addressed: noul(0.9), addressed_by_gaze: noul(0.05), wants_reply: noul(0.8),
      pause_invites_ack: noul(0.1), being_ignored: noul(0.1), someone_leaving: noul(0.1),
      someone_arriving: noul(0.1), turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
      engagement: { type: "score", score: 0 }, speaker_mood: { type: "choice", choice: "curious", confidence: 0.8 },
      group_talking_to_each_other: noul(0.1), robot_named: noul(0.9), question_asked: noul(0.8),
      laughter_moment: noul(0.1), silence_awkward: noul(0.1),
    };
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers, usage: { input_tokens: 120, output_tokens: 7 } }) });
  });
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = true;
      lang = "";
      onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() { (window as unknown as { fakeRecognition: FakeRecognition }).fakeRecognition = this; }
      abort() {}
      emit(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
    }
    (window as unknown as { SpeechRecognition: typeof FakeRecognition }).SpeechRecognition = FakeRecognition;
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide")); // Dispose the fixture loop before mounting a fake host.
    const commands: unknown[] = [];
    (window as unknown as { robotCommands: unknown[] }).robotCommands = commands;
    const robot = {
      state: "streaming",
      setTarget(target: unknown) { commands.push(target); return true; },
      gotoTarget(target: unknown) { commands.push(target); return true; },
    };
    const host = { reachy: robot, media: { attachVideo: () => () => {}, robotStream: undefined }, onLeave: () => {} };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(host as never);
  });
  await page.locator("#relay-token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Connect Jev relay" }).click();
  await expect(page.locator("#motion-enable")).toBeDisabled();
  await page.waitForTimeout(350);
  expect(states).toHaveLength(0);
  await page.locator("#speech-consent").check();
  await page.getByRole("button", { name: "Start transcription" }).click();
  await page.evaluate(() => (window as unknown as { fakeRecognition: { emit(text: string): void } }).fakeRecognition.emit("Reachy, are you listening?"));
  await expect(page.locator("#decision")).toHaveText("Audio only · motion off");
  await expect(page.locator("jev-panel").locator("jev-gauge")).toHaveCount(16);
  await expect(page.locator("#usage-note")).toContainText("120 input / 7 output tokens reported");
  await expect(page.locator("#usage-note")).toContainText("Cost unavailable (model rate not verified)");
  expect(states.length).toBeGreaterThan(0);
  expect(states[0].people).toEqual([]);
  expect(states[0].transcript_recent).toEqual([{ who: "unknown", text: "Reachy, are you listening?", ended: "just now" }]);
  expect(await page.evaluate(() => (window as unknown as { robotCommands: unknown[] }).robotCommands)).toEqual([]);
  blockNext = true;
  await expect.poll(() => Boolean(releaseBlocked)).toBe(true);
  await page.locator("#speech-consent").uncheck();
  releaseBlocked?.();
  await expect(page.locator("#decision")).toHaveText("Idle");
  await expect(page.locator("jev-panel").locator("jev-gauge")).toHaveCount(0);
});

test("local control events require explicit opt-in and fresh camera evidence", async ({ page }) => {
  const published: Array<Record<string, unknown>> = [];
  let slowNext = false;
  let slowAnswered = false;
  const headers = {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  await page.route("http://127.0.0.1:8048/v1/events", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    published.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, headers, body: JSON.stringify({ accepted: true, subscribers: 1 }) });
  });
  await page.route("http://127.0.0.1:8048/v1/systemone", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const people = route.request().postDataJSON().state.people as Array<{ id: string }>;
    if (slowNext && people.length) {
      slowNext = false;
      await new Promise((resolve) => setTimeout(resolve, 900));
      slowAnswered = true;
    }
    const noul = (value: number) => ({ type: "noul", noul: value });
    const answers = {
      attention_target: { type: "choice", choice: people[0]?.id ?? "none", confidence: 0.9 },
      addressed: noul(0.1), addressed_by_gaze: noul(0.1), wants_reply: noul(0.1),
      pause_invites_ack: noul(0.1), being_ignored: noul(0.1), someone_leaving: noul(0.1),
      someone_arriving: noul(0.1), turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
      engagement: { type: "score", score: 2 }, speaker_mood: { type: "choice", choice: "neutral", confidence: 0.9 },
      group_talking_to_each_other: noul(0.1), robot_named: noul(0.1), question_asked: noul(0.1),
      laughter_moment: noul(0.1), silence_awkward: noul(0.1),
    };
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers }) });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext("2d")!;
    let shade = 0;
    const draw = window.setInterval(() => { context.fillStyle = `rgb(${shade++ % 255},0,0)`; context.fillRect(0, 0, 320, 240); }, 50);
    const stream = canvas.captureStream(30);
    const commands: unknown[] = [];
    (window as unknown as { eventRobotCommands: unknown[] }).eventRobotCommands = commands;
    const host = {
      reachy: { state: "streaming", setTarget(target: unknown) { commands.push(target); return true; }, gotoTarget(target: unknown) { commands.push(target); return true; } },
      media: { attachVideo(video: HTMLVideoElement) { video.srcObject = stream; void video.play(); return () => { clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); }; }, robotStream: undefined },
      onLeave: () => {},
    };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(host as never, async () => ({ detect() { return [{ x: 0.3, y: 0.2, width: 0.2, height: 0.3 }]; }, close() {} }));
  });
  await page.locator("#relay-token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Connect Jev relay" }).click();
  await page.locator("#tracking-enable").check();
  await expect(page.locator("#person-count")).toHaveText("1");
  await expect(page.locator("#decision")).toHaveText("Looking at p1");
  expect(published).toEqual([]);
  await page.locator("#tracking-enable").uncheck();
  slowNext = true;
  await page.locator("#events-enable").check();
  await page.locator("#tracking-enable").check();
  await expect.poll(() => slowAnswered).toBe(true);
  await page.waitForTimeout(400); // Cached copies retain the old source age.
  expect(published).toEqual([]);
  await page.locator("#tracking-enable").uncheck();
  await page.locator("#tracking-enable").check();
  await expect.poll(() => published.length).toBeGreaterThan(0);
  expect(published).toContainEqual({ type: "attention", person: "p1" });
  await expect(page.locator("#events-status")).toContainText("1 connected subscriber");
  expect(await page.evaluate(() => (window as unknown as { eventRobotCommands: unknown[] }).eventRobotCommands)).toEqual([]);
  await page.locator("#events-enable").uncheck();
  const count = published.length;
  await page.waitForTimeout(500);
  expect(published).toHaveLength(count);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
});

test("slow Jev answers and their cached copies cannot move a fake robot", async ({ page }) => {
  let blockReady = false;
  let blocked = false;
  await page.route("http://127.0.0.1:8048/v1/systemone", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const { state } = route.request().postDataJSON();
    const people = state.people as Array<{ id: string }>;
    if (blockReady && people.length && !blocked) {
      blocked = true;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const noul = (value: number) => ({ type: "noul", noul: value });
    const answers = {
      attention_target: { type: "choice", choice: people[0]?.id ?? "none", confidence: 0.9 },
      addressed: noul(0.9), addressed_by_gaze: noul(0.9), wants_reply: noul(0.8),
      pause_invites_ack: noul(0.1), being_ignored: noul(0.1), someone_leaving: noul(0.1),
      someone_arriving: noul(0.1), turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
      engagement: { type: "score", score: 2 }, speaker_mood: { type: "choice", choice: "curious", confidence: 0.8 },
      group_talking_to_each_other: noul(0.1), robot_named: noul(0.9), question_asked: noul(0.8),
      laughter_moment: noul(0.1), silence_awkward: noul(0.1),
    };
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers }) });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    const fixture = { commands: [] as unknown[], detects: 0 };
    (window as unknown as { fakeReflexMotion: typeof fixture }).fakeReflexMotion = fixture;
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext("2d")!;
    let shade = 0;
    const draw = window.setInterval(() => { context.fillStyle = `rgb(${shade++ % 255},0,0)`; context.fillRect(0, 0, 320, 240); }, 50);
    const stream = canvas.captureStream(30);
    const robot = {
      state: "streaming",
      setTarget(target: unknown) { fixture.commands.push(target); return true; },
      gotoTarget(target: unknown) { fixture.commands.push(target); return true; },
    };
    const host = {
      reachy: robot,
      media: { attachVideo(video: HTMLVideoElement) { video.srcObject = stream; void video.play(); return () => { clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); }; }, robotStream: undefined },
      onLeave: () => {},
    };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(host as never, async () => ({
      detect() { fixture.detects++; return [{ x: 0.3, y: 0.2, width: 0.2, height: 0.3 }]; },
      close() {},
    }));
  });
  await page.locator("#relay-token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Connect Jev relay" }).click();
  await page.locator("#tracking-enable").check();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fakeReflexMotion: { detects: number } }).fakeReflexMotion.detects)).toBeGreaterThan(0);
  await page.locator("#motion-enable").check();
  blockReady = true;
  await expect.poll(() => blocked).toBe(true);
  await expect(page.locator("#stream-note")).toContainText("motion held", { timeout: 4000 });
  await page.waitForTimeout(400); // Cached copies must retain the original observation age.
  expect(await page.evaluate(() => (window as unknown as { fakeReflexMotion: { commands: unknown[] } }).fakeReflexMotion.commands)).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { fakeReflexMotion: { commands: unknown[] } }).fakeReflexMotion.commands.length), { timeout: 5000 }).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
});

test("recycling a face label discards an in-flight judgment before robot motion", async ({ page }) => {
  let blockOld = false;
  let oldBlocked = false;
  let freshBlocked = false;
  let releaseOld: (() => void) | undefined;
  let releaseFresh: (() => void) | undefined;
  await page.route("http://127.0.0.1:8048/v1/systemone", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const { state } = route.request().postDataJSON();
    const people = state.people as Array<{ id: string }>;
    let model = "setup-fixture";
    if (blockOld && !oldBlocked && people.length === 9) {
      oldBlocked = true;
      await new Promise<void>((resolve) => { releaseOld = resolve; });
      model = "old-face-fixture";
    } else if (oldBlocked && !freshBlocked && people.length === 9) {
      freshBlocked = true;
      await new Promise<void>((resolve) => { releaseFresh = resolve; });
      model = "fresh-face-fixture";
    }
    const noul = (value: number) => ({ type: "noul", noul: value });
    const answers = {
      attention_target: { type: "choice", choice: people[0]?.id ?? "none", confidence: 0.9 },
      addressed: noul(0.1), addressed_by_gaze: noul(0.1), wants_reply: noul(0.1),
      pause_invites_ack: noul(0.1), being_ignored: noul(0.1), someone_leaving: noul(0.1),
      someone_arriving: noul(0.1), turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
      engagement: { type: "score", score: 2 }, speaker_mood: { type: "choice", choice: "neutral", confidence: 0.9 },
      group_talking_to_each_other: noul(0.1), robot_named: noul(0.1), question_asked: noul(0.1),
      laughter_moment: noul(0.1), silence_awkward: noul(0.1),
    };
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ model, answers }) });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    const original = Array.from({ length: 9 }, (_, index) => ({ x: index * 0.105, y: 0.2, width: 0.08, height: 0.3 }));
    const fixture = { boxes: original, commands: [] as unknown[] };
    (window as unknown as { faceRecycleFixture: typeof fixture }).faceRecycleFixture = fixture;
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext("2d")!;
    let shade = 0;
    const draw = window.setInterval(() => { context.fillStyle = `rgb(${shade++ % 255},0,0)`; context.fillRect(0, 0, 320, 240); }, 50);
    const stream = canvas.captureStream(30);
    const host = {
      reachy: {
        state: "streaming",
        setTarget(target: unknown) { fixture.commands.push(target); return true; },
        gotoTarget(target: unknown) { fixture.commands.push(target); return true; },
      },
      media: { attachVideo(video: HTMLVideoElement) { video.srcObject = stream; void video.play(); return () => { clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); }; }, robotStream: undefined },
      onLeave: () => {},
    };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(host as never, async () => ({ detect() { return fixture.boxes; }, close() {} }));
  });
  await page.locator("#relay-token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Connect Jev relay" }).click();
  await page.locator("#tracking-enable").check();
  await expect(page.locator("#person-count")).toHaveText("9");
  blockOld = true;
  await page.locator("#motion-enable").check();
  await expect.poll(() => oldBlocked).toBe(true);
  await page.evaluate(() => {
    const fixture = (window as unknown as { faceRecycleFixture: { boxes: Array<{ x: number; y: number; width: number; height: number }>; commands: unknown[] } }).faceRecycleFixture;
    fixture.commands.length = 0;
    // Retire p9 for a nearby box: the bearing shifts <8°, so the normal
    // source/latest bearing gate alone would not reject the old answer.
    fixture.boxes = [...fixture.boxes.slice(0, 8), { x: 0.95, y: 0.2, width: 0.04, height: 0.3 }];
  });
  await expect(page.locator("#status")).toContainText("Face label recycled");
  releaseOld?.();
  await expect.poll(() => freshBlocked).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { faceRecycleFixture: { commands: unknown[] } }).faceRecycleFixture.commands)).toHaveLength(0);
  await expect(page.locator("#stream-note")).not.toContainText("old-face-fixture");
  releaseFresh?.();
  await expect.poll(() => page.evaluate(() => (window as unknown as { faceRecycleFixture: { commands: unknown[] } }).faceRecycleFixture.commands.length), { timeout: 5_000 }).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
});

test("over-capacity face frames disarm motion until a fresh scene is explicitly re-armed", async ({ page }) => {
  let jevCalls = 0;
  await page.route("http://127.0.0.1:8048/v1/systemone", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    jevCalls++;
    const { questions } = route.request().postDataJSON() as { questions: Record<string, { type: string; criteria?: Record<string, null> }> };
    const answers = Object.fromEntries(Object.entries(questions).map(([key, question]) => [key,
      question.type === "choice" ? { type: "choice", choice: Object.keys(question.criteria ?? {})[0], confidence: 0.9 }
        : question.type === "score" ? { type: "score", score: 2 } : { type: "noul", noul: 0.1 },
    ]));
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ model: "fixture", answers }) });
  });
  await page.goto("/?preview=1");
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    const fixture = {
      boxes: [{ x: 0.3, y: 0.2, width: 0.08, height: 0.3 }],
      commands: [] as unknown[],
    };
    (window as unknown as { crowdFixture: typeof fixture }).crowdFixture = fixture;
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext("2d")!;
    let shade = 0;
    const draw = window.setInterval(() => { context.fillStyle = `rgb(${shade++ % 255},0,0)`; context.fillRect(0, 0, 320, 240); }, 50);
    const stream = canvas.captureStream(30);
    const host = {
      reachy: {
        state: "streaming",
        setTarget(target: unknown) { fixture.commands.push(target); return true; },
        gotoTarget(target: unknown) { fixture.commands.push(target); return true; },
      },
      media: { attachVideo(video: HTMLVideoElement) { video.srcObject = stream; void video.play(); return () => { clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); }; }, robotStream: undefined },
      onLeave: () => {},
    };
    const { mountApp } = await import("/src/embed.ts");
    mountApp(host as never, async () => ({ detect() { return fixture.boxes; }, close() {} }));
  });
  await page.locator("#relay-token").fill("t".repeat(32));
  await page.getByRole("button", { name: "Connect Jev relay" }).click();
  await page.locator("#tracking-enable").check();
  await expect(page.locator("#person-count")).toHaveText("1");
  await page.locator("#motion-enable").check();
  await expect.poll(() => page.evaluate(() => (window as unknown as { crowdFixture: { commands: unknown[] } }).crowdFixture.commands.length)).toBeGreaterThan(0);

  await page.evaluate(() => {
    const fixture = (window as unknown as { crowdFixture: { boxes: Array<{ x: number; y: number; width: number; height: number }> } }).crowdFixture;
    fixture.boxes = Array.from({ length: 10 }, (_, index) => ({ x: index * 0.09, y: 0.2, width: 0.06, height: 0.3 }));
  });
  await expect(page.locator("#status")).toContainText("More than nine faces detected");
  await expect(page.locator("#motion-enable")).not.toBeChecked();
  await expect(page.locator("#motion-enable")).toBeDisabled();
  await expect(page.locator("#person-count")).toHaveText("0");
  await expect(page.locator("jev-panel").locator("jev-gauge")).toHaveCount(0);
  const heldCount = await page.evaluate(() => (window as unknown as { crowdFixture: { commands: unknown[] } }).crowdFixture.commands.length);
  const heldCalls = jevCalls;
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { crowdFixture: { commands: unknown[] } }).crowdFixture.commands.length)).toBe(heldCount);
  expect(jevCalls).toBe(heldCalls);

  await page.evaluate(() => {
    const fixture = (window as unknown as { crowdFixture: { boxes: Array<{ x: number; y: number; width: number; height: number }> } }).crowdFixture;
    fixture.boxes = [{ x: 0.3, y: 0.2, width: 0.08, height: 0.3 }];
  });
  await expect(page.locator("#status")).toContainText("Face tracking recovered");
  await expect(page.locator("#motion-enable")).toBeEnabled();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { crowdFixture: { commands: unknown[] } }).crowdFixture.commands.length)).toBe(heldCount);
  await page.locator("#motion-enable").check();
  await expect.poll(() => page.evaluate(() => (window as unknown as { crowdFixture: { commands: unknown[] } }).crowdFixture.commands.length)).toBeGreaterThan(heldCount);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
});
