import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
const rhythmTarball = process.argv[2];
const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'polyhymnia-audio-pack-'));
const packs = join(scratch, 'packs'); await mkdir(packs);
for (const name of ['audio-input', 'audio-analysis', 'audio-analysis-pitchy']) {
  execFileSync('pnpm', ['pack', '--out', join(packs, `${name}.tgz`)], { cwd: join(root, 'packages', name), stdio: 'pipe' });
}
await writeFile(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
await writeFile(join(scratch, 'pnpm-workspace.yaml'), `overrides:\n  '@polyhymnia/audio-analysis': 'file:./packs/audio-analysis.tgz'\n`);
execFileSync('pnpm', ['add', ...['audio-input','audio-analysis','audio-analysis-pitchy'].map(name => join(packs, `${name}.tgz`)), '--ignore-scripts'], { cwd: scratch, stdio: 'pipe' });
if (rhythmTarball) execFileSync('pnpm', ['add', resolve(rhythmTarball), '--ignore-scripts'], { cwd: scratch, stdio: 'pipe' });
await writeFile(join(scratch, 'consumer.ts'), `import { createPCMCollector } from '@polyhymnia/audio-input';
import { createFramer, createPitchAnalyzer } from '@polyhymnia/audio-analysis';
import { createPitchyDetector } from '@polyhymnia/audio-analysis-pitchy';
const collector = createPCMCollector(8000); const framer = createFramer(256); const detector = createPitchyDetector();
const analyzer = createPitchAnalyzer(detector, 48000);
collector.append({ epochId: 'node', startFrame: 0, sequence: 0, sampleRate: 48000, samples: new Float32Array(4096) });
if (analyzer.push(collector.finish().samples)[0]?.status !== 'silent') throw new Error('Unexpected silence result');
framer.push(new Float32Array(512));
`);
await writeFile(join(scratch, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', target: 'ES2022', lib: ['ES2022'], types: [], strict: true, skipLibCheck: false, outDir: 'node' }, include: ['consumer.ts'] }));
execFileSync('pnpm', ['exec','tsc','-p',join(scratch, 'tsconfig.json')], { cwd: root, stdio: 'inherit' });
execFileSync('node', [join(scratch, 'node', 'consumer.js')], { cwd: scratch, stdio: 'inherit' });
await mkdir(join(scratch, 'public', 'assets'), { recursive: true });
await copyFile(join(root, 'examples/browser/main.ts'), join(scratch, 'main.ts'));
await copyFile(join(root, 'examples/browser/diagnostics.ts'), join(scratch, 'diagnostics.ts'));
await copyFile(join(root, 'examples/browser/clap-source.ts'), join(scratch, 'clap-source.ts'));
await copyFile(join(root, 'examples/browser/index.html'), join(scratch, 'public/index.html'));
if (rhythmTarball) await copyFile(join(root, 'examples/browser/rhythm-probe.ts'), join(scratch, 'rhythm-probe.ts'));
await writeFile(join(scratch, 'tsconfig.browser.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', target: 'ES2022', lib: ['ES2022','DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true }, include: ['main.ts', 'diagnostics.ts', 'clap-source.ts', ...(rhythmTarball ? ['rhythm-probe.ts'] : [])] }));
execFileSync('pnpm', ['exec','tsc','-p',join(scratch, 'tsconfig.browser.json')], { cwd: root, stdio: 'inherit' });
await build({ entryPoints: [join(scratch, 'main.ts'), join(scratch, 'diagnostics.ts'), join(scratch, 'clap-source.ts'), ...(rhythmTarball ? [join(scratch, 'rhythm-probe.ts')] : [])], outdir: join(scratch, 'public'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
for (const [name, asset] of [['audio-input','capture-worklet'],['audio-analysis','onset-worker'],['audio-analysis-pitchy','pitch-worker']]) {
  const packageRoot = join(scratch, 'node_modules', '@polyhymnia', name);
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (Object.values(manifest.dependencies ?? {}).some(range => /^(workspace:|link:|file:)/.test(range))) throw new Error('Unresolved package dependency');
  await copyFile(resolve(packageRoot, manifest.exports[`./${asset}.js`]), join(scratch, 'public/assets', `${asset}.js`));
  if (!(await readdir(packageRoot)).includes('LICENSE')) throw new Error('Missing package license');
  if (name === 'audio-analysis-pitchy' && !(await readFile(join(packageRoot, 'THIRD_PARTY_NOTICES'), 'utf8')).includes('Ian Johnson')) throw new Error('Missing Pitchy notice');
}
await copyFile(join(root, 'packages/audio-analysis-pitchy/THIRD_PARTY_NOTICES'), join(scratch, 'public/assets/THIRD_PARTY_NOTICES'));
console.log(`Packed DOM-free Node and bundled browser consumers passed. Browser artifacts: ${scratch}/public`);
