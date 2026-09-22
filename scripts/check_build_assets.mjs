import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve("dist", path));
const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const mediapipePackage = JSON.parse(readFileSync(resolve("node_modules/@mediapipe/tasks-vision/package.json"), "utf8"));
const modelHash = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";
const model = read("mediapipe/face_detector.tflite");
assert.equal(createHash("sha256").update(model).digest("hex"), modelHash);

const notices = read("THIRD_PARTY_NOTICES.md").toString();
const license = read("licenses/Apache-2.0.txt").toString();
const bundle = readdirSync(resolve("dist", "assets"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => read(`assets/${name}`).toString())
  .join("\n");
assert.equal(mediapipePackage.version, manifest.dependencies["@mediapipe/tasks-vision"]);
assert.equal(mediapipePackage.license, "Apache-2.0");
assert.ok(notices.includes(`@mediapipe/tasks-vision\` ${mediapipePackage.version}`));
assert.ok(notices.includes(modelHash));
assert.match(notices, /Apache License 2\.0/);
assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
assert.match(bundle, /THIRD_PARTY_NOTICES\.md/);

for (const name of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
  assert.ok(statSync(resolve("dist", "mediapipe", "wasm", name)).size > 0);
}

console.log("Build assets and notices verified");
