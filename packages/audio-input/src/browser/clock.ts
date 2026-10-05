export interface CaptureClock {
  method: 'bracketed-context-time';
  performanceOriginMs: number;
  uncertaintyMs: number;
  sampleRate: number;
  physicalInputDelayMs: null;
  contextTimeSeconds: number;
}
/** Estimates graph processing time, NOT physical microphone acquisition latency. */
export async function estimateCaptureClock(context: AudioContext, observations = 16): Promise<CaptureClock> {
  if (context.state !== 'running') throw new Error('Audio context is not running.');
  if (!Number.isSafeInteger(observations) || observations < 4 || observations > 100) throw new RangeError('Invalid observation count.');
  // Exclude startup while the audio device is opening; 'running' can precede advancing graph time.
  const initial = context.currentTime, deadline = performance.now() + 1000;
  while (context.currentTime - initial < .05) {
    if (context.state !== 'running' || performance.now() > deadline) throw new Error('Processing clock did not start.');
    await new Promise(resolve => setTimeout(resolve, 8));
  }
  const origins: number[] = [], brackets: number[] = [];
  let previous = context.currentTime, advances = 0;
  for (let i = 0; i < observations; i++) {
    const before = performance.now(), current = context.currentTime, after = performance.now();
    if (context.state !== 'running') throw new Error('Audio context stopped during clock estimation.');
    origins.push((before + after) / 2 - current * 1000); brackets.push(after - before);
    if (current > previous) advances++;
    previous = current;
    await new Promise(resolve => setTimeout(resolve, 8));
  }
  if (advances < 2) throw new Error('Processing clock did not advance.');
  origins.sort((a, b) => a - b);
  return { method: 'bracketed-context-time', performanceOriginMs: origins[Math.floor(origins.length / 2)]!,
    uncertaintyMs: origins[origins.length - 1]! - origins[0]! + Math.max(...brackets),
    sampleRate: context.sampleRate, physicalInputDelayMs: null, contextTimeSeconds: context.currentTime };
}
export function frameToPerformanceTime(clock: CaptureClock, frame: number): number {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Invalid frame.');
  return clock.performanceOriginMs + frame / clock.sampleRate * 1000;
}
export function clockDeviationMs(clock: CaptureClock, context: AudioContext, performanceTimeMs = performance.now()): number {
  return performanceTimeMs - context.currentTime * 1000 - clock.performanceOriginMs;
}
