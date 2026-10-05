import { createOnsetWorker } from '@polyhymnia/audio-analysis/browser';
import { frameToPerformanceTime, type CaptureClock, type MicrophoneSession } from '@polyhymnia/audio-input/browser';
/** Consumer composition: structurally implements rhythm/browser's ExternalInputSource. */
export function createClapSource(options: {
  session: MicrophoneSession; clock: CaptureClock; workerUrl?: string | URL;
  offsetMs: number; maximumDeliveryAgeMs?: number;
}) {
  const { session, clock } = options;
  return {
    id: 'microphone', offsetMs: options.offsetMs, maximumDeliveryAgeMs: options.maximumDeliveryAgeMs ?? 1000, drainTimeoutMs: 1500,
    async prepare(signal: AbortSignal) {
      if (signal.aborted || !session.ready) throw new Error('Activate the microphone before starting an attempt.');
    },
    start(start: {
      generation: number; eligibilityStartPerformanceMs: number; eligibilityEndPerformanceMs: number;
      emit(event: { generation: number; eventId: string; performanceTimeMs: number }): void;
      interrupt(reason: string): void;
    }) {
      const epochId = `rhythm-${start.generation}`, eligibilityEnd = Math.ceil((start.eligibilityEndPerformanceMs - clock.performanceOriginMs) * clock.sampleRate / 1000);
      const processingEnd = eligibilityEnd + Math.ceil(clock.sampleRate * .020);
      let closed = false, drained = false;
      const worker = createOnsetWorker({ epochId, generation: String(start.generation), sampleRate: clock.sampleRate, workerUrl: options.workerUrl,
        onFault(reason) { if (!closed) start.interrupt(reason); },
        onObservations(batch) {
          if (closed) return;
          for (const observation of batch.observations) {
            const timestamp = frameToPerformanceTime(clock, observation.frame);
            if (timestamp >= start.eligibilityStartPerformanceMs && timestamp < start.eligibilityEndPerformanceMs) {
              start.emit({ generation: start.generation, eventId: `${epochId}:${observation.frame}`, performanceTimeMs: timestamp });
            }
          }
        } });
      session.start({ epochId, clock, maximumClockDeviationMs: Math.max(25, clock.uncertaintyMs + 10),
        onChunk: chunk => worker.push(chunk.samples, chunk.startFrame) });
      return {
        async drain() {
          await worker.setCutoff(eligibilityEnd);
          await session.finish(eligibilityEnd, processingEnd);
          await worker.finish(eligibilityEnd); drained = true;
        },
        cancel() { closed = true; worker.dispose(); if (!drained) session.cancel(); },
      };
    },
  };
}
