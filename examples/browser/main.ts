import { createPCMCollector } from '@polyhymnia/audio-input';
import { createMicrophoneSession, decodeRecording, frameToPerformanceTime } from '@polyhymnia/audio-input/browser';
import { createOnsetAnalyzer, createPitchAnalyzer, createSampleHold } from '@polyhymnia/audio-analysis';
import { createOnsetWorker } from '@polyhymnia/audio-analysis/browser';
import { createPitchyDetector } from '@polyhymnia/audio-analysis-pitchy';
import { createPitchWorker } from '@polyhymnia/audio-analysis-pitchy/browser';
const element = (id: string) => document.getElementById(id)!;
const button = (id: string) => element(id) as HTMLButtonElement;
let context: AudioContext | undefined, session: ReturnType<typeof createMicrophoneSession> | undefined;
let pitchWorker: ReturnType<typeof createPitchWorker> | undefined, onsetWorker: ReturnType<typeof createOnsetWorker> | undefined;
let clock: Awaited<ReturnType<ReturnType<typeof createMicrophoneSession>['clock']>> | undefined;
let collector: ReturnType<typeof createPCMCollector> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
let freshness: ReturnType<typeof setTimeout> | undefined;
let generation = 0, impacts = 0, recording = false;
let restorePolicy: (() => void) | undefined;
let hold: ReturnType<typeof createSampleHold> | undefined, answerGeneration = '', oscillator: OscillatorNode | undefined;
const asset = (name: string) => new URL(`./assets/${name}.js`, import.meta.url);
const status = (message: string) => { element('status').textContent = message; };
function release() {
  const restore = restorePolicy; restorePolicy = undefined; restore?.();
  generation++; recording = false; clearTimeout(timer); clearTimeout(freshness); oscillator?.stop(); oscillator = undefined;
  session?.dispose(); pitchWorker?.dispose(); onsetWorker?.dispose(); session = undefined; hold = undefined;
  pitchWorker = undefined; onsetWorker = undefined; collector = undefined;
  button('activate').disabled = false; button('release').disabled = true; button('stop').disabled = true; button('reference').disabled = true;
  element('pitch').textContent = 'Pitch: —'; status('Microphone disabled.');
}
async function finish() {
  if (!recording || !context || !session || !pitchWorker || !onsetWorker) return;
  recording = false; hold = undefined; clearTimeout(timer); button('stop').disabled = true; button('reference').disabled = true;
  const token = generation, endFrame = Math.ceil(context.currentTime * context.sampleRate), processingEnd = endFrame + Math.ceil(context.sampleRate * .03);
  try {
    await Promise.all([pitchWorker.setCutoff(endFrame), onsetWorker.setCutoff(endFrame)]);
    await session.finish(endFrame, processingEnd);
    await Promise.all([pitchWorker.finish(endFrame), onsetWorker.finish(endFrame)]);
    if (token !== generation) return;
    const captured = collector!.finish();
    analyze(captured.samples, captured.sampleRate, captured.startFrame, endFrame);
    pitchWorker.dispose(); onsetWorker.dispose(); session.dispose(); session = undefined; restorePolicy?.(); restorePolicy = undefined;
    status('Capture finished and all analysis delivered. Activate explicitly for another capture.'); button('activate').disabled = false;
  } catch (error) { if (token === generation) { release(); status(String(error)); } }
}
function analyze(samples: Float32Array, sampleRate: number, startFrame = 0, eligibilityEnd = Infinity) {
  if (samples.length / sampleRate > 60) throw new Error('Example file limit is 60 seconds.');
  const pitch = createPitchAnalyzer(createPitchyDetector(), sampleRate), onset = createOnsetAnalyzer(sampleRate);
  let reliable = 0, latest: number | undefined, count = 0;
  // Chunk analysis prevents building a whole-recording array of observations.
  for (let i = 0; i < samples.length; i += 8192) {
    const chunk = samples.subarray(i, i + 8192);
    for (const observation of pitch.push(chunk, startFrame + i)) if (observation.status === 'pitched' && observation.endFrame <= eligibilityEnd) { reliable++; latest = observation.frequencyHz; }
    count += onset.push(chunk, startFrame + i, eligibilityEnd).length;
  }
  count += onset.finish(eligibilityEnd).length;
  element('offline').textContent = `${(samples.length / sampleRate).toFixed(2)} s at ${sampleRate} Hz; ${reliable} reliable pitch windows; last ${latest?.toFixed(1) ?? '—'} Hz; ${count} impacts.`;
}
button('activate').onclick = async () => {
  release(); const token = generation; button('activate').disabled = true; button('release').disabled = false; status('Preparing microphone…');
  try {
    context ??= new AudioContext(); await context.resume();
    // Host owns the session policy. This example has no playback package dependency.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    const previousPolicy = audioSession?.type; if (audioSession) { audioSession.type = 'play-and-record'; restorePolicy = () => { if (audioSession.type === 'play-and-record') audioSession.type = previousPolicy!; }; }
    const current = createMicrophoneSession({ context, workletUrl: asset('capture-worklet'), onFault(reason) {
      if (token === generation) { release(); status(reason); }
    } });
    session = current; await current.prepare();
    if (token !== generation) { current.dispose(); if (audioSession && audioSession.type === 'play-and-record') audioSession.type = previousPolicy!; return; }
    clock = await current.clock(); if (token !== generation) return;
    element('clock').textContent = JSON.stringify({ ...clock, settings: current.settings }, null, 2);
    const epochId = `capture-${token}`, analysisGeneration = epochId;
    impacts = 0; element('onsets').textContent = 'Impacts: 0'; collector = createPCMCollector(Math.ceil(context.sampleRate * 12));
    pitchWorker = createPitchWorker({ epochId, generation: analysisGeneration, sampleRate: context.sampleRate, workerUrl: asset('pitch-worker'), onObservations(batch) {
      if (token !== generation) return;
      for (const observation of batch.observations) {
        element('pitch').textContent = observation.status === 'pitched' ? `Pitch: ${observation.frequencyHz!.toFixed(1)} Hz; clarity ${observation.clarity.toFixed(3)}` : `Pitch: ${observation.status}`;
        if (hold) {
          const hz = observation.frequencyHz ?? 0;
          const qualified = observation.status === 'pitched' && observation.stable && hz >= 220 * 2 ** (-50 / 1200) && hz <= 220 * 2 ** (50 / 1200);
          const seconds = hold.observe(observation, qualified, answerGeneration);
          element('match').textContent = seconds >= .5 ? 'Matched the reference for 500 ms.' : `Answer: ${(seconds * 1000).toFixed(0)} / 500 ms of continuous sample coverage.`;
        }
      }
      clearTimeout(freshness); freshness = setTimeout(() => { element('pitch').textContent = 'Pitch: unavailable'; hold?.reset(); }, 350);
    } });
    onsetWorker = createOnsetWorker({ epochId, generation: analysisGeneration, sampleRate: context.sampleRate, workerUrl: asset('onset-worker'), onObservations(batch) {
      if (token !== generation) return;
      impacts += batch.observations.length;
      element('onsets').textContent = `Impacts: ${impacts}; last attack at ${frameToPerformanceTime(clock!, batch.observations.at(-1)!.frame).toFixed(1)} performance ms.`;
    } });
    await Promise.all([pitchWorker.ready, onsetWorker.ready]); if (token !== generation) return;
    current.start({ epochId, async onChunk(chunk) {
      if (token !== generation) return;
      collector!.append(chunk); await Promise.all([pitchWorker!.push(chunk.samples, chunk.startFrame), onsetWorker!.push(chunk.samples, chunk.startFrame)]);
    } });
    recording = true; button('stop').disabled = false; button('reference').disabled = false; status('Microphone active. Pitch and impacts are analyzed in workers.');
    timer = setTimeout(() => void finish(), 10000);
  } catch (error) { if (token === generation) { release(); status(String(error)); } }
};
button('stop').onclick = () => void finish(); button('release').onclick = release;
button('reference').onclick = () => {
  if (!recording || !context) return;
  hold = undefined; oscillator?.stop(); oscillator = context.createOscillator(); const gain = context.createGain();
  oscillator.frequency.value = 220; gain.gain.value = .08; oscillator.connect(gain); gain.connect(context.destination);
  const answerStart = context.currentTime + 1.3;
  oscillator.start(); oscillator.stop(context.currentTime + 1);
  answerGeneration = `answer-${generation}-${answerStart}`;
  hold = createSampleHold({ sampleRate: context.sampleRate, startFrame: Math.ceil(answerStart * context.sampleRate), generation: answerGeneration });
  element('match').textContent = 'Reference playing; answer begins after the settling interval.';
  const reference = oscillator;
  oscillator.onended = () => { gain.disconnect(); if (oscillator === reference) oscillator = undefined; };
};
(element('file') as HTMLInputElement).onchange = async event => {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Example file limit is 20 MB.');
    context ??= new AudioContext(); const decoded = await decodeRecording(context, await file.arrayBuffer()); analyze(decoded.samples, decoded.sampleRate);
  } catch (error) { element('offline').textContent = String(error); }
};
window.addEventListener('pagehide', release);
