import { ReachyMini } from "@pollen-robotics/reachy-mini-sdk";

(window as unknown as { ReachyMini: typeof ReachyMini }).ReachyMini = ReachyMini;
window.dispatchEvent(new Event("reachymini:ready"));

const params = new URLSearchParams(location.search);
if (params.get("preview") === "1" || params.get("embedded") === "1" || params.get("embed") === "1") {
  void import("./embed.js");
} else {
  void import("@pollen-robotics/reachy-mini-sdk/host/auto").then(({ mountHost }) => {
    mountHost({ appName: "Reachy Reflex", appIconUrl: "/icon.svg", appEmoji: "⚡", enableMicrophone: true });
  });
}
