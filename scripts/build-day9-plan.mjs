// Build edit-plan.json for the Day 9 talking-head reel.
// - A-roll only (no b-roll): public/aroll/manosh-day9.mp4
// - Captions: word-level beats from Whisper, max 3 words per phrase, stacked top→bottom
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
const VO = 'aroll/manosh-day9.mp4';
const VO_PATH = resolve(ROOT, 'public', VO);
const VO_DURATION = 38.02;
const TOTAL_DURATION = VO_DURATION;

// Whisper word-level data (sourceSeconds): [text, start, end]
const words = [
  ["So,",0,0.48],["hi,",0.48,0.66],["Ron,",0.66,0.9],["my",0.9,0.96],["name",0.96,1.08],["is",1.08,1.14],["Manosh,",1.14,1.62],
  ["and",1.62,1.8],["today",1.8,2.04],["it's",2.04,2.64],["day",2.64,2.76],["9,",2.76,3.18],["or",3.18,3.24],["many",3.24,3.36],
  ["months,",3.36,3.66],["and",3.66,3.96],["dollars,",3.96,4.14],["so",4.14,4.2],["within",4.2,4.32],["21",4.32,4.56],["days.",4.56,4.98],
  ["So",5.04,5.4],["some",5.4,6.06],["amazing",6.06,6.3],["things",6.3,6.6],["happen",6.6,6.9],["lately.",6.9,7.44],
  ["Uh,",7.5,7.8],["like",7.8,7.86],["I've",7.86,8.28],["got",8.28,8.4],["selected",8.4,8.76],["to",8.76,8.88],["AEW",8.88,9.24],
  ["scripts",9.24,9.78],["and",9.78,10.14],["it's",10.14,10.74],["a",10.74,10.86],["great",10.86,10.98],["experience.",10.98,11.58],
  ["And",11.64,12.3],["also,",12.3,12.78],["I",12.78,13.02],["have",13.02,13.2],["also",13.2,13.38],["completed",13.38,14.16],
  ["my",14.16,14.28],["billing",14.28,14.76],["agent",14.76,15.18],["and",15.18,15.48],["it's",15.48,15.72],["completely",15.72,15.9],
  ["functioning.",15.9,16.44],["It's",16.5,16.8],["completely,",16.8,17.22],["uh,",17.22,17.46],["it",17.46,17.52],["has",17.52,17.64],
  ["also,",17.64,18.12],["it",18.12,18.24],["also",18.24,18.42],["has",18.42,18.6],["rack.",18.6,19.26],
  ["So",19.32,19.38],["it",19.38,19.56],["also",19.56,19.68],["has",19.68,19.86],["a",19.86,20.04],["semantic",20.04,20.34],["search,",20.34,20.82],
  ["so",20.82,20.94],["it",20.94,21.18],["can",21.18,21.36],["take",21.36,21.54],["fast",21.54,21.72],["and",21.72,22.08],["answer",22.08,22.2],["for.",22.2,22.62],
  ["So",22.68,22.74],["that's",22.74,22.98],["it.",22.98,23.16],
  ["And",23.22,23.34],["also,",23.34,24],["it",24,24.18],["includes",24.18,24.6],["Wapi.",24.6,25.2],
  ["So",25.26,25.38],["you",25.38,25.8],["can",25.8,25.98],["just",25.98,26.1],["call",26.1,26.28],["it",26.28,26.4],["for",26.4,26.64],
  ["components,",26.64,27.3],["reschedule,",27.3,27.78],["cancel,",27.78,28.44],["anything.",28.44,28.86],
  ["You",28.92,28.98],["can",28.98,29.1],["also",29.1,29.58],["ask",29.58,29.76],["FEQs,",29.76,30.72],["like",30.72,30.84],
  ["questions",30.84,31.32],["about",31.32,31.62],["our",31.62,31.8],["business.",31.8,32.16],
  ["Whatever.",32.22,33.12],
  ["So",33.24,33.3],["if",33.3,33.48],["anyone",33.48,33.72],["wants",33.72,34.02],["this",34.02,34.26],["workload,",34.26,34.92],
  ["I'll",34.92,35.16],["give",35.16,35.28],["it",35.28,35.46],["to",35.46,35.64],["free,",35.64,35.94],["but",35.94,36.06],
  ["you",36.06,36.42],["need",36.42,36.66],["to",36.66,36.84],["follow",36.84,36.96],["me",36.96,37.2],["and",37.2,37.56],
];

