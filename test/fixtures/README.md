# Analysis fixtures

Tests generate their own deterministic PCM: fundamentals plus a second harmonic, silence, and decaying alternating-sign impacts. Positions and sample rates are declared directly in the contract tests. Browser microphone checks use a locally generated 220 Hz WAV followed by silence; it is a transport fixture, not a person singing.

No real voice/clap fixture is currently included. Such fixtures must document source, consent/licence, recording route, sample rate and expected measurements before they can support source-accuracy claims. See `../../VALIDATION.md` for the remaining acceptance gate.
