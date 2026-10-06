# @polyhymnia/audio-analysis-pitchy

## 0.3.1

### Patch Changes

- Publishes 0.3.0's changes. 0.3.0 itself never reached npm: an interrupted publish reserved the version number.

## 0.3.0

### Minor Changes

- Add a direct capture channel. Pass one end of a `MessageChannel` to the microphone session (`start({ epochId, chunkPort })`) and the other to an analysis worker (`chunkPort`): the capture worklet then sends batches straight to the worker, which acknowledges them itself, so a busy main thread no longer stalls capture or aborts an attempt. Results still arrive through `onObservations`, and the main thread still checks the capture clock. `onChunk` and `push` keep working for hosts that need the samples.

### Patch Changes

- Updated dependencies
  - @polyhymnia/audio-analysis@0.3.0

## 0.2.0

### Minor Changes

- Add bounded PCM capture, pure onset/pitch analysis, explicit browser assets and a pinned Pitchy adapter.

### Patch Changes

- Updated dependencies
  - @polyhymnia/audio-analysis@0.2.0
