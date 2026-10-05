export interface AnalysisBatch<T> { generation: string; epochId: string; observations: T[]; }
export interface WorkerClientOptions<T> {
  generation: string; epochId: string; sampleRate: number; worker: Worker;
  /** An injected worker is owned unless explicitly borrowed. */
  ownsWorker?: boolean; maximumPending?: number; timeoutMs?: number;
  analysisOptions?: unknown; onObservations: (batch: AnalysisBatch<T>) => void; onFault?: (reason: string) => void;
}
/** Bounded acknowledged transport; copied buffers leave the caller's recording intact. */
export function createAnalysisWorker<T>(options: WorkerClientOptions<T>) {
  const { worker, generation, epochId, sampleRate } = options;
  const limit = options.maximumPending ?? 8, timeout = options.timeoutMs ?? 1500;
  if (!generation || !epochId || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 64 || !Number.isFinite(timeout) || timeout <= 0 || timeout > 10000) throw new RangeError('Invalid worker options.');
  let disposed = false, finishing = false, nextId = 0, nextFrame: number | undefined;
  const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (reason: string, report = true) => {
    if (disposed) return; disposed = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(reason)); }
    pending.clear(); remove(); if (options.ownsWorker !== false) worker.terminate(); if (report) options.onFault?.(reason);
  };
  const message = ({ data }: MessageEvent) => {
    if (disposed || data.generation !== generation || data.epochId !== epochId) return;
    if (data.type === 'fault') { fail(data.reason); return; }
    const item = pending.get(data.id);
    if (!item || data.type !== 'ack') return;
    try { if (data.observations?.length) options.onObservations({ generation, epochId, observations: data.observations }); }
    catch (error) { fail(error instanceof Error ? error.message : 'Observation callback failed.'); return; }
    clearTimeout(item.timer); pending.delete(data.id); item.resolve();
  };
  const error = () => fail('Analysis worker failed.');
  const remove = () => { worker.removeEventListener('message', message); worker.removeEventListener('error', error); worker.removeEventListener('messageerror', error); };
  worker.addEventListener('message', message); worker.addEventListener('error', error); worker.addEventListener('messageerror', error);
  const send = (data: object, transfer: Transferable[] = []) => {
    if (disposed) return Promise.reject(new Error('Analysis worker disposed.'));
    if (pending.size >= limit) { fail('Analysis worker queue overrun.'); return Promise.reject(new Error('Analysis worker queue overrun.')); }
    const id = nextId++;
    return new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject, timer: setTimeout(() => fail('Analysis worker acknowledgement timed out.'), timeout) });
      try { worker.postMessage({ ...data, id, generation, epochId, sampleRate }, transfer); }
      catch { fail('Analysis worker transport failed.'); }
    });
  };
  const ready = send({ type: 'init', options: options.analysisOptions });
  // Callers can await ready; a cancelled setup must not produce an unhandled rejection.
  void ready.catch(() => {});
  return {
    ready,
    get pendingBatches() { return pending.size; },
    async push(samples: Float32Array, startFrame: number) {
      await ready;
      if (finishing || disposed) throw new Error('Analysis is no longer accepting samples.');
      if (!Number.isSafeInteger(startFrame) || startFrame < 0 || (nextFrame !== undefined && startFrame !== nextFrame)) {
        fail('Sample discontinuity.'); throw new Error('Sample discontinuity.');
      }
      nextFrame = startFrame + samples.length;
      const copied = samples.slice(); await send({ type: 'push', startFrame, samples: copied }, [copied.buffer]);
    },
    async setCutoff(eligibilityEndFrame: number) {
      await ready;
      if (finishing || !Number.isSafeInteger(eligibilityEndFrame) || eligibilityEndFrame < 0) throw new RangeError('Invalid eligibility cutoff.');
      await send({ type: 'cutoff', eligibilityEndFrame });
    },
    async finish(eligibilityEndFrame = Infinity) {
      await ready;
      if (finishing || disposed || pending.size) throw new Error('Drain requires all pushed batches to be acknowledged.');
      if (eligibilityEndFrame !== Infinity && (!Number.isSafeInteger(eligibilityEndFrame) || eligibilityEndFrame < 0)) throw new RangeError('Invalid eligibility cutoff.');
      finishing = true; await send({ type: 'finish', eligibilityEndFrame });
    },
    dispose() { fail('Analysis cancelled.', false); },
  };
}
