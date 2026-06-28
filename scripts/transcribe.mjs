// transcribe.mjs — run Whisper on a clip and cache word-level timings.
//
//   node scripts/transcribe.mjs <input.mp4> [--model base|small|medium]
//
// Output: .tmp/<basename>-words.json — { text, words: [[token, start, end]] }
// Cached: skips work if the JSON already exists and is newer than the input.
import {existsSync, mkdirSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {basename, extname, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TMP = resolve(ROOT, '.tmp');

const args = process.argv.slice(2);
const input = args[0];
if (!input) {
  console.error('usage: node scripts/transcribe.mjs <input.mp4> [--model base|small|medium]');
  process.exit(2);
}
const modelFlag = args.indexOf('--model');
const model = modelFlag >= 0 ? args[modelFlag + 1] : 'base';

const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`no such file: ${inputPath}`);
  process.exit(1);
}

mkdirSync(TMP, {recursive: true});
const stem = basename(inputPath, extname(inputPath)).replace(/\W+/g, '-').replace(/^-|-$/g, '');
const outPath = resolve(TMP, `${stem}-words.json`);

// Skip if cached and fresh.
if (existsSync(outPath) && statSync(outPath).mtimeMs > statSync(inputPath).mtimeMs) {
  console.log(`cached: ${outPath}`);
  process.exit(0);
}

// Whisper lives in the project venv. Shell out so we don't have to load
// PyTorch into the Node process.
const venvPython = resolve(ROOT, '.venv/bin/python');
if (!existsSync(venvPython)) {
  console.error(`missing python venv at ${venvPython} — run: python3 -m venv .venv && .venv/bin/pip install openai-whisper`);
  process.exit(1);
}

const pyScript = `
import json, sys, whisper
m = whisper.load_model("${model}")
r = m.transcribe(${JSON.stringify(inputPath)}, word_timestamps=True, verbose=False)
words = []
for seg in r["segments"]:
    for w in seg.get("words", []):
        words.append([w["word"].strip(), round(float(w["start"]),3), round(float(w["end"]),3)])
json.dump({"text": r["text"], "words": words}, sys.stdout)
`.trim();

console.log(`transcribing ${inputPath} (model=${model})…`);
const res = spawnSync(venvPython, ['-c', pyScript], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
if (res.status !== 0) {
  console.error('whisper failed:');
  console.error(res.stderr);
  process.exit(res.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(res.stdout);
} catch (e) {
  console.error('whisper output was not JSON:');
  console.error(res.stdout.slice(0, 400));
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`wrote ${outPath} (${payload.words.length} words)`);
