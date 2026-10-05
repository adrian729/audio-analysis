import { createFramer } from './framing.js';
import { measureSignal } from './measurements.js';
export interface OnsetOptions { windowMs?: number; minimumRms?: number; riseRatio?: number; minimumSpacingMs?: number; confirmationMs?: number }
export interface OnsetObservation { frame: number; confirmedThroughFrame: number; strength: number }
export function createOnsetAnalyzer(sampleRate: number, options: OnsetOptions = {}) {
  const windowMs = options.windowMs ?? 4, minimumRms = options.minimumRms ?? .025;
  const riseRatio = options.riseRatio ?? 3, spacingMs = options.minimumSpacingMs ?? 65, confirmationMs = options.confirmationMs ?? 16;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || ![windowMs, minimumRms, riseRatio, spacingMs, confirmationMs].every(Number.isFinite) ||
      windowMs <= 0 || minimumRms <= 0 || riseRatio <= 1 || spacingMs < 0 || confirmationMs < windowMs) throw new RangeError('Invalid onset options.');
  const size = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const framer = createFramer(size);
  let noise = .001, previous = 0, lastAttack = -Infinity;
  let candidate: { frame: number; strength: number } | undefined;
  const tailFrames = Math.ceil(sampleRate * (confirmationMs + windowMs) / 1000);
  const resetState = () => { noise = .001; previous = 0; lastAttack = -Infinity; candidate = undefined; };
  const process = (windows: ReturnType<typeof framer.push>, eligibilityEndFrame: number): OnsetObservation[] => {
    const result: OnsetObservation[] = [];
    for (const window of windows) {
      const { rms } = measureSignal(window.samples.subarray(0, window.validFrames));
      const threshold = Math.max(minimumRms, noise * riseRatio);
      if (!candidate && rms >= threshold && rms > Math.max(previous * 1.4, noise * riseRatio) &&
          window.startFrame - lastAttack >= spacingMs * sampleRate / 1000) {
        candidate = { frame: window.startFrame, strength: rms };
      }
      if (candidate) {
        candidate.strength = Math.max(candidate.strength, rms);
        if (window.endFrame - candidate.frame >= confirmationMs * sampleRate / 1000) {
          if (candidate.frame < eligibilityEndFrame) result.push({ ...candidate, confirmedThroughFrame: window.endFrame });
          lastAttack = candidate.frame; candidate = undefined;
        }
      }
      if (rms < threshold) noise = .98 * noise + .02 * rms;
      previous = rms;
    }
    return result;
  };
  return {
    tailFrames,
    reset() { framer.reset(); resetState(); },
    push(samples: Float32Array, startFrame?: number, eligibilityEndFrame = Infinity) {
      if (startFrame !== undefined && framer.nextFrame !== undefined && startFrame !== framer.nextFrame) resetState();
      return process(framer.push(samples, startFrame), eligibilityEndFrame);
    },
    finish(eligibilityEndFrame = Infinity) {
      const result = process(framer.flush(), eligibilityEndFrame);
      // A truncated unconfirmed attack is deliberately uncertain, not a fabricated onset.
      candidate = undefined;
      return result;
    },
  };
}
