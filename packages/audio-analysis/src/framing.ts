export interface SampleWindow {
  samples: Float32Array;
  startFrame: number;
  endFrame: number;
  /** Real sample count; zero padding is never eligible hold coverage. */
  validFrames: number;
  padded: boolean;
}
export function createFramer(windowSize: number, hopSize: number = windowSize) {
  if (!Number.isSafeInteger(windowSize) || windowSize <= 0 || !Number.isSafeInteger(hopSize) ||
      hopSize <= 0 || hopSize > windowSize) throw new RangeError('Invalid window/hop size.');
  const buffer = new Float32Array(windowSize);
  let count = 0, origin = 0, next: number | undefined, lastEnd = -1;
  const reset = () => { count = 0; next = undefined; lastEnd = -1; buffer.fill(0); };
  return {
    get bufferedFrames() { return count; },
    get nextFrame() { return next; },
    reset,
    push(samples: Float32Array, startFrame = next ?? 0): SampleWindow[] {
      if (!Number.isSafeInteger(startFrame) || startFrame < 0) throw new RangeError('Invalid frame position.');
      if (next !== undefined && startFrame !== next) reset();
      if (next === undefined) origin = startFrame;
      const windows: SampleWindow[] = [];
      for (const sample of samples) {
        if (!Number.isFinite(sample)) throw new RangeError('Non-finite sample.');
        buffer[count++] = sample;
        if (count === windowSize) {
          const endFrame = origin + windowSize;
          windows.push({ samples: buffer.slice(), startFrame: origin, endFrame, validFrames: windowSize, padded: false });
          lastEnd = endFrame;
          buffer.copyWithin(0, hopSize);
          count -= hopSize;
          origin += hopSize;
        }
      }
      next = startFrame + samples.length;
      return windows;
    },
    flush(): SampleWindow[] {
      if (!count || next === undefined || next <= lastEnd) { reset(); return []; }
      const samples = new Float32Array(windowSize);
      samples.set(buffer.subarray(0, count));
      const window = { samples, startFrame: origin, endFrame: origin + count, validFrames: count, padded: true };
      reset();
      return [window];
    },
  };
}
