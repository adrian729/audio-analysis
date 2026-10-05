import { expect, test } from 'vitest';
import { createFramer, createOnsetAnalyzer, createPitchAnalyzer, createSampleHold } from '../packages/audio-analysis/src/index.js';
import { createPCMCollector } from '../packages/audio-input/src/index.js';
import { createPitchyDetector } from '../packages/audio-analysis-pitchy/src/index.js';
const tone = (hz: number, count = 48000, harmonic = false) => Float32Array.from({ length: count }, (_, i) =>
  .2 * Math.sin(2 * Math.PI * hz * i / 48000) + (harmonic ? .12 * Math.sin(4 * Math.PI * hz * i / 48000) : 0));
test('framing preserves chunk positions, resets gaps and labels final padding', () => {
  const joined = createFramer(8, 4), chunked = createFramer(8, 4);
  const samples = Float32Array.from({ length: 19 }, (_, i) => i);
  const expected = [...joined.push(samples, 20), ...joined.flush()];
  const actual = [...chunked.push(samples.slice(0, 3), 20), ...chunked.push(samples.slice(3, 12), 23),
    ...chunked.push(samples.slice(12), 32), ...chunked.flush()];
  expect(actual).toEqual(expected);
  expect(actual.at(-1)).toMatchObject({ endFrame: 39, padded: true });
  chunked.push(new Float32Array(3), 100);
  expect(chunked.push(new Float32Array(8), 120)[0]?.startFrame).toBe(120);
});
test('Pitchy detects low fundamentals, harmonics and bounded continuous tracks without stale silence', () => {
  const detector = createPitchyDetector();
  for (const hz of [82.4, 220, 442]) {
    const analyzer = createPitchAnalyzer(detector, 48000);
    const samples = tone(hz, 48000, true);
    const observations = analyzer.push(samples, 0);
    const last = observations.at(-1)!;
    expect(last.status).toBe('pitched'); expect(last.stable).toBe(true);
    expect(Math.abs(1200 * Math.log2(last.frequencyHz! / hz))).toBeLessThan(8);
    for (let i = 1; i <= 12; i++) analyzer.push(samples, i * samples.length);
    expect(analyzer.retainedFrames).toBeLessThan(detector.windowSize);
    expect(analyzer.push(new Float32Array(8192), 13 * samples.length).at(-1)).toMatchObject({ status: 'silent', stable: false });
    expect(analyzer.push(samples.slice(0, 4096), 9999999)[0]?.stable).toBe(false);
    expect(analyzer.finish().every(window => window.status !== 'pitched')).toBe(true);
  }
});
test('hold counts unique eligible coverage and rejects reference, stale generation, gaps and padding', () => {
  const hold = createSampleHold({ sampleRate: 1000, startFrame: 100, endFrame: 1000, generation: 'answer' });
  const window = (startFrame: number, endFrame: number, padded = false) => ({ startFrame, endFrame, validFrames: endFrame - startFrame, padded });
  expect(hold.observe(window(50, 150), true, 'answer')).toBe(0);
  expect(hold.observe(window(100, 300), true, 'answer')).toBe(.2);
  expect(hold.observe(window(200, 400), true, 'answer')).toBe(.3);
  expect(hold.observe(window(300, 500), false, 'previous')).toBe(.3);
  expect(hold.observe(window(200, 400), true, 'answer')).toBe(.3);
  expect(hold.observe(window(600, 800), true, 'answer')).toBe(.2);
  expect(hold.observe(window(700, 850, true), true, 'answer')).toBe(0);
});
test('causal onsets retain attacks through tail confirmation, exclude tail attacks and preserve subdivisions', () => {
  const samples = new Float32Array(48000);
  for (const frame of [4800, 10800, 23900, 25000]) for (let i = 0; i < 800; i++) samples[frame + i] = .5 * Math.exp(-i / 90) * (i % 2 ? 1 : -1);
  const full = createOnsetAnalyzer(48000), chunked = createOnsetAnalyzer(48000);
  const expected = [...full.push(samples, 0, 24000), ...full.finish(24000)];
  const actual = [];
  for (let frame = 0; frame < samples.length; frame += 337) actual.push(...chunked.push(samples.slice(frame, frame + 337), frame, 24000));
  actual.push(...chunked.finish(24000));
  expect(actual).toEqual(expected); expect(actual).toHaveLength(3);
  expect(actual[2]!.frame).toBeLessThan(24000); expect(actual[2]!.confirmedThroughFrame).toBeGreaterThan(24000);
});
test('bounded PCM collection owns copies and rejects gaps or oversized recordings', () => {
  const collector = createPCMCollector(4), samples = new Float32Array([1, 2]);
  collector.append({ epochId: 'e', sampleRate: 48000, startFrame: 50, sequence: 0, samples }); samples[0] = 0;
  expect(collector.finish().samples[0]).toBe(1);
  expect(() => collector.append({ epochId: 'e', sampleRate: 48000, startFrame: 53, sequence: 1, samples })).toThrow();
  collector.append({ epochId: 'e', sampleRate: 48000, startFrame: 52, sequence: 1, samples });
  expect(() => collector.append({ epochId: 'e', sampleRate: 48000, startFrame: 54, sequence: 2, samples })).toThrow();
});
