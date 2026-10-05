import { createTimedAttempt } from '@polyhymnia/rhythm/browser';
import { createMicrophoneSession } from '@polyhymnia/audio-input/browser';
import { createClapSource } from './clap-source.js';
export async function runRhythmProbe() {
  const context = new AudioContext(), destination = context.createMediaStreamDestination(); await context.resume();
  const microphone = createMicrophoneSession({ context, stream: destination.stream, workletUrl: new URL('./assets/capture-worklet.js', import.meta.url) });
  await microphone.prepare(); const clock = await microphone.clock();
  const source = createClapSource({ session: microphone, clock, offsetMs: 0, workerUrl: new URL('./assets/onset-worker.js', import.meta.url) });
  let activeBuffer: AudioBufferSourceNode | undefined;
  function play(duration: number, lead: number, audible: boolean) {
    const start = context.currentTime + lead;
    if (audible) {
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate), samples = buffer.getChannelData(0);
      for (const at of [1, 1.2, 1.4]) for (let i = 0; i < context.sampleRate * .015; i++) samples[Math.round(at * context.sampleRate) + i] = .5 * Math.exp(-i / (context.sampleRate * .002)) * (i % 2 ? 1 : -1);
      activeBuffer = context.createBufferSource(); activeBuffer.buffer = buffer; activeBuffer.connect(destination); activeBuffer.start(start);
    }
    let timer: ReturnType<typeof setTimeout>;
    return { finished: new Promise<'ended'>(resolve => { timer = setTimeout(() => resolve('ended'), (duration + lead) * 1000); }),
      clock: () => ({ performanceTimeMs: performance.now(), playbackTimeSeconds: context.currentTime - start, sourceKey: 'graph', continuityKey: 'fixed' }),
      onInterrupted: () => () => {}, stop() { clearTimeout(timer); activeBuffer?.stop(); activeBuffer = undefined; } };
  }
  const controller = createTimedAttempt({ clockSourcesByPreference: ['graph'], async prepare() {}, validateStimulus: () => ({ lastAudioEndSeconds: 1.5 }),
    playSilence: options => play(options.durationSeconds, options.leadSeconds, false), play: (_, options) => play(options.durationSeconds, options.leadSeconds, true) }, undefined, {});
  try {
    const plan = { durationSeconds: 1.6, stimulus: null, phases: [{ kind: 'countIn' as const, startSeconds: 0, endSeconds: .5 }, { kind: 'respond' as const, startSeconds: .5, endSeconds: 1.6 }],
      responseWindow: { startSeconds: .5, endSeconds: 1.6 }, targets: [1,1.2,1.4].map((atSeconds, i) => ({ targetId: String(i), atSeconds, associationRadiusSeconds: .09 })) };
    const result = new Promise(resolve => { const off = controller.subscribe(() => { const snapshot = controller.getSnapshot(); if (snapshot.phase === 'completed' || snapshot.phase === 'interrupted') { off(); resolve(snapshot); } }); });
    await controller.start(plan, { offsetMs: 0, creditRadiusSeconds: .08, inputSources: [source] }); return await result;
  } finally { controller.dispose(); microphone.dispose(); destination.stream.getTracks().forEach(track => track.stop()); await context.close(); }
}
