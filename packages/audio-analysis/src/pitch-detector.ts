export interface PitchReading { frequencyHz: number; clarity: number }
export interface PitchDetector {
  readonly windowSize: number;
  detect(samples: Float32Array, sampleRate: number): PitchReading;
}
export interface PitchOptions {
  hopSize?: number;
  minimumRms?: number;
  minimumClarity?: number;
  minimumHz?: number;
  maximumHz?: number;
  stabilityCents?: number;
}
