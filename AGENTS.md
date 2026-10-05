# Audio input and analysis
- Three independently usable packages: audio-input, audio-analysis, and audio-analysis-pitchy. Root exports have no DOM, Node or browser globals. Browser APIs belong only to browser entries and explicit worker/worklet assets.
- Capture and pure analysis do not import one another. Exchange numeric samples, frame positions and structural metadata. Musical interpretation and rhythm assessment stay in their owning packages.
- Only the Pitchy adapter depends on Pitchy. Pin its release and include third-party notices in bundled distributions. Bundling tools are development dependencies.
- No import-time permissions, audio, workers, listeners or timers. Explicit start/cancel/dispose; never stop borrowed streams or close borrowed contexts.
- Bound capture transport, worker queues and rolling analysis state. Separate assessment eligibility from detector-tail processing; retain original sample positions and report gaps.
- Tests cover meaningful public contracts; run with the dot reporter. Check typecheck, test, build and packed consumers before completion. Add changesets for public changes.
- Cross-repository dependencies use npm versions only, never link/file/relative dependencies. Never publish or push without a session request.
