import type { PCMRecording } from '../pcm.js';
/** Complete-file decoding. The caller owns the context; no playback or permission request. */
export async function decodeRecording(context: BaseAudioContext, encoded: ArrayBuffer, epochId = 'decoded'): Promise<PCMRecording> {
  if (!epochId) throw new RangeError('Epoch ID is required.');
  const audio = await context.decodeAudioData(encoded.slice(0));
  const samples = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) samples[i]! += data[i]! / audio.numberOfChannels;
  }
  return { epochId, sampleRate: audio.sampleRate, startFrame: 0, samples };
}
