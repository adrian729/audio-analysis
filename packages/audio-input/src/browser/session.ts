import type { PCMChunk } from '../pcm.js';
import { estimateCaptureClock, clockDeviationMs, type CaptureClock } from './clock.js';
export interface MicrophoneOptions {
  context: AudioContext;
  /** Supplied streams are borrowed. Acquired streams are owned. Contexts are always borrowed. */
  stream?: MediaStream;
  workletUrl?: string | URL;
  constraints?: MediaTrackConstraints;
  onFault?: (reason: string) => void;
}
export interface CaptureStart {
  epochId: string;
  /** Delivers each chunk on the main thread; capture waits for the returned promise. */
  onChunk?: (chunk: PCMChunk) => void | Promise<void>;
  /**
   * Sends chunks straight to an analysis worker holding the other end of this channel, which
   * acknowledges them itself, so capture never waits on the main thread. Pass this or `onChunk`.
   */
  chunkPort?: MessagePort;
  clock?: CaptureClock;
  maximumClockDeviationMs?: number;
}
export function createMicrophoneSession(options: MicrophoneOptions) {
  const context = options.context;
  let stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined, node: AudioWorkletNode | undefined;
  let revision = 0;
  let disposed = false, preparing: Promise<void> | undefined, active: CaptureStart | undefined;
  let drain: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  let cleanups: (() => void)[] = [];
  const owned = !options.stream;
  const clearDrain = (error?: Error) => {
    if (!drain) return; const pending = drain; drain = undefined; clearTimeout(pending.timer);
    if (error) pending.reject(error); else pending.resolve();
  };
  const release = () => {
    for (const cleanup of cleanups) cleanup(); cleanups = [];
    source?.disconnect(); node?.disconnect(); node?.port.close(); source = undefined; node = undefined;
    if (owned) stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  };
  const fault = (reason: string) => {
    active = undefined; clearDrain(new Error(reason)); release(); options.onFault?.(reason);
  };
  const prepare = async () => {
    if (disposed) throw new Error('Microphone session disposed.');
    if (node) return;
    if (preparing) return preparing;
    const token = revision;
    preparing = (async () => {
      const acquired = options.stream ?? await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...options.constraints }, video: false });
      if (disposed || token !== revision) { if (owned) acquired.getTracks().forEach(track => track.stop()); throw new Error('Microphone preparation cancelled.'); }
      stream = acquired;
      try {
        if (context.state === 'suspended') await context.resume();
        await context.audioWorklet.addModule(options.workletUrl ?? new URL('../capture-worklet.js', import.meta.url));
        if (disposed || token !== revision) throw new Error('Microphone preparation cancelled.');
        source = context.createMediaStreamSource(acquired);
        node = new AudioWorkletNode(context, 'polyhymnia-capture', { numberOfInputs: 1, numberOfOutputs: 1,
          outputChannelCount: [1], channelCountMode: 'max' });
        source.connect(node); node.connect(context.destination);
        node.port.onmessage = ({ data }) => {
          if (!active || data.epochId !== active.epochId) return;
          if (data.type === 'fault') fault(data.reason);
          else if (data.type === 'drained') { active = undefined; clearDrain(); }
          else if (data.type === 'position') clockChanged();
          else if (data.type === 'chunk') {
            if (clockChanged()) return;
            const currentNode = node, epochId = active.epochId;
            Promise.resolve().then(() => active?.epochId === epochId ? active.onChunk?.(data as PCMChunk) : undefined)
              .then(() => currentNode?.port.postMessage({ type: 'ack', epochId }),
                error => { if (node === currentNode && active?.epochId === epochId) fault(error instanceof Error ? error.message : 'Analysis delivery failed.'); });
          }
        };
        const clockChanged = () => {
          const changed = !!active?.clock && Math.abs(clockDeviationMs(active.clock, context)) > (active.maximumClockDeviationMs ?? 25);
          if (changed) fault('Capture clock changed.');
          return changed;
        };
        const interrupted = () => fault('Microphone track muted or ended.');
        for (const track of acquired.getAudioTracks()) {
          if (track.readyState !== 'live' || track.muted) throw new Error('Microphone track is unavailable.');
          track.addEventListener('ended', interrupted); track.addEventListener('mute', interrupted);
          cleanups.push(() => { track.removeEventListener('ended', interrupted); track.removeEventListener('mute', interrupted); });
        }
        const state = () => { if (active && context.state !== 'running') fault('Audio context suspended.'); };
        context.addEventListener('statechange', state); cleanups.push(() => context.removeEventListener('statechange', state));
      } catch (error) { release(); throw error; }
    })();
    try { await preparing; } finally { preparing = undefined; }
  };
  return {
    prepare,
    get ready() { return !!node && !disposed; },
    get settings() { return stream?.getAudioTracks().map(track => track.getSettings()) ?? []; },
    async clock(): Promise<CaptureClock> { if (!node) throw new Error('Prepare microphone first.'); return estimateCaptureClock(context); },
    start(start: CaptureStart) {
      if (!node || disposed || active || drain || !start.epochId || context.state !== 'running') throw new Error('Microphone is not ready to start.');
      if (!start.onChunk === !start.chunkPort) throw new TypeError('Pass either onChunk or chunkPort.');
      if (start.clock && (start.clock.sampleRate !== context.sampleRate || !Number.isFinite(start.clock.performanceOriginMs) ||
          !Number.isFinite(start.clock.uncertaintyMs) || start.clock.uncertaintyMs < 0)) throw new RangeError('Invalid capture clock.');
      if (start.maximumClockDeviationMs !== undefined && (!Number.isFinite(start.maximumClockDeviationMs) || start.maximumClockDeviationMs <= 0)) throw new RangeError('Invalid clock continuity limit.');
      active = { ...start, clock: start.clock ? { ...start.clock } : undefined };
      if (start.chunkPort) node.port.postMessage({ type: 'start', epochId: start.epochId, port: start.chunkPort }, [start.chunkPort]);
      else node.port.postMessage({ type: 'start', epochId: start.epochId });
    },
    /** Samples before eligibilityEndFrame may be graded; capture continues through processingEndFrame. */
    finish(eligibilityEndFrame: number, processingEndFrame: number, timeoutMs = 1500): Promise<void> {
      if (!active || !node || drain) return Promise.reject(new Error('No active capture or drain already pending.'));
      if (![eligibilityEndFrame, processingEndFrame].every(Number.isSafeInteger) || eligibilityEndFrame < 0 ||
          processingEndFrame < eligibilityEndFrame || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) {
        return Promise.reject(new RangeError('Invalid capture cutoff.'));
      }
      const epochId = active.epochId;
      return new Promise((resolve, reject) => {
        drain = { resolve, reject, timer: setTimeout(() => fault('Microphone drain timed out.'), timeoutMs) };
        node!.port.postMessage({ type: 'cutoff', epochId, processingEndFrame });
      });
    },
    cancel() { revision++; active = undefined; clearDrain(new Error('Capture cancelled.')); release(); },
    dispose() { revision++; disposed = true; active = undefined; clearDrain(new Error('Microphone session disposed.')); release(); },
  };
}
export type MicrophoneSession = ReturnType<typeof createMicrophoneSession>;
