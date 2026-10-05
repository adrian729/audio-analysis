import type { OnsetObservation, OnsetOptions } from '../onsets.js';
import { createAnalysisWorker, type WorkerClientOptions } from './worker-client.js';
export interface OnsetWorkerOptions extends Omit<WorkerClientOptions<OnsetObservation>, 'worker' | 'analysisOptions'> {
  worker?: Worker; workerUrl?: string | URL; analysisOptions?: OnsetOptions;
}
export function createOnsetWorker(options: OnsetWorkerOptions) {
  return createAnalysisWorker<OnsetObservation>({ ...options,
    worker: options.worker ?? new Worker(options.workerUrl ?? new URL('../onset-worker.js', import.meta.url), { type: 'module' }) });
}
