class TrebolPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputSampleRate = options.processorOptions?.inputSampleRate || 24000;
    this.step = this.inputSampleRate / sampleRate;
    this.queue = [];
    this.position = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "clear") {
        this.queue = [];
        this.position = 0;
        return;
      }
      if (event.data?.type !== "enqueue" || !event.data.buffer) return;
      const pcm = new Int16Array(event.data.buffer);
      for (let index = 0; index < pcm.length; index += 1) this.queue.push(pcm[index] / 32768);
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    for (let frame = 0; frame < output.length; frame += 1) {
      if (this.position + 1 >= this.queue.length) {
        output[frame] = 0;
        continue;
      }
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      output[frame] = this.queue[left] * (1 - fraction) + this.queue[left + 1] * fraction;
      this.position += this.step;
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.queue.splice(0, consumed);
      this.position -= consumed;
    }
    return true;
  }
}

registerProcessor("trebol-playback", TrebolPlaybackProcessor);
