import { createFramer, type SampleWindow } from './framing.js';
import { measureSignal, type SignalLevel } from './measurements.js';
import type { PitchDetector, PitchOptions } from './pitch-detector.js';

export interface PitchObservation extends Omit<SampleWindow, 'samples'>, SignalLevel {
  status: 'pitched' | 'silent' | 'uncertain';
  frequencyHz?: number;
  clarity: number;
  stable: boolean;
}
export function createPitchAnalyzer(detector: PitchDetector, sampleRate: number, options: PitchOptions = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid sample rate.');
  const hop = options.hopSize ?? Math.floor(detector.windowSize / 4);
  const framer = createFramer(detector.windowSize, hop);
  const minimumRms = options.minimumRms ?? .008, minimumClarity = options.minimumClarity ?? .9;
  const minimumHz = options.minimumHz ?? 65, maximumHz = options.maximumHz ?? 1500;
  const stabilityCents = options.stabilityCents ?? 60;
  if (![minimumRms, minimumClarity, minimumHz, maximumHz, stabilityCents].every(Number.isFinite) ||
      minimumRms < 0 || minimumClarity < 0 || minimumClarity > 1 || minimumHz <= 0 ||
      maximumHz <= minimumHz || stabilityCents <= 0) throw new RangeError('Invalid pitch options.');
  let previousHz: number | undefined;
  let continuity = 0;
  const analyze = (window: SampleWindow): PitchObservation => {
    const level = measureSignal(window.samples.subarray(0, window.validFrames));
    const reading = detector.detect(window.samples, sampleRate);
    const full = window.validFrames === detector.windowSize;
    const frequencyHz = Number.isFinite(reading.frequencyHz) && reading.frequencyHz > 0 ? reading.frequencyHz : undefined;
    const clarity = Number.isFinite(reading.clarity) ? Math.max(0, Math.min(1, reading.clarity)) : 0;
    const status = level.rms < minimumRms ? 'silent' : full && frequencyHz !== undefined &&
      frequencyHz >= minimumHz && frequencyHz <= maximumHz && clarity >= minimumClarity ? 'pitched' : 'uncertain';
    const similar = status === 'pitched' && previousHz !== undefined &&
      Math.abs(1200 * Math.log2(frequencyHz! / previousHz)) <= stabilityCents;
    continuity = similar ? continuity + 1 : status === 'pitched' ? 1 : 0;
    previousHz = status === 'pitched' ? frequencyHz : undefined;
    const { samples: _, ...range } = window;
    return { ...range, ...level, frequencyHz, clarity, status, stable: continuity >= 3 };
  };
  return {
    /** Constant-size state; observations are streamed to the caller, never retained. */
    get retainedFrames() { return framer.bufferedFrames; },
    reset() { framer.reset(); previousHz = undefined; continuity = 0; },
    push(samples: Float32Array, startFrame?: number): PitchObservation[] {
      if (startFrame !== undefined && framer.nextFrame !== undefined && framer.nextFrame !== startFrame) {
        previousHz = undefined; continuity = 0;
      }
      return framer.push(samples, startFrame).map(analyze);
    },
    finish() { return framer.flush().map(analyze); },
  };
}

/** Exercise-neutral hold: the consumer supplies target qualification and generation. */
export function createSampleHold(options: { sampleRate: number; startFrame: number; endFrame?: number; generation: string }) {
  const { sampleRate, startFrame, generation } = options;
  const endFrame = options.endFrame ?? Infinity;
  if (!generation || !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(startFrame) ||
      startFrame < 0 || endFrame <= startFrame || (endFrame !== Infinity && !Number.isSafeInteger(endFrame))) {
    throw new RangeError('Invalid hold bounds.');
  }
  let beginning: number | undefined, lastEnd: number | undefined, lastStart = -1;
  const reset = () => { beginning = undefined; lastEnd = undefined; lastStart = -1; };
  const seconds = () => beginning === undefined || lastEnd === undefined ? 0 : (lastEnd - beginning) / sampleRate;
  return {
    reset,
    get seconds() { return seconds(); },
    observe(window: { startFrame: number; endFrame: number; validFrames: number; padded?: boolean }, qualifies: boolean, sourceGeneration: string): number {
      if (sourceGeneration !== generation) return seconds();
      const valid = !window.padded && Number.isSafeInteger(window.startFrame) && Number.isSafeInteger(window.endFrame) &&
        Number.isSafeInteger(window.validFrames) && window.validFrames > 0 &&
        window.endFrame - window.startFrame === window.validFrames &&
        window.startFrame >= startFrame && window.endFrame <= endFrame;
      if (!valid || !qualifies) { reset(); return 0; }
      if (window.startFrame <= lastStart) return seconds();
      if (lastEnd !== undefined && window.startFrame > lastEnd) reset();
      beginning ??= window.startFrame;
      lastStart = window.startFrame; lastEnd = Math.max(lastEnd ?? 0, window.endFrame);
      return seconds();
    },
  };
}
