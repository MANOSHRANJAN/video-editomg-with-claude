// Build edit-plan-clean994.json for the Klickpin clean-994 reel.
// - A-roll: public/aroll/clean-994.mp4 (26.3s, brand-marketing VO transcribed by Whisper)
// - B-roll: sibling jsram/clean-* clips placed on noun-phrase beats (transcript-driven)
// - Captions: word-level beats from Whisper, max 3 words per phrase
// - Per-caption fill color sampled from the actual frame so text never blends in
import {writeFileSync, mkdirSync, readFileSync, existsSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const FPS = 30;
const W = 1080;
const H = 1920;
const VO = 'aroll/clean-994.mp4';
const VO_PATH = resolve(ROOT, 'public', VO);
const VO_DURATION = 26.304;
const TOTAL_DURATION = VO_DURATION;

// Whisper word-level transcription cached in .tmp/clean-994-words.json
const WORDS_JSON = resolve(ROOT, '.tmp/clean-994-words.json');
if (!existsSync(WORDS_JSON)) {
  throw new Error(`missing ${WORDS_JSON} — run the whisper transcription step first`);
}
const transcript = JSON.parse(readFileSync(WORDS_JSON, 'utf8'));
const words = transcript.words; // [text, start, end]

// Highlight words — punchy nouns/verbs that earn the script font.
const HIGHLIGHTS = new Set([
  'noisy', 'marketing', 'promises', 'growth', 'rethink', 'rebuild',
  'trends', 'momentum', 'brands', 'experiences', 'businesses',
  'category', 'leaders', 'shortcuts', 'compromises', 'results', 'speak',
]);

const norm = (w) => w.replace(/[^a-z0-9]/gi, '').toLowerCase();

// Group words into 1–3 word phrases, breaking on natural pauses.
function groupPhrases(ws) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) { out.push(cur); cur = []; } };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    cur.push(w);
    const next = ws[i + 1];
    const gap = next ? next[1] - w[2] : 0;
    if (!next || cur.length >= 3 || gap > 0.25) flush();
  }
  flush();
  return out;
}

const phrases = groupPhrases(words);

// --- Color sampling -------------------------------------------------------
const TMP = resolve(ROOT, '.tmp/caption-bg-994');
mkdirSync(TMP, {recursive: true});

// Source is 720x1280; caption block sits in the upper third.
const CROP = '480:380:120:200'; // w:h:x:y on 720x1280

function sampleLuma(midSec, idx) {
  const out = resolve(TMP, `cap_${String(idx).padStart(3, '0')}.png`);
  if (!existsSync(out)) {
    execSync(
      `ffmpeg -nostdin -y -ss ${midSec.toFixed(3)} -i "${VO_PATH}" -frames:v 1 -vf "crop=${CROP},scale=64:48" "${out}"`,
      {stdio: 'ignore'},
    );
  }
  const stats = execSync(
    `ffmpeg -nostdin -hide_banner -i "${out}" -vf "signalstats,metadata=print" -f null - 2>&1`,
    {encoding: 'utf8'},
  );
  const yMatch = stats.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  const uMatch = stats.match(/lavfi\.signalstats\.UAVG=([\d.]+)/);
  const vMatch = stats.match(/lavfi\.signalstats\.VAVG=([\d.]+)/);
  const Y = yMatch ? parseFloat(yMatch[1]) : 128;
  const U = uMatch ? parseFloat(uMatch[1]) : 128;
  const V = vMatch ? parseFloat(vMatch[1]) : 128;
  return {Y, U, V};
}

// Pick a fill color that contrasts the cropped background.
// Light bg → bold dark/saturated colour. Dark bg → bright pop colour.
const PALETTE_LIGHT = ['#0F1B2D', '#1B3A57', '#7B2D26', '#3F2E56', '#1F4D2C']; // dark on light bg
const PALETTE_DARK  = ['#FFD23F', '#FF6B35', '#3DDC97', '#F25F5C', '#FFFFFF']; // bright on dark bg

function pickFill(idx, luma) {
  const palette = luma.Y > 150 ? PALETTE_LIGHT : PALETTE_DARK;
  return palette[idx % palette.length];
}
function pickStroke(luma) {
  // Always opposite-luma for max readability.
  return luma.Y > 150 ? '#FFFFFF' : '#0F1B2D';
}

