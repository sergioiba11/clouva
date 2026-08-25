class TrebolCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate || 16000;
    this.chunkSamples = options.processorOptions?.chunkSamples || 320;
    this.ratio = sampleRate / this.targetSampleRate;
    this.source = [];
    this.position = 0;
    this.output = [];
    this.enabled = true;
    this.port.onmessage = (event) => {
      if (event.data?.type === "enabled") {
        this.enabled = event.data.enabled === true;
        if (!this.enabled) {
          this.source = [];
          this.position = 0;
          this.output = [];
        }
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input || !this.enabled) return true;

    for (let index = 0; index < input.length; index += 1) this.source.push(input[index]);
    while (this.position + 1 < this.source.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = this.source[left] * (1 - fraction) + this.source[left + 1] * fraction;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.output.push(clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767));
      this.position += this.ratio;

      if (this.output.length >= this.chunkSamples) {
        const pcm = Int16Array.from(this.output.splice(0, this.chunkSamples));
        this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);
      }
    }

    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.source.splice(0, consumed);
      this.position -= consumed;
    }
    return true;
  }
}

registerProcessor("trebol-capture", TrebolCaptureProcessor);
