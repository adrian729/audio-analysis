import { receiveCapture } from '@polyhymnia/audio-transport';
import { createPitchAnalyzer } from '@polyhymnia/audio-analysis';
import { createPitchyDetector } from '../detector.js';
let analyzer: ReturnType<typeof createPitchAnalyzer> | undefined;
let generation = '', epochId = '', cutoff = Infinity, closeCapture: (() => void) | undefined;
self.onmessage = ({ data }) => {
  try {
    let observations: ReturnType<ReturnType<typeof createPitchAnalyzer>['push']> = [];
    if (data.type === 'init') {
      generation = data.generation; epochId = data.epochId; cutoff = Infinity; analyzer = createPitchAnalyzer(createPitchyDetector(data.options?.windowSize), data.sampleRate, data.options);
      closeCapture?.();
      // Chunks straight from the capture worklet; results still go to the main thread.
      closeCapture = data.port && receiveCapture(data.port, chunk => {
        const found = analyzer!.push(chunk.samples, chunk.startFrame).filter(window => window.endFrame <= cutoff);
        if (found.length) self.postMessage({ type: 'observations', generation, epochId, observations: found });
      }, reason => self.postMessage({ type: 'fault', generation, epochId, reason }));
    }
    if (data.generation !== generation || data.epochId !== epochId || !analyzer) return;
    if (data.type === 'cutoff') cutoff = data.eligibilityEndFrame;
    if (data.type === 'push') observations = analyzer.push(data.samples, data.startFrame).filter(window => window.endFrame <= cutoff);
    if (data.type === 'finish') observations = analyzer.finish().filter(window => window.endFrame <= data.eligibilityEndFrame);
    self.postMessage({ type: 'ack', id: data.id, generation, epochId, observations });
  } catch (error) { self.postMessage({ type: 'fault', generation: data.generation, epochId: data.epochId, reason: error instanceof Error ? error.message : 'Pitch analysis failed.' }); }
};
