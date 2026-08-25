const CAPTURE_WORKLET_URL = "/clouva-ai/worklets/capture.worklet.js";

function pcmBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

export class TrebolAudioCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  constructor(private readonly onChunk: (base64Pcm: string) => void) {}

  async start() {
    if (this.node) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      throw new Error("Este navegador no admite AudioWorklet para Trébol Live.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    await this.context.resume();

    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "trebol-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetSampleRate: 16_000, chunkSamples: 320 },
    });
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.node.port.onmessage = (event: MessageEvent<{ type?: string; buffer?: ArrayBuffer }>) => {
      if (event.data?.type !== "pcm" || !event.data.buffer) return;
      this.onChunk(pcmBase64(new Int16Array(event.data.buffer)));
    };
    source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.context.destination);
  }

  setMuted(muted: boolean) {
    this.node?.port.postMessage({ type: "enabled", enabled: !muted });
  }

  async stop() {
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.node = null;
    this.sink = null;
    this.stream = null;
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
  }
}
