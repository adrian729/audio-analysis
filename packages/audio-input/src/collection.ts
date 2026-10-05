import { validatePCM, type PCMChunk, type PCMRecording } from './pcm.js';

/** Retains copies. The caller must opt in to a finite recording limit. */
export function createPCMCollector(maxFrames: number) {
  if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) throw new RangeError('Invalid recording limit.');
  let chunks: Float32Array[] = [];
  let frames = 0;
  let origin: Omit<PCMRecording, 'samples'> | undefined;
  let sequence: number | undefined;
  return {
    get frames() { return frames; },
    append(chunk: PCMChunk) {
      validatePCM(chunk);
      if (!Number.isSafeInteger(chunk.sequence) || chunk.sequence < 0) throw new RangeError('Invalid chunk sequence.');
      if (frames + chunk.samples.length > maxFrames) throw new RangeError('Recording limit exceeded.');
      if (origin && (origin.epochId !== chunk.epochId || origin.sampleRate !== chunk.sampleRate ||
          chunk.startFrame !== origin.startFrame + frames || chunk.sequence !== sequence! + 1)) {
        throw new Error('Recording is discontinuous.');
      }
      origin ??= { epochId: chunk.epochId, sampleRate: chunk.sampleRate, startFrame: chunk.startFrame };
      sequence = chunk.sequence;
      chunks.push(chunk.samples.slice());
      frames += chunk.samples.length;
    },
    finish(): PCMRecording {
      if (!origin) throw new Error('No captured samples.');
      const samples = new Float32Array(frames);
      let at = 0;
      for (const chunk of chunks) { samples.set(chunk, at); at += chunk.length; }
      return { ...origin, samples };
    },
    clear() { chunks = []; frames = 0; origin = undefined; sequence = undefined; },
  };
}
