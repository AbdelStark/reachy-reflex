import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { createRelayServer } from "../server/relay.mjs";

const publisherToken = "p".repeat(40);
const subscriberToken = "s".repeat(40);

test("a synthetic camera judgment crosses the real loopback relay to a read-only subscriber", async ({ page }) => {
  let modelCalls = 0;
  const server = createRelayServer({
    token: publisherToken,
    eventSubscriberToken: subscriberToken,
    allowedOrigin: "http://127.0.0.1:5173",
    ask: async (state: { people: Array<{ id: string }> }) => {
      modelCalls++;
      const person = state.people[0]?.id ?? "none";
      const noul = (value: number) => ({ type: "noul", noul: value });
      return {
        model: "synthetic-relay",
        answers: {
          attention_target: { type: "choice", choice: person, confidence: 0.9 },
          addressed: noul(0.1), addressed_by_gaze: noul(0.1), wants_reply: noul(0.1),
          pause_invites_ack: noul(0.1), being_ignored: noul(0.1), someone_leaving: noul(0.1),
          someone_arriving: noul(0.1), turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
          engagement: { type: "score", score: 2 }, speaker_mood: { type: "choice", choice: "neutral", confidence: 0.9 },
          group_talking_to_each_other: noul(0.1), robot_named: noul(0.1), question_asked: noul(0.1),
          laughter_moment: noul(0.1), silence_awkward: noul(0.1),
        },
      };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("event relay did not bind to loopback");
  const subscriber = new WebSocket(`ws://127.0.0.1:${address.port}/v1/events`, {
    headers: { Authorization: `Bearer ${subscriberToken}` },
  });
  subscriber.on("error", () => {}); // Teardown of a failed handshake must not mask the test failure.
  const received: Array<Record<string, unknown>> = [];
  subscriber.on("message", (data) => received.push(JSON.parse(data.toString())));
  try {
    await new Promise<void>((resolve, reject) => {
      subscriber.once("open", resolve);
      subscriber.once("error", reject);
    });
    await page.goto("/?preview=1");
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("pagehide"));
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 240;
      const context = canvas.getContext("2d")!;
      let shade = 0;
      const draw = window.setInterval(() => {
        context.fillStyle = `rgb(${shade++ % 255},0,0)`;
        context.fillRect(0, 0, 320, 240);
      }, 50);
      const stream = canvas.captureStream(30);
      const commands: unknown[] = [];
      (window as unknown as { integrationMotionCommands: unknown[] }).integrationMotionCommands = commands;
      const host = {
        reachy: {
          state: "streaming",
          setTarget(target: unknown) { commands.push(target); return true; },
          gotoTarget(target: unknown) { commands.push(target); return true; },
        },
        media: {
          attachVideo(video: HTMLVideoElement) {
            video.srcObject = stream;
            void video.play();
            return () => { clearInterval(draw); stream.getTracks().forEach((track) => track.stop()); };
          },
          robotStream: undefined,
        },
        onLeave: () => {},
      };
      const { mountApp } = await import("/src/embed.ts");
      mountApp(host as never, async () => ({
        detect() { return [{ x: 0.3, y: 0.2, width: 0.2, height: 0.3 }]; },
        close() {},
      }));
    });
    await page.locator("#relay-url").fill(`http://127.0.0.1:${address.port}`);
    await page.locator("#relay-token").fill(publisherToken);
    await page.getByRole("button", { name: "Connect Jev relay" }).click();
    await page.locator("#tracking-enable").check();
    await expect(page.locator("#decision")).toHaveText("Looking at p1");
    expect(received).toEqual([]); // Publisher remains off until the separate switch is checked.
    await page.locator("#events-enable").check();
    await expect.poll(() => received.length).toBeGreaterThan(0);
    await expect(page.locator("#events-status")).toContainText("1 connected subscriber");
    expect(modelCalls).toBeGreaterThan(0);
    expect(received[0]).toMatchObject({
      schema: "reflex.event@1",
      event: { type: "attention", person: "p1" },
    });
    expect(Number.isSafeInteger(received[0].seq)).toBe(true);
    expect(Number.isFinite(received[0].t_ms)).toBe(true);
    expect(JSON.stringify(received)).not.toContain("transcript");
    expect(await page.evaluate(() => (window as unknown as { integrationMotionCommands: unknown[] }).integrationMotionCommands)).toEqual([]);
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide"))).catch(() => {});
    if (subscriber.readyState === WebSocket.OPEN) {
      const closed = new Promise<void>((resolve) => subscriber.once("close", resolve));
      subscriber.close();
      await closed;
    } else subscriber.terminate();
    await new Promise<void>((resolve) => server.close(resolve));
  }
});
