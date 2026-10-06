import { receiveCapture } from '@polyhymnia/audio-transport';
import { createOnsetAnalyzer } from '../onsets.js';
let analyzer: ReturnType<typeof createOnsetAnalyzer> | undefined;
let generation = '', epochId = '', cutoff = Infinity, closeCapture: (() => void) | undefined;
self.onmessage = ({ data }) => {
  try {
    let observations: ReturnType<ReturnType<typeof createOnsetAnalyzer>['push']> = [];
    if (data.type === 'init') {
      generation = data.generation; epochId = data.epochId; cutoff = Infinity; analyzer = createOnsetAnalyzer(data.sampleRate, data.options);
      closeCapture?.();
      // Chunks straight from the capture worklet; results still go to the main thread.
      closeCapture = data.port && receiveCapture(data.port, chunk => {
        const found = analyzer!.push(chunk.samples, chunk.startFrame, cutoff);
        if (found.length) self.postMessage({ type: 'observations', generation, epochId, observations: found });
      }, reason => self.postMessage({ type: 'fault', generation, epochId, reason }));
    }
    if (data.generation !== generation || data.epochId !== epochId || !analyzer) return;
    if (data.type === 'cutoff') cutoff = data.eligibilityEndFrame;
    if (data.type === 'push') observations = analyzer.push(data.samples, data.startFrame, cutoff);
    if (data.type === 'finish') { cutoff = data.eligibilityEndFrame; observations = analyzer.finish(cutoff); }
    self.postMessage({ type: 'ack', id: data.id, generation, epochId, observations });
  } catch (error) { self.postMessage({ type: 'fault', generation: data.generation, epochId: data.epochId, reason: error instanceof Error ? error.message : 'Onset analysis failed.' }); }
};
