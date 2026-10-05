import { createServer } from 'node:http';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from 'esbuild';
const base = resolve(process.env.AUDIO_EXAMPLE_DIR ?? '.example'); await mkdir(`${base}/assets`, { recursive: true });
if (!process.env.AUDIO_EXAMPLE_DIR) await build({ entryPoints: ['examples/browser/main.ts', 'examples/browser/diagnostics.ts'], outdir: base, bundle: true, format: 'esm', platform: 'browser',
  alias: Object.fromEntries(['audio-input', 'audio-analysis', 'audio-analysis-pitchy'].flatMap(name => [
    [`@polyhymnia/${name}`, resolve(`packages/${name}/dist/index.js`)],
    [`@polyhymnia/${name}/browser`, resolve(`packages/${name}/dist/browser/index.js`)] ])) });
if (!process.env.AUDIO_EXAMPLE_DIR) await copyFile('examples/browser/index.html', `${base}/index.html`);
if (!process.env.AUDIO_EXAMPLE_DIR) for (const [name, asset] of [['audio-input','capture-worklet'],['audio-analysis','onset-worker'],['audio-analysis-pitchy','pitch-worker']]) await copyFile(`packages/${name}/dist/${asset}.js`, `${base}/assets/${asset}.js`);
createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/laboratory\//, '');
    const file = resolve(base, relative === '' ? 'index.html' : relative);
    if (!file.startsWith(`${base}/`) || !request.url.startsWith('/laboratory/')) { response.writeHead(404).end(); return; }
    const data = await readFile(file); response.writeHead(200, { 'Content-Type': extname(file) === '.js' ? 'text/javascript' : 'text/html' }); response.end(data);
  } catch { response.writeHead(404).end(); }
}).listen(4175, '127.0.0.1', () => console.log('Audio laboratory: http://127.0.0.1:4175/laboratory/'));
