import { createMicrophoneSession, clockDeviationMs } from '@polyhymnia/audio-input/browser';
import { createOnsetWorker } from '@polyhymnia/audio-analysis/browser';
/** Software graph test. It cannot measure physical microphone acquisition or acoustic delay. */
export async function runProcessingProbe() {
  const context = new AudioContext(), destination = context.createMediaStreamDestination();
  await context.resume(); const observations: { frame: number }[] = [], deviations: number[] = [];
  const session = createMicrophoneSession({ context, stream: destination.stream,
    workletUrl: new URL('./assets/capture-worklet.js', import.meta.url) });
  let worker: ReturnType<typeof createOnsetWorker> | undefined;
  try {
    await session.prepare(); const clock = await session.clock();
    worker = createOnsetWorker({ epochId: 'probe', generation: 'probe', sampleRate: context.sampleRate,
      workerUrl: new URL('./assets/onset-worker.js', import.meta.url), onObservations: batch => observations.push(...batch.observations) });
    await worker.ready;
    session.start({ epochId: 'probe', async onChunk(chunk) {
      deviations.push(clockDeviationMs(clock, context)); await worker!.push(chunk.samples, chunk.startFrame);
    } });
    const start = context.currentTime + .2, frames = [.1, .3, .5].map(seconds => Math.round(seconds * context.sampleRate));
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .7), context.sampleRate), samples = buffer.getChannelData(0);
    for (const origin of frames) for (let i = 0; i < context.sampleRate * .015; i++) samples[origin + i] = .5 * Math.exp(-i / (context.sampleRate * .002)) * (i % 2 ? 1 : -1);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start(start);
    const eligibleEnd = Math.ceil((start + .7) * context.sampleRate), processingEnd = eligibleEnd + Math.ceil(context.sampleRate * .03);
    await worker.setCutoff(eligibleEnd); await session.finish(eligibleEnd, processingEnd); await worker.finish(eligibleEnd);
    session.dispose(); const borrowedTrackStillLive = destination.stream.getAudioTracks().every(track => track.readyState === 'live');
    source.disconnect();
    return { clock, observations, softwareGraphBiasMs: observations.map((event, i) => (event.frame - (Math.round(start * context.sampleRate) + frames[i]!)) / context.sampleRate * 1000),
      clockDeviationRangeMs: [Math.min(...deviations), Math.max(...deviations)], borrowedTrackStillLive, physicalInputDelayMs: null };
  } finally { session.dispose(); worker?.dispose(); destination.stream.getTracks().forEach(track => track.stop()); destination.disconnect(); await context.close(); }
}