const HIGHLIGHTS = new Set([
  'day','9','21','days','amazing','selected','aew','scripts','billing','agent',
  'completed','functioning','rack','semantic','search','fast','wapi',
  'reschedule','cancel','feqs','business','free','follow',
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
    // Hard cap at 3 words; also break on noticeable pauses.
    if (!next || cur.length >= 3 || gap > 0.18) flush();
  }
  flush();
  return out;
}

const phrases = groupPhrases(words);

// --- Color sampling -------------------------------------------------------
// For each caption, render one frame at its midpoint, crop the top band where
// text will sit, average pixel luma, and pick a readable fill + stroke.
const TMP = resolve(ROOT, '.tmp/caption-bg');
mkdirSync(TMP, {recursive: true});

// Crop region matching the caption layout (top band, centered).
// Caption block sits roughly y=280..900 of a 1920-tall canvas.
const CROP = '700:560:190:280'; // w:h:x:y on 1080x1920

function sampleLuma(midSec, idx) {
  const out = resolve(TMP, `cap_${String(idx).padStart(3, '0')}.png`);
  if (!existsSync(out)) {
    execSync(
      `ffmpeg -nostdin -y -ss ${midSec.toFixed(3)} -i "${VO_PATH}" -frames:v 1 -vf "crop=${CROP},scale=64:48" "${out}"`,
      {stdio: 'ignore'},
    );
  }
  // Use ffmpeg signalstats on the cropped frame to read mean Y/U/V.
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

// Pick a fill that contrasts with the sampled background.
// The video has 3 dominant zones — cream ceiling (top), teal/coral wall (mid),
// navy hoodie (bottom). The top band luma stays ~165 throughout, so a single
// per-frame measurement isn't very informative. Strategy: (a) every word gets
// a heavy black stroke + shadow so it can never blend, (b) rotate through a
// small palette of chips chosen to pop against cream and teal both. Highlight
// words use a hotter accent so they read as "the punchline".
const PALETTE = ['#FFD23F', '#FF6B35', '#3DDC97', '#F25F5C', '#FFFFFF'];
function pickFill({Y}, idx, hasHighlight) {
  // Highlights still drive the eye — give the whole phrase the hottest chip.
  if (hasHighlight) return {fill: '#FFD23F', stroke: '#0F1B2D'}; // saffron + ink
  // Otherwise rotate through the rest so consecutive captions look different.
  const fill = PALETTE[idx % PALETTE.length];
  return {fill, stroke: '#0F1B2D'};
}

const captions = phrases.map((phrase, i) => {
  const startSec = phrase[0][1];
  const endSec = phrase[phrase.length - 1][2];
  const dur = Math.max(0.4, endSec - startSec + 0.15);
  const mid = startSec + dur / 2;
  const luma = sampleLuma(Math.min(VO_DURATION - 0.05, mid), i);
  const hasHighlight = phrase.some(([t]) => HIGHLIGHTS.has(norm(t)));
  const {fill, stroke} = pickFill(luma, i, hasHighlight);
  const tokens = phrase.map(([text]) => ({
    text: text.replace(/[,.]+$/g, ''),
    highlight: HIGHLIGHTS.has(norm(text)),
  }));
  return {
    tokens,
    startSec,
    durationSec: dur,
    position: 'top',
    fill,
    stroke,
    bgY: Math.round(luma.Y),
  };
});

const plan = {
  fps: FPS,
  width: W,
  height: H,
  totalDurationSec: TOTAL_DURATION,
  watermarkText: '@manosh',
  iterationId: 'day9',
  iterationTitle: 'Day 9 update — JS RAM style',
  hookFormula: 'Hook (Day 9) → wins (AEW, billing agent) → tech (RAG, semantic, WAPI) → CTA (free + follow)',
  appliedPlaybook: {
    shotLengthSec: 2.1,
    cutOnBeat: true,
    openerStyle: 'sustained',
    genre: 'JS-RAM-style talking-head update with kinetic captions',
  },
  aroll: [
    {src: VO, startSec: 0, durationSec: VO_DURATION, trimStartSec: 0, kind: 'aroll'},
  ],
  broll: [],
  captions,
  audio: [],
};

writeFileSync(
  new URL('../src/edit-plan.json', import.meta.url),
  JSON.stringify(plan, null, 2),
);

const fillCounts = captions.reduce((m, c) => ((m[c.fill] = (m[c.fill] || 0) + 1), m), {});
console.log(`Wrote edit-plan.json — ${captions.length} caption beats, ${phrases.flat().length} words, ${VO_DURATION}s.`);
console.log(`Max words per phrase: ${Math.max(...phrases.map(p => p.length))}`);
console.log(`Fill distribution:`, fillCounts);
