/*
 * The direct capture channel. The application creates a MessageChannel and hands one port to the
 * capture worklet (audio-input) and the other to an analysis worker (audio-analysis). The worklet
 * posts PCM chunks on it and the worker acknowledges each one on it, so capture never waits on the
 * main thread. Only those two bundled assets speak this protocol; neither package imports the
 * other, and this package is never published: esbuild inlines it into both assets.
 */

/** Bumped on any incompatible change, so mismatched assets fail loudly instead of stalling. */
export const CAPTURE_PROTOCOL = 1;

export interface CaptureChunk {
  type: 'chunk';
  protocol: typeof CAPTURE_PROTOCOL;
  epochId: string;
  sampleRate: number;
  /** Frame of the first sample on the capture clock. */
  startFrame: number;
  /** 0, 1, 2… within an epoch. */
  sequence: number;
  samples: Float32Array;
}

export interface CaptureAck {
  type: 'ack';
  epochId: string;
}

/**
 * Worker side: hands each chunk to `handle` in order and acknowledges it once handled. A channel
 * carries one capture epoch: a chunk from another epoch or protocol version, out of sequence or not
 * continuous with the last ends it through `fault`, unacknowledged, so the worklet stops too.
 */
export function receiveCapture(
  port: MessagePort,
  handle: (chunk: CaptureChunk) => void,
  fault: (reason: string) => void,
): () => void {
  let sequence = 0, nextFrame: number | undefined, epochId: string | undefined, open = true;
  const close = () => { open = false; port.onmessage = null; port.close(); };
  port.onmessage = ({ data }: MessageEvent<CaptureChunk>) => {
    if (!open || data?.type !== 'chunk') return;
    epochId ??= data.epochId;
    const reason = data.protocol !== CAPTURE_PROTOCOL ? 'Capture protocol mismatch.'
      : data.epochId !== epochId || data.sequence !== sequence || (nextFrame !== undefined && data.startFrame !== nextFrame)
        ? 'Sample discontinuity.'
      : undefined;
    if (reason) { close(); fault(reason); return; }
    sequence++; nextFrame = data.startFrame + data.samples.length;
    try { handle(data); }
    catch (error) { close(); fault(error instanceof Error ? error.message : 'Analysis failed.'); return; }
    port.postMessage({ type: 'ack', epochId } satisfies CaptureAck);
  };
  return close;
}
