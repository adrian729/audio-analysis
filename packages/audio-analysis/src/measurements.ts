export interface SignalLevel { rms: number; peak: number; clippedFraction: number }
export function measureSignal(samples: Float32Array): SignalLevel {
  if (!samples.length) return { rms: 0, peak: 0, clippedFraction: 0 };
  let energy = 0, peak = 0, clipped = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new RangeError('Non-finite sample.');
    energy += sample * sample;
    const magnitude = Math.abs(sample);
    peak = Math.max(peak, magnitude);
    if (magnitude >= .999) clipped++;
  }
  return { rms: Math.sqrt(energy / samples.length), peak, clippedFraction: clipped / samples.length };
}
