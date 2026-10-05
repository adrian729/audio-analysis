import { createOnsetAnalyzer } from '../onsets.js';
let analyzer: ReturnType<typeof createOnsetAnalyzer> | undefined;
let generation = '', epochId = '', cutoff = Infinity;
self.onmessage = ({ data }) => {
  try {
    let observations: ReturnType<ReturnType<typeof createOnsetAnalyzer>['push']> = [];
    if (data.type === 'init') { generation = data.generation; epochId = data.epochId; cutoff = Infinity; analyzer = createOnsetAnalyzer(data.sampleRate, data.options); }
    if (data.generation !== generation || data.epochId !== epochId || !analyzer) return;
    if (data.type === 'cutoff') cutoff = data.eligibilityEndFrame;
    if (data.type === 'push') observations = analyzer.push(data.samples, data.startFrame, cutoff);
    if (data.type === 'finish') { cutoff = data.eligibilityEndFrame; observations = analyzer.finish(cutoff); }
    self.postMessage({ type: 'ack', id: data.id, generation, epochId, observations });
  } catch (error) { self.postMessage({ type: 'fault', generation: data.generation, epochId: data.epochId, reason: error instanceof Error ? error.message : 'Onset analysis failed.' }); }
};
