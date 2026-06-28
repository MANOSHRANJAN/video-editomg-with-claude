#!/usr/bin/env node
// pipeline.mjs — one-command CLI for the video-edit pipeline.
//
//   node scripts/pipeline.mjs <input.mp4> [--out path] [--force]
//
// Runs: transcribe → brain → hyperframes scene → render. Reuses cached
// artifacts unless --force.
import {existsSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {basename, extname, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: node scripts/pipeline.mjs <input.mp4> [--out <path>] [--force]');
  process.exit(2);
}
const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`no such file: ${inputPath}`);
  process.exit(1);
}
const force = args.includes('--force');
const outIdx = args.indexOf('--out');
const stem = basename(inputPath, extname(inputPath)).replace(/\W+/g, '-').replace(/^-|-$/g, '');
const wordsPath = resolve(ROOT, `.tmp/${stem}-words.json`);
const edlPath = resolve(ROOT, `.tmp/${stem}-edl.json`);
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : resolve(ROOT, `out/${stem}.mp4`);
mkdirSync(dirname(outPath), {recursive: true});

function step(label, cmd, extraArgs, cwd = ROOT) {
  console.log(`\n→ ${label}`);
  const res = spawnSync(cmd, extraArgs, {cwd, stdio: 'inherit', env: process.env});
  if (res.status !== 0) {
    console.error(`${label} failed (exit ${res.status}).`);
    process.exit(res.status ?? 1);
  }
}

step('transcribe', 'node', ['scripts/transcribe.mjs', inputPath]);
step('brain', 'node', ['scripts/brain.mjs', wordsPath, '--source', inputPath, ...(force ? ['--force'] : [])]);
step('scene', 'node', ['scripts/build-hyperframes.mjs', edlPath]);
step('render', 'npx', ['--yes', 'hyperframes@0.7.3', 'render', '--output', outPath, '-q', 'draft'], resolve(ROOT, 'hyperframes-scenes'));

console.log(`\n✓ done → ${outPath}`);
