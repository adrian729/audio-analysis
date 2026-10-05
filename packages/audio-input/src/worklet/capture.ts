declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class CaptureProcessor extends AudioWorkletProcessor {
  private epochId = ''; private sequence = 0; private inflight = 0;
  private readonly batch = new Float32Array(2048); private count = 0; private origin = 0;
  private cutoff = Infinity; private active = false; private stopping = false;
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        if (this.active || this.inflight) { this.fail('Capture is still draining.'); return; }
        this.epochId = data.epochId; this.sequence = 0; this.count = 0; this.cutoff = Infinity;
        this.active = true; this.stopping = false;
      } else if (data.type === 'cutoff' && data.epochId === this.epochId) this.cutoff = data.processingEndFrame;
      else if (data.type === 'stop' && data.epochId === this.epochId) { this.active = false; this.flush(); this.stopping = true; this.drained(); }
      else if (data.type === 'ack' && data.epochId === this.epochId) { this.inflight--; this.drained(); }
    };
  }
  private fail(reason: string) { this.active = false; this.port.postMessage({ type: 'fault', reason, epochId: this.epochId }); }
  private drained() {
    if (this.stopping && this.inflight === 0) { this.stopping = false; this.port.postMessage({ type: 'drained', epochId: this.epochId }); }
  }
  private flush() {
    if (!this.count) return;
    if (this.inflight >= 8) { this.fail('Capture transport overrun.'); this.count = 0; return; }
    const samples = this.batch.slice(0, this.count);
    this.port.postMessage({ type: 'chunk', epochId: this.epochId, sampleRate, startFrame: this.origin,
      sequence: this.sequence++, samples }, [samples.buffer]);
    this.inflight++; this.count = 0;
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (!this.active) return true;
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) { this.fail('Microphone input disappeared.'); return true; }
    const frames = channels[0].length;
    for (let i = 0; i < frames && this.active; i++) {
      const frame = currentFrame + i;
      if (frame >= this.cutoff) { this.active = false; this.flush(); this.stopping = true; this.drained(); break; }
      if (!this.count) this.origin = frame;
      let sample = 0;
      for (const channel of channels) sample += (channel[i] ?? 0) / channels.length;
      this.batch[this.count++] = sample;
      if (this.count === this.batch.length) this.flush();
    }
    return true;
  }
}
registerProcessor('polyhymnia-capture', CaptureProcessor);
