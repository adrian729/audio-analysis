# Audio input validation — 2026-10-05

Implementation checked through public contracts and packed consumers. This record distinguishes engineering checks from pending source/hardware acceptance. The ear-training app's runtime code has not been changed for audio input.

## Checked environment

- Linux workspace; Node 26.7, pnpm 12.3.2, TypeScript 7.0.2.
- Playwright CLI Chromium, headless, static host under `/laboratory/`.
- Browser workers and worklet loaded from installed **packed packages**, rather than source imports. A second packed consumer includes the current unpublished `@polyhymnia/rhythm` tarball.
- Chromium microphone flags feed an explicitly generated mono 220 Hz WAV, followed by silence. The browser's obtained input settings reported 44100 Hz and two channels; graph processing was 48000 Hz. This is simulated microphone input, not a recording of a person.
- Software loopback uses scheduled, generated decaying impacts routed through `MediaStreamAudioDestinationNode` into the borrowed-stream capture API. It excludes physical microphones, speakers and acoustic propagation.

## Evidence

| Check | Result |
|---|---|
| Frequency helpers and host audio-session policy | Public contracts and packed consumers pass |
| DOM-free Node roots and ES2022-only declarations from tarballs | Pass |
| Packed browser consumer and exported self-contained worker/worklet assets | Pass at nested URL; no special headers |
| PCM chunk continuity, copy ownership and frame bound | Pass |
| Chunked versus contiguous framing, gap reset, final padding | Pass |
| Pitchy fundamentals 82.4, 220 and 442 Hz with added second harmonics | Pass, synthetic errors below eight cents |
| Twelve seconds of repeated streaming per synthetic pitch; no retained history | Rolling state remains below one detector window |
| Silence and sample gaps remove reliable/stable pitch | Pass |
| Hold reference-straddling, overlap, duplicates, stale generation, gap and padding | Pass; no manufactured hold coverage |
| Causal impact detection and eligible attack confirmed in processing tail | Pass; tail-originating attacks excluded |
| Worker copying, acknowledgement, queue overrun | Pass; caller buffers survive transfer |
| Delayed owned permission cancellation | Pass; late tracks stopped, capture not revived |
| Borrowed stream/context disposal and callback acknowledgement | Pass; neither track stop nor context close |
| Rhythm eligible delayed events, duplicate/stale events, native input | Pass |
| Rhythm missing final drain | Interrupts; no partial grade |
| Explicit activation, finish, repeated activation, release and reload | Pass; granted permission does not cause automatic activation |
| Simulated permission denial | Error shown; activation remains retryable |
| Local complete-file decoding of the generated 12-second WAV | Pass; 48000 Hz, no microphone activation required |
| Live 220 Hz and completed PCM analysis | Pass; browser example reported 220.0 Hz |
| Reference matching using generated microphone input | Pass after reference/settling sample boundary and 500-ms unique coverage |

The initial processing-clock probe included device startup and showed approximately 74 ms of spread. The implementation now waits for advancing graph time before collecting bracketed observations. Subsequent probes showed approximately **9–10 ms** of observed origin spread. This is an environment-specific observation, not a guaranteed accuracy bound.

The software loopback produced three of three onsets with a **20 ms** processing-route delay relative to scheduled graph frames, both idle and with 60-ms main-thread blocks every 150 ms. Observed processing-clock deviation ranges were approximately −5 to −2 ms idle and −5 to +4 ms under that load. Borrowed tracks remained live after capture disposal. This route delay must not be reused as a microphone calibration.

A packed rhythm consumer composed the example clap source with the real timed controller and the scheduled software impacts. It completed with three on-time taps, no extras, `sourceId: 'microphone'`, and signed timing errors approximately **23.5, 25.9 and 24.5 ms**, using zero input adjustment and an 80-ms credit radius. This verifies composition, event placement and drain; it does not validate the same tolerance acoustically. No detections were aligned to targets or corrected from those results.

## Reproducing checks

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm smoke
```

`smoke` prints a scratch `public` path. Serve that directory with:

```sh
AUDIO_EXAMPLE_DIR=/absolute/scratch/public pnpm dev
```

In the browser, activate the microphone explicitly. The optional exported `diagnostics.js` function `runProcessingProbe()` exercises software graph timing after audio is unlocked. To include the independent rhythm-controller probe, first pack rhythm in its owning repository, then pass that tarball to `pnpm run smoke /absolute/path/rhythm.tgz`. The generated `rhythm-probe.js` exports `runRhythmProbe()`. These probe consumers use public npm exports; scratch installation paths are not committed package dependencies.

Automated browser evidence and the generated WAV are local scratch artifacts in the workspace's `tmp/audio-input-browser/`. Contract fixtures are generated by the tests; no third-party sound recordings are included. Package notices include the actual published MIT Pitchy/fft.js releases.

## Pending acceptance gate

Before adding scored microphone claps or the live-pitch lesson to the app:

1. Check actual quiet/loud claps, reverberation, close valid subdivisions, keyboard/pointer impacts and playback leakage. Retain consenting source fixtures with provenance; compare live and offline observations.
2. Check sustained real voices, lower fundamentals, breaths/noise, octave errors, and responsiveness versus accuracy. Synthetic fundamentals are insufficient evidence for general vocal reliability.
3. Measure signed bias, jitter and missed/extra impacts on the intended microphone/browser route against the app's actual rhythm tolerances. Use a controlled acoustic or hardware loopback reference where possible; record the measurement's meaning. A measured stable bias can become a microphone-specific fixed adjustment. Never derive that adjustment by fitting exercise answers.
4. Start with headphones. Validate speaker use separately. Mobile, Bluetooth, changed audio routes and audio-session behavior need their own checks; desktop fake input cannot establish their support.

The tooling and independent consumers are implemented, but this hardware/source gate is **pending**, not passed. Physical input delay remains unknown (`null`); no supported-device claim, real-voice accuracy claim, or scored clap control has been enabled in the app. App follow-ups remain as agreed: disabled-by-default microphone claps on existing rhythm exercises, followed by single-note live matching.
