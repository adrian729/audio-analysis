import { expect, test, vi } from 'vitest';
import { createAnalysisWorker } from '../packages/audio-analysis/src/browser/index.js';
import { createMicrophoneSession } from '../packages/audio-input/src/browser/index.js';
class TestWorker extends EventTarget {
  messages: any[] = []; terminated = false;
  postMessage(data: any) { this.messages.push(data); }
  terminate() { this.terminated = true; }
  ack(index: number, observations: any[] = []) { const data = this.messages[index]; this.dispatchEvent(new MessageEvent('message', { data: { ...data, type: 'ack', observations } })); }
}
test('worker acknowledges delivery, preserves caller buffers and rejects overload', async () => {
  const worker = new TestWorker(), observations: number[] = [];
  const client = createAnalysisWorker<number>({ generation: 'g', epochId: 'e', sampleRate: 48000,
    worker: worker as unknown as Worker, maximumPending: 1, onObservations: batch => observations.push(...batch.observations) });
  worker.ack(0); await client.ready;
  const samples = new Float32Array([.1, .2]); const pushed = client.push(samples, 100); await Promise.resolve();
  expect(worker.messages[1].samples).not.toBe(samples); expect(samples.byteLength).toBe(8);
  worker.ack(1, [42]); await pushed; expect(observations).toEqual([42]);
  const cutoff = client.setCutoff(102); await Promise.resolve(); worker.ack(2); await cutoff;
  const finished = client.finish(102); await Promise.resolve(); worker.ack(3); await finished;
  client.dispose(); expect(worker.terminated).toBe(true);
  const otherWorker = new TestWorker();
  const other = createAnalysisWorker({ generation: 'g', epochId: 'e', sampleRate: 48000,
    worker: otherWorker as unknown as Worker, maximumPending: 1, onObservations() {} });
  otherWorker.ack(0); await other.ready;
  const first = other.push(new Float32Array(2), 0), rejected = expect(first).rejects.toThrow('overrun');
  await expect(other.push(new Float32Array(2), 2)).rejects.toThrow('overrun'); await rejected;
});
test('cancelled permissions stop late owned streams and never resume a cancelled preparation', async () => {
  let deliver!: (stream: MediaStream) => void;
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(resolve => { deliver = resolve; }) } });
  const session = createMicrophoneSession({ context: {} as AudioContext });
  const ready = session.prepare(); session.cancel(); deliver(stream);
  await expect(ready).rejects.toThrow('cancelled'); expect(stop).toHaveBeenCalledOnce(); expect(session.ready).toBe(false);
  session.dispose(); vi.unstubAllGlobals();
});

test('borrowed contexts and streams survive capture disposal; asynchronous delivery is acknowledged before drain', async () => {
  let worklet: { port: { onmessage?: (message: { data: any }) => void; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }; disconnect: ReturnType<typeof vi.fn> };
  const stop = vi.fn(), close = vi.fn(), track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, stop, getSettings: () => ({ sampleRate: 44100 }) });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const context = Object.assign(new EventTarget(), { state: 'running', sampleRate: 48000, close, audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), destination: {} }) as unknown as AudioContext;
  vi.stubGlobal('AudioWorkletNode', class {
    port = { onmessage: undefined, postMessage: vi.fn(), close: vi.fn() }; disconnect = vi.fn(); connect() {}
    constructor() { worklet = this; }
  });
  try {
    const session = createMicrophoneSession({ context, stream }); await session.prepare();
    let delivered!: () => void; const delivery = new Promise<void>(resolve => { delivered = resolve; });
    session.start({ epochId: 'borrowed', onChunk: () => delivery });
    worklet!.port.onmessage!({ data: { type: 'chunk', epochId: 'borrowed', samples: new Float32Array(2), startFrame: 100, sequence: 0, sampleRate: 48000 } });
    await Promise.resolve(); expect(worklet!.port.postMessage).toHaveBeenCalledTimes(1);
    delivered(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(worklet!.port.postMessage).toHaveBeenCalledWith({ type: 'ack', epochId: 'borrowed' });
    const drain = session.finish(102, 110); worklet!.port.onmessage!({ data: { type: 'drained', epochId: 'borrowed' } }); await drain;
    session.dispose(); session.dispose(); expect(stop).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(worklet!.disconnect).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
