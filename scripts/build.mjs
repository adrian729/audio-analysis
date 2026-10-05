import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
for (const name of ['audio-input', 'audio-analysis', 'audio-analysis-pitchy']) {
  execFileSync('pnpm', ['--dir', `packages/${name}`, 'build'], { stdio: 'inherit' });
}
for (const [name, source, asset] of [ ['audio-input', 'worklet/capture', 'capture-worklet'],
  ['audio-analysis', 'worker/onsets', 'onset-worker'], ['audio-analysis-pitchy', 'worker/pitch', 'pitch-worker'] ]) {
  await build({ entryPoints: [`packages/${name}/src/${source}.ts`], outfile: `packages/${name}/dist/${asset}.js`,
    banner: name === 'audio-analysis-pitchy' ? { js: '/*\n' + await readFile('packages/audio-analysis-pitchy/THIRD_PARTY_NOTICES', 'utf8') + '\n*/' } : undefined,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof' });
}
