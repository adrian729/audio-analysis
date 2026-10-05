export interface PCMChunk {
  epochId: string;
  sampleRate: number;
  startFrame: number;
  sequence: number;
  samples: Float32Array;
}
export interface PCMRecording {
  epochId: string;
  sampleRate: number;
  startFrame: number;
  samples: Float32Array;
}
export function validatePCM(chunk: PCMRecording): void {
  if (typeof chunk.epochId !== 'string' || !chunk.epochId || !Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0 ||
      !Number.isSafeInteger(chunk.startFrame) || chunk.startFrame < 0 || !(chunk.samples instanceof Float32Array) || !Number.isSafeInteger(chunk.startFrame + chunk.samples.length)) {
    throw new RangeError('Invalid PCM metadata.');
  }
  for (const sample of chunk.samples) if (!Number.isFinite(sample)) throw new RangeError('Non-finite PCM sample.');
}
