import { test, expect } from "@playwright/test";

test("fixture preview renders all 16 signals and reacts to synthetic room changes", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/v1/systemone")) requests.push(request.url()); });
  await page.goto("/?preview=1");
  await expect(page.locator("#connection")).toHaveText("FIXTURE PREVIEW");
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
