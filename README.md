# Audio input and analysis

Reusable, browser-based monophonic analysis. No backend or uploads. Three packages keep microphone capture independent of DSP and isolate the only analysis dependency, Pitchy.

| Package | Root | Browser entry | Runtime dependencies |
|---|---|---|---|
| `@polyhymnia/audio-input` | PCM validation and bounded collection | Explicit microphone session, processing-clock probe, complete-file decoding | None |
| `@polyhymnia/audio-analysis` | Framing, levels, causal impact onsets, streaming pitch quality, continuous sample holds | Acknowledged worker transport and onset worker | None |
| `@polyhymnia/audio-analysis-pitchy` | Fixed-window Pitchy detector | Pitch worker | Analysis core, exact `pitchy@4.1.0` (which brings `fft.js`) |

Roots work in Node with an ES2022-only TypeScript library. No React, notation, musical target interpretation, scoring, or Web Audio types enter their declarations. Pitch observations report Hz; applications can use `@polyhymnia/music-theory` for frequency/MIDI/cents. Rhythm assessment belongs to `@polyhymnia/rhythm`.

## Development

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm smoke
pnpm dev
```

Open `http://127.0.0.1:4175/laboratory/`. The standalone example activates the microphone explicitly, displays live pitch/impact counts, demonstrates reference matching, and analyzes a completed capture or selected file. It imports public package exports and uses no React or app source. Example capture is limited to ten seconds; file analysis to sixty seconds and 20 MB. `pnpm smoke` packs and installs all three packages in a scratch project, checks DOM-free Node imports/declarations, and prepares a bundled browser consumer and asset directory. No publishing occurs. To additionally check the existing rhythm controller, pass its packed tarball to `pnpm run smoke /absolute/path/rhythm.tgz`; this installs it only in the scratch consumer.

## Analyze existing PCM

```ts
import { createPitchAnalyzer, createOnsetAnalyzer } from '@polyhymnia/audio-analysis';
import { createPitchyDetector } from '@polyhymnia/audio-analysis-pitchy';

const pitch = createPitchAnalyzer(createPitchyDetector(4096), sampleRate);
const onsets = createOnsetAnalyzer(sampleRate);
// Call in bounded chunks. Frame positions identify real samples, not delivery time.
for (const chunk of recordingChunks) {
  consumePitch(pitch.push(chunk.samples, chunk.startFrame));
  consumeOnsets(onsets.push(chunk.samples, chunk.startFrame, eligibilityEndFrame));
}
consumePitch(pitch.finish());
consumeOnsets(onsets.finish(eligibilityEndFrame));
```

Pitch defaults: 4096-frame adapter window, quarter-window hop, RMS ≥ 0.008, clarity ≥ 0.9, 65–1500 Hz; stability requires three consecutive windows within 60 cents. These are adjustable starting parameters, not validated voice-wide thresholds. Pitchy instances reuse detector storage. Tracking retains one rolling window and bounded stability state, never a full pitch history. A gap resets framing/stability; changing sample rate requires a new analyzer. Final padding is marked and always produces uncertain/silent pitch, never reliable hold credit.

Onset defaults: four-ms energy bins, minimum RMS 0.025, adaptive noise-rise ratio 3, minimum spacing 65 ms, confirmation 16 ms. `tailFrames` supplies the additional processing support. Results distinguish the attack `frame` from `confirmedThroughFrame`; attack placement is quantized to the energy bin. This detects impacts, including non-clap sounds. It is not a semantic clap classifier, source separator, or arbitrary-music beat tracker. Known-tempo exercise scoring needs onset timestamps, not tempo estimation.

`createSampleHold({ sampleRate, startFrame, endFrame?, generation })` accepts observations and a host-supplied qualification decision. It rejects reference-straddling/padded/out-of-bounds windows, ignores old generations and duplicate windows, resets on gaps/unqualified input, and credits unique continuous coverage. For a pitch exercise, require reliable stable pitch in the correct octave and target tolerance. Set a new answer generation and sample boundary after reference playback and an acoustic-settling interval; do not measure holds with UI timers or add overlapping window lengths.

## Microphone lifecycle and assets

```ts
import { createMicrophoneSession } from '@polyhymnia/audio-input/browser';
import { createPitchWorker } from '@polyhymnia/audio-analysis-pitchy/browser';

// In the host's explicit activation handler, with a host-owned context:
const microphone = createMicrophoneSession({ context, workletUrl, onFault: interrupt });
await microphone.prepare(); // The only permission request.
const clock = await microphone.clock();
// Chunks go straight from the capture worklet to the worker, which acknowledges them itself.
const channel = new MessageChannel();
const analysis = createPitchWorker({ epochId, generation, sampleRate: context.sampleRate,
  workerUrl: pitchWorkerUrl, chunkPort: channel.port2, onObservations: consume, onFault: interrupt });
await analysis.ready;
microphone.start({ epochId, chunkPort: channel.port1 });
// Later: supply real-sample eligibility and a separate confirmation-tail boundary.
await analysis.setCutoff(eligibleEndFrame);
await microphone.finish(eligibleEndFrame, processingEndFrame);
await analysis.finish(eligibleEndFrame);
analysis.dispose();
microphone.dispose();
```

Copy/export-resolve these browser-loadable assets and pass their deployed URLs:

