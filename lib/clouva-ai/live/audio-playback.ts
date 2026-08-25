const PLAYBACK_WORKLET_URL = "/clouva-ai/worklets/playback.worklet.js";

function decodePcm16(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const output = new ArrayBuffer(binary.length);
  const view = new Uint8Array(output);
  for (let index = 0; index < binary.length; index += 1) view[index] = binary.charCodeAt(index);
  return output;
}

export class TrebolAudioPlayback {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  async start() {
    if (this.node) return;
    if (typeof AudioWorkletNode === "undefined") throw new Error("Este navegador no admite reproducción Live con AudioWorklet.");
    this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.audioWorklet.addModule(PLAYBACK_WORKLET_URL);
    await this.context.resume();
    this.node = new AudioWorkletNode(this.context, "trebol-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { inputSampleRate: 24_000 },
    });
    this.node.connect(this.context.destination);
  }

  enqueue(base64Pcm: string) {
    if (!this.node || !base64Pcm) return;
    const buffer = decodePcm16(base64Pcm);
    this.node.port.postMessage({ type: "enqueue", buffer }, [buffer]);
  }

  clear() {
    this.node?.port.postMessage({ type: "clear" });
  }

  async stop() {
    this.clear();
    this.node?.disconnect();
    this.node = null;
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
  }
}
