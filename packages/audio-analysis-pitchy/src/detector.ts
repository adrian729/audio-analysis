import { PitchDetector as Pitchy } from 'pitchy';
import type { PitchDetector } from '@polyhymnia/audio-analysis';
/** Pitchy-specific configuration stays inside this adapter. */
export function createPitchyDetector(windowSize = 4096): PitchDetector {
  if (!Number.isSafeInteger(windowSize) || windowSize < 32 || windowSize > 65536) throw new RangeError('Invalid pitch window.');
  const detector = Pitchy.forFloat32Array(windowSize);
  return {
    windowSize,
    detect(samples, sampleRate) {
      if (samples.length !== windowSize || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid pitch input.');
      const [frequencyHz, clarity] = detector.findPitch(samples, sampleRate);
      return { frequencyHz, clarity };
    },
  };
}
