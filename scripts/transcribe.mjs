// transcribe.mjs — word-level timings via ElevenLabs Scribe with a local
// Whisper fallback.
//
//   node scripts/transcribe.mjs <input.mp4> [--model scribe_v2|scribe_v1]
//                                           [--whisper] [--force]
//
// Output: .tmp/<basename>-words.json — { text, words: [[token, start, end]] }
// Cache: skips work if the JSON already exists and is newer than the input,
//        unless --force.
//
// Provider selection:
//   ELEVENLABS_API_KEY set  → Scribe (default, faster + better)
//   --whisper or no key     → local Whisper via .venv
import 'dotenv/config';
import {createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {basename, extname, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TMP = resolve(ROOT, '.tmp');

const args = process.argv.slice(2);
const input = args[0];
if (!input || input.startsWith('--')) {
  console.error('usage: node scripts/transcribe.mjs <input.mp4> [--model scribe_v2] [--whisper] [--force]');
  process.exit(2);
}
const force = args.includes('--force');
const forceWhisper = args.includes('--whisper');
const modelFlag = args.indexOf('--model');
const explicitModel = modelFlag >= 0 ? args[modelFlag + 1] : null;

const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`no such file: ${inputPath}`);
  process.exit(1);
}

mkdirSync(TMP, {recursive: true});
const stem = basename(inputPath, extname(inputPath)).replace(/\W+/g, '-').replace(/^-|-$/g, '');
const outPath = resolve(TMP, `${stem}-words.json`);

// Cache check.
if (!force && existsSync(outPath) && statSync(outPath).mtimeMs > statSync(inputPath).mtimeMs) {
  console.log(`cached: ${outPath}`);
  process.exit(0);
}

const elevenKey = process.env.ELEVENLABS_API_KEY;
const useScribe = !forceWhisper && elevenKey;

let payload;
try {
  if (useScribe) {
    payload = await transcribeScribe(inputPath, explicitModel || process.env.ELEVENLABS_MODEL || 'scribe_v2');
  } else {
    payload = transcribeWhisper(inputPath, explicitModel || 'base');
  }
} catch (e) {
  console.error(`transcription failed: ${e.message}`);
  if (useScribe && !forceWhisper) {
    console.error('falling back to local Whisper…');
    payload = transcribeWhisper(inputPath, 'base');
  } else {
    process.exit(1);
  }
}

writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(`wrote ${outPath} (${payload.words.length} words, via ${payload.provider})`);

// --- ElevenLabs Scribe ----------------------------------------------------
async function transcribeScribe(filePath, model) {
  console.log(`transcribing ${filePath} via ElevenLabs Scribe (${model})…`);
  // Node 20+ has native FormData + Blob. Read the file as a Buffer then wrap.
  const buf = readFileSync(filePath);
  const blob = new Blob([buf], {type: guessMime(filePath)});
  const form = new FormData();
  form.set('model_id', model);
  form.set('timestamps_granularity', 'word');
  form.set('file', blob, basename(filePath));

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {'xi-api-key': elevenKey},
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`scribe HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = await res.json();

  // Scribe returns { text, words: [{text, start, end, type, ...}] }.
  // We only want type:"word" entries (skip "spacing" and "audio_event").
  const words = (json.words ?? [])
    .filter((w) => w.type === 'word' || !w.type)
    .map((w) => [w.text.trim(), round3(w.start), round3(w.end)])
    .filter(([t]) => t.length > 0);

  if (!words.length) {
    throw new Error('scribe returned no word-level entries');
  }
  return {text: json.text ?? words.map(([t]) => t).join(' '), words, provider: `elevenlabs:${model}`};
}

function guessMime(p) {
  const ext = extname(p).toLowerCase();
  return {
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  }[ext] || 'application/octet-stream';
}
function round3(n) { return Math.round(Number(n) * 1000) / 1000; }

// --- Local Whisper fallback ----------------------------------------------
function transcribeWhisper(filePath, model) {
  const venvPython = resolve(ROOT, '.venv/bin/python');
  if (!existsSync(venvPython)) {
    throw new Error(`no whisper venv at ${venvPython} — pip install openai-whisper, or set ELEVENLABS_API_KEY in .env`);
  }
  console.log(`transcribing ${filePath} via local Whisper (${model})…`);
  const pyScript = `
import json, sys, whisper
m = whisper.load_model("${model}")
r = m.transcribe(${JSON.stringify(filePath)}, word_timestamps=True, verbose=False)
words = []
for seg in r["segments"]:
    for w in seg.get("words", []):
        words.append([w["word"].strip(), round(float(w["start"]),3), round(float(w["end"]),3)])
json.dump({"text": r["text"], "words": words}, sys.stdout)
`.trim();
  const res = spawnSync(venvPython, ['-c', pyScript], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  if (res.status !== 0) throw new Error(`whisper exit ${res.status}: ${res.stderr.slice(0, 400)}`);
  const parsed = JSON.parse(res.stdout);
  return {...parsed, provider: `whisper:${model}`};
}