- `@polyhymnia/audio-input/capture-worklet.js`
- `@polyhymnia/audio-analysis/onset-worker.js`
- `@polyhymnia/audio-analysis-pitchy/pitch-worker.js`

Defaults resolve relative to installed library modules. Bundled consumers should explicitly inject deployed URLs or an existing `Worker`; no particular bundler, root path, CDN, Blob URL, or special hosting headers are required. A supplied worker is owned/terminated by default; use `ownsWorker: false` for a borrowed worker. The bundled pitch-worker asset carries the full Pitchy/fft.js notices. When bundling other adapter exports, preserve `THIRD_PARTY_NOTICES` alongside the application distribution.

Capture averages input channels to mono, requests disabled echo cancellation/noise suppression/automatic gain (browsers may choose other settings), exposes obtained track settings, and uses the **graph** sample rate. The worklet emits silence on its output. It handles actual input block lengths and batches 2048 frames, up to eight unacknowledged batches. With a `chunkPort` the analysis worker receives and acknowledges batches directly, so a busy main thread never stalls capture; the main thread still checks the capture clock from per-batch notices. Hosts that need the samples themselves pass `onChunk` instead (and `push` them to a worker); capture then waits for each asynchronous `onChunk` to finish. Worker clients copy input buffers before transfer; recordings retained by the host are not detached. Worker queues default to eight batches with 1500-ms acknowledgements; settings are bounded and injectable. Discontinuity, missing input, queue overflow, track mute/end, suspension and missing drain are faults; silence is ordinary analyzed data.

Contexts are always borrowed. An acquired microphone stream is owned; an injected stream is borrowed. Cancel/dispose disconnect nodes and stop only owned tracks. Cancelled permission requests stop late owned streams and cannot revive capture. `finish` stops capture after its processing boundary and acknowledges all chunk callbacks; successful finish keeps a prepared microphone reusable until disposal. Cancellation releases preparation, so reactivate before restarting. Worker callbacks carry epoch/generation identity; consumers must ignore obsolete results. Capture can validate a supplied frozen clock and maximum deviation per chunk.

### Direct capture channel

`chunkPort` connects this repository's capture to its analysis workers and nothing else: `createMicrophoneSession(...).start({ epochId, chunkPort })` on one end of a `MessageChannel`, and `createOnsetWorker`, `createPitchWorker` or `createAnalysisWorker` with `chunkPort` on the other. Its messages are an internal protocol, not a public stream format: any other source or analyzer uses `onChunk` and `push`, which remain the general interface, and each package is fully usable alone that way.

- Use one new channel per capture start; a channel carries one capture epoch.
- Install audio-input and the analysis package from the same release. Both ends check a protocol version, so a mismatch faults with `Capture protocol mismatch` rather than misreading audio.
- Results still arrive through `onObservations`, and `finish`/`setCutoff` still go through the worker client.
- Drain capture (`finish`) before disposing the worker: the worker acknowledges the batches still in flight, and a disposed worker leaves the drain to time out.

`decodeRecording(context, encoded, epochId?)` decodes a complete file without microphone permission/playback, averages channels, and copies encoded input. The caller owns file-size/duration limits and the decoding context. `createPCMCollector(maximumFrames)` is an optional bounded, copy-owning recorder with strict epoch/sample-rate/sequence/frame continuity; neither live client retains recordings implicitly.

## Timing and rhythm composition

`estimateCaptureClock` excludes device startup, then repeatedly brackets graph `currentTime` with monotonic `performance.now()`. Its origin maps **processing frames**, with observed spread reported as `uncertaintyMs`; `physicalInputDelayMs` is explicitly `null`. The spread is an observation, not a statistical guarantee. Neither worker arrival nor an output-presentation timestamp is the physical microphone timestamp. `clockDeviationMs` helps detect a changed mapping. `frameToPerformanceTime` does not compensate for unknown input delay.

[`examples/browser/clap-source.ts`](examples/browser/clap-source.ts) shows consumer composition structurally compatible with `rhythm/browser`'s external-source contract. Prepare permission before the timed controller, freeze offsets/mapping, preserve source identity, stop eligible input at its boundary, allow confirmation tail, and wait for delivery before grading. This composition intentionally remains an example rather than introducing a capture→rhythm dependency. Native keyboard/pointer grace, clock freshness and detector delivery allowance are separate policies. Do not align observations to targets to improve scores.

## Validation and remaining acceptance work

See [VALIDATION.md](VALIDATION.md) for the checked environment and evidence. Pure contracts, packed consumers, fake-microphone browser flow, software loopback and sample-based matching pass. Physical microphone bias/jitter, real claps/voices, speaker leakage, mobile and Bluetooth routes have **not** been validated. Scored clap input in the main app remains behind the plan's real-device acceptance gate. Prefer headphones for upcoming checks; unknown stable input bias needs a measured microphone-specific adjustment, while jitter/dropped samples cannot be fixed with an offset.

This repository supplies the tooling and independent demos. The app's optional clap control and live-pitch lesson remain follow-ups after source/hardware acceptance. Polyphony, melody segmentation/alignment, encoded capture/export, semantic sound recognition and automatic beat tracking are outside this delivery.

## Licensing

Packages are MIT. The selected published `pitchy@4.1.0` is MIT, despite the upstream main branch currently carrying a different licence. Its bundled transitive `fft.js@4.0.4` is MIT. Full third-party notices ship in the adapter package and pitch-worker asset. No Essentia dependency is installed.
