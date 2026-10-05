import type { PitchObservation, PitchOptions } from '@polyhymnia/audio-analysis';
import { createAnalysisWorker, type WorkerClientOptions } from '@polyhymnia/audio-analysis/browser';
export interface PitchWorkerOptions extends Omit<WorkerClientOptions<PitchObservation>, 'worker' | 'analysisOptions'> {
  worker?: Worker; workerUrl?: string | URL; analysisOptions?: PitchOptions & { windowSize?: number };
}
export function createPitchWorker(options: PitchWorkerOptions) {
  return createAnalysisWorker<PitchObservation>({ ...options,
    worker: options.worker ?? new Worker(options.workerUrl ?? new URL('../pitch-worker.js', import.meta.url), { type: 'module' }) });
}
