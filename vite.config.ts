import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const wasmDir = resolve("node_modules/@mediapipe/tasks-vision/wasm");
const names = new Set(readdirSync(wasmDir));
const modelUrl = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const modelSha256 = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";
let modelPromise: Promise<Buffer> | undefined;
function modelBytes(): Promise<Buffer> {
  modelPromise ??= (async () => {
    const response = await fetch(modelUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`MediaPipe model download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== modelSha256) throw new Error("MediaPipe model checksum mismatch");
    return bytes;
  })().catch((error: unknown) => {
    modelPromise = undefined;
    throw error;
  });
  return modelPromise;
}

export default defineConfig({
  plugins: [{
    name: "local-mediapipe-wasm",
    configureServer(server) {
      server.middlewares.use("/mediapipe/face_detector.tflite", (_request, response) => {
        void modelBytes().then((bytes) => {
          response.setHeader("Content-Type", "application/octet-stream");
          response.end(bytes);
        }).catch(() => { response.statusCode = 503; response.end("model unavailable"); });
      });
      server.middlewares.use("/mediapipe/wasm", (request, response, next) => {
        const name = new URL(request.url ?? "", "http://localhost").pathname.slice(1);
        if (!names.has(name)) return next();
        response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        response.end(readFileSync(resolve(wasmDir, name)));
      });
    },
    async closeBundle() {
      const target = resolve("dist/mediapipe/wasm");
      mkdirSync(target, { recursive: true });
      cpSync(wasmDir, target, { recursive: true });
      writeFileSync(resolve("dist/mediapipe/face_detector.tflite"), await modelBytes());
    },
  }],
  build: { outDir: "dist", emptyOutDir: true },
});
