// Output stays silent. The host-owned robot track is copied only to this tab.
class ReflexRobotVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(2048);
    this.cursor = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels?.length && channels[0]?.length) {
      for (let index = 0; index < channels[0].length; index++) {
        let mono = 0;
        for (const channel of channels) mono += channel[index] / channels.length;
        this.pending[this.cursor++] = mono;
        if (this.cursor === this.pending.length) {
          this.port.postMessage(this.pending, [this.pending.buffer]);
          this.pending = new Float32Array(2048);
          this.cursor = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("reflex-robot-voice", ReflexRobotVoiceProcessor);