// --- Build caption entries ------------------------------------------------
const captions = phrases.map((ph, i) => {
  const startSec = ph[0][1];
  const endSec = ph[ph.length - 1][2];
  const durationSec = Math.max(0.4, endSec - startSec + 0.18); // hold a beat past last word
  const midSec = (startSec + endSec) / 2;
  const luma = sampleLuma(midSec, i);
  const fill = pickFill(i, luma);
  const stroke = pickStroke(luma);
  const tokens = ph.map(([t]) => ({
    text: t.replace(/[,.!?]+$/, ''), // strip trailing punctuation
    highlight: HIGHLIGHTS.has(norm(t)),
  }));
  return {tokens, startSec, durationSec, position: 'top', fill, stroke};
});

// --- Build a-roll / b-roll layers -----------------------------------------
// Single a-roll spanning the whole reel (provides audio + base video).
const aroll = [{src: VO, startSec: 0, durationSec: TOTAL_DURATION, trimStartSec: 0, kind: 'aroll'}];

// Transcript-driven b-roll cutaways on key noun/verb beats.
// Each entry: anchor word (must appear in transcript), b-roll src, hold seconds.
// b-roll plays muted on top of the a-roll, so VO continues underneath.
const BROLL_CUES = [
  {anchor: 'trends',      src: 'broll/clean-1027.mp4', hold: 1.4, trimStart: 1.0},
  {anchor: 'momentum',    src: 'broll/clean-1086.mp4', hold: 1.6, trimStart: 4.0},
  {anchor: 'brands',      src: 'broll/clean-1081.mp4', hold: 1.4, trimStart: 0.5},
  {anchor: 'experiences', src: 'broll/clean-1147.mp4', hold: 2.0, trimStart: 2.0},
  {anchor: 'businesses',  src: 'broll/clean-1027.mp4', hold: 1.6, trimStart: 8.0},
  {anchor: 'leaders',     src: 'broll/clean-1086.mp4', hold: 1.6, trimStart: 18.0},
  {anchor: 'results',     src: 'broll/clean-1147.mp4', hold: 1.8, trimStart: 10.0},
];

function findWordStart(anchor) {
  const w = words.find((x) => norm(x[0]) === anchor);
  return w ? w[1] : null;
}

const broll = [];
const MIN_GAP = 0.3; // require some a-roll between cutaways
for (const cue of BROLL_CUES) {
  const start = findWordStart(cue.anchor);
  if (start == null) continue;
  const last = broll[broll.length - 1];
  if (last && start < last.startSec + last.durationSec + MIN_GAP) continue; // skip overlap
  const dur = Math.min(cue.hold, TOTAL_DURATION - start);
  if (dur < 0.4) continue;
  broll.push({src: cue.src, startSec: start, durationSec: dur, trimStartSec: cue.trimStart ?? 0, kind: 'broll'});
}

// --- Write plan -----------------------------------------------------------
const plan = {
  fps: FPS,
  width: W,
  height: H,
  totalDurationSec: TOTAL_DURATION,
  watermarkText: '@manosh',
  iterationId: 'clean994',
  iterationTitle: 'Clean Girl 994 — kinetic captions + cutaways',
  hookFormula: 'Hook (noisy marketing) → reset (rethink/rebuild) → promise (momentum, leaders) → CTA (results that speak)',
  appliedPlaybook: {
    shotLengthSec: 1.6,
    cutOnBeat: true,
    openerStyle: 'sustained',
    genre: 'lifestyle brand reel with kinetic captions and noun-anchored b-roll',
  },
  aroll,
  broll,
  captions,
  audio: [],
};

const OUT = resolve(ROOT, 'src/edit-plan-clean994.json');
writeFileSync(OUT, JSON.stringify(plan, null, 2));
console.log(`wrote ${OUT}`);
console.log(`  captions: ${captions.length}, broll cutaways: ${broll.length}, aroll: ${aroll.length}`);
console.log(`  duration: ${TOTAL_DURATION}s @ ${FPS}fps -> ${Math.round(TOTAL_DURATION * FPS)} frames`);
