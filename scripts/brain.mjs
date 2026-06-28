// brain.mjs — Claude as a style brain. Reads a Whisper transcript + your
// style memory + reference frames; emits an EDL via forced tool use.
//
//   node scripts/brain.mjs <words.json> [--source <path>] [--style-pin <id>] [--force]
//
// Output: .tmp/<stem>-edl.json — full validated EDL, ready for the scene
// generator. Cached unless --force.
//
// After Claude returns the editorial picks, deterministic post-processing
// runs the existing ffmpeg color sampler so caption fills always contrast
// the underlying frame ("brain proposes, ffmpeg disposes").
import 'dotenv/config';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {basename, dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {brainOutputSchema, brainOutputJsonSchema, edlSchema, PALETTE} from '../src/schema/edl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TMP = resolve(ROOT, '.tmp');
const STYLE_DIR = resolve(ROOT, 'style-analysis');

const args = process.argv.slice(2);
const wordsArg = args[0];
if (!wordsArg) {
  console.error('usage: node scripts/brain.mjs <words.json> [--source <path>] [--style-pin <id>] [--force]');
  process.exit(2);
}
const wordsPath = resolve(wordsArg);
if (!existsSync(wordsPath)) {
  console.error(`no such words.json: ${wordsPath}`);
  process.exit(1);
}
const force = args.includes('--force');
const sourceIdx = args.indexOf('--source');
const sourceOverride = sourceIdx >= 0 ? args[sourceIdx + 1] : null;
const stylePinIdx = args.indexOf('--style-pin');
const stylePin = stylePinIdx >= 0 ? args[stylePinIdx + 1] : null;

const stem = basename(wordsPath, extname(wordsPath)).replace(/-words$/, '');
const outPath = resolve(TMP, `${stem}-edl.json`);
if (!force && existsSync(outPath) && statSync(outPath).mtimeMs > statSync(wordsPath).mtimeMs) {
  console.log(`cached: ${outPath}`);
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY missing. Add it to .env and try again.');
  process.exit(3);
}
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const baseURL = process.env.ANTHROPIC_BASE_URL || undefined;

// --- Load inputs ----------------------------------------------------------
const transcript = JSON.parse(readFileSync(wordsPath, 'utf8'));
const totalDuration = transcript.words.length
  ? transcript.words[transcript.words.length - 1][2] + 0.3
  : 30;

// Resolve the source video. Convention: if not given, assume the words file
// lives next to public/aroll/<stem>.mp4 (which is how transcribe.mjs writes).
const sourcePath = sourceOverride
  ? resolve(sourceOverride)
  : resolve(ROOT, `public/aroll/${stem}.mp4`);
if (!existsSync(sourcePath)) {
  console.error(`source video missing: ${sourcePath} (use --source to override)`);
  process.exit(1);
}
const sourceRel = sourcePath.startsWith(resolve(ROOT, 'public') + '/')
  ? sourcePath.slice(resolve(ROOT, 'public').length + 1)
  : sourcePath;

// --- Load style memory ----------------------------------------------------
const editorialStyle = JSON.parse(readFileSync(resolve(STYLE_DIR, 'editorial-style.json'), 'utf8'));
const brandKit = existsSync(resolve(STYLE_DIR, 'brand-kit.json'))
  ? JSON.parse(readFileSync(resolve(STYLE_DIR, 'brand-kit.json'), 'utf8'))
  : null;

// Pick 6–10 reference frames. Prefer hook frames (they teach the brain
// "what an opener looks like") plus a couple of mid-shot examples for
// pacing/contrast. Pin to one folder if --style-pin given.
function pickReferenceFrames() {
  const preprocDir = resolve(STYLE_DIR, 'preproc');
  if (!existsSync(preprocDir)) return [];
  const folders = readdirSync(preprocDir)
    .filter((d) => statSync(resolve(preprocDir, d)).isDirectory())
    .filter((d) => !stylePin || d.includes(stylePin));
  const picks = [];
  const FRAMES_PER_FOLDER = 2;
  for (const folder of folders) {
    const dir = resolve(preprocDir, folder);
    const files = readdirSync(dir).sort();
    const hooks = files.filter((f) => f.startsWith('hook_') && f.endsWith('.jpg')).slice(0, FRAMES_PER_FOLDER);
    for (const f of hooks) picks.push({label: `${folder} hook`, path: resolve(dir, f)});
    if (picks.length >= 10) break;
  }
  return picks.slice(0, 10);
}

const referenceFrames = pickReferenceFrames();
console.log(`brain context: ${referenceFrames.length} reference frames, ${transcript.words.length} words, model=${model}`);

// --- Build the Claude request --------------------------------------------
function toBase64Jpeg(filePath) {
  // Anthropic caps long edge ≈2000px before downscale anyway; the existing
  // preproc frames are already small. Send as-is.
  return readFileSync(filePath).toString('base64');
}

const systemPrompt = [
  `You are the editorial brain for a 9:16 vertical reel. You decide where to cut,`,
  `what captions to show, and where to place b-roll cutaways for the supplied transcript.`,
  ``,
  `STYLE MEMORY (distilled from prior reels):`,
  JSON.stringify(editorialStyle.synthesis, null, 2),
  ``,
  `BRAND KIT:`,
  brandKit ? JSON.stringify(brandKit, null, 2) : '(none)',
  ``,
  `LOCKED PALETTE for caption fills (use ONLY these hexes):`,
  `  orange #FF6B35  white #FFFFFF  navy #0F1B2D`,
  `Captions sit on frosted-glass pills. Glass defaults: blurPx=18, opacity=0.42, rimLight=true.`,
  `Cap each caption at 3 tokens. Mark 1 token per caption \`highlight: true\` when it's the punch word.`,
  ``,
  `RULES:`,
  `- cuts[] must monotonically increase outStartSec and cover the full duration unless gaps are intentional.`,
  `- captions[] must monotonically increase startSec and not overlap.`,
  `- broll[] points to clips under public/broll/. Pick anchors on concrete nouns or verbs, not connectives.`,
  `- overlays[] is optional; use 'liquid-glass-strip' sparingly (1–2 max) for hero moments.`,
  `- Match the pacing playbook above. Shorter shots = punchier reel.`,
].join('\n');

const referenceFolderList = pickReferenceFolderList(stylePin);
const userContent = [];

referenceFrames.forEach((rf, i) => {
  userContent.push({type: 'text', text: `Reference ${i + 1} (${rf.label}):`});
  userContent.push({
    type: 'image',
    source: {type: 'base64', media_type: 'image/jpeg', data: toBase64Jpeg(rf.path)},
  });
});

userContent.push({
  type: 'text',
  text: [
    `NEW CLIP TO EDIT`,
    `Source: ${sourceRel}  (duration ${totalDuration.toFixed(2)}s)`,
    `Available b-roll clips (relative paths under public/):`,
    listBrollCandidates(),
    ``,
    `Transcript (word, startSec, endSec):`,
    transcript.words.map(([t, s, e]) => `  ${s.toFixed(2)}-${e.toFixed(2)} "${t}"`).join('\n'),
    ``,
    `Emit the EDL by calling the emit_edl tool. Do not respond with prose.`,
  ].join('\n'),
});

function pickReferenceFolderList(pin) {
  const dir = resolve(STYLE_DIR, 'preproc');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => statSync(resolve(dir, d)).isDirectory()).filter((d) => !pin || d.includes(pin));
}

function listBrollCandidates() {
  const dir = resolve(ROOT, 'public/broll');
  if (!existsSync(dir)) return '  (none — pick anchors but leave broll[] empty)';
  return readdirSync(dir)
    .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
    .map((f) => `  broll/${f}`)
    .join('\n') || '  (none)';
}

// --- Call Claude ----------------------------------------------------------
const anthropic = new Anthropic({apiKey, ...(baseURL ? {baseURL} : {})});
const toolSchema = brainOutputJsonSchema();

console.log(`calling ${model} ${baseURL ? `via ${baseURL}` : '(anthropic api)'}…`);
const t0 = Date.now();
const response = await anthropic.messages.create({
  model,
  max_tokens: 8000,
  system: systemPrompt,
  tools: [{
    name: 'emit_edl',
    description: 'Emit the edit decision list for this clip. Captions stacked, palette-locked, monotonic timing.',
    input_schema: toolSchema,
  }],
  tool_choice: {type: 'tool', name: 'emit_edl'},
  messages: [{role: 'user', content: userContent}],
});
console.log(`Claude responded in ${((Date.now() - t0) / 1000).toFixed(1)}s, stop=${response.stop_reason}, usage=${JSON.stringify(response.usage)}`);

const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'emit_edl');
if (!toolUse) {
  console.error('no emit_edl tool_use block in response:');
  console.error(JSON.stringify(response.content, null, 2));
  process.exit(4);
}

let brainPicks;
try {
  brainPicks = brainOutputSchema.parse(toolUse.input);
} catch (e) {
  console.error('brain output failed schema validation:');
  console.error(e.message);
  console.error('raw tool input:');
  console.error(JSON.stringify(toolUse.input, null, 2));
  process.exit(5);
}

// --- Deterministic post-processing: sample frame luma and snap fills ------
// Mirrors the sampler from scripts/build-clean994-plan.mjs:64-97. We crop
// the upper-third where the caption pill sits and pick a fill that contrasts.
function sampleLuma(midSec, idx) {
  const out = resolve(TMP, `bg/${stem}_${String(idx).padStart(3, '0')}.png`);
  mkdirSync(dirname(out), {recursive: true});
  if (!existsSync(out)) {
    execSync(
      `ffmpeg -nostdin -y -ss ${midSec.toFixed(3)} -i "${sourcePath}" -frames:v 1 -vf "crop=iw*0.7:ih*0.3:iw*0.15:ih*0.16,scale=64:48" "${out}"`,
      {stdio: 'ignore'},
    );
  }
  const stats = execSync(
    `ffmpeg -nostdin -hide_banner -i "${out}" -vf "signalstats,metadata=print" -f null - 2>&1`,
    {encoding: 'utf8'},
  );
  const Y = parseFloat(stats.match(/lavfi\.signalstats\.YAVG=([\d.]+)/)?.[1] ?? '128');
  return Y;
}

const ORANGE = PALETTE.orange;
const WHITE = PALETTE.white;
const NAVY = PALETTE.navy;
brainPicks.captions = brainPicks.captions.map((c, i) => {
  const mid = c.startSec + c.durationSec / 2;
  const Y = sampleLuma(mid, i);
  // Dark background → orange or white pop. Bright background → navy text.
  // Always keep stroke as the opposite of fill for legibility.
  let fill, stroke;
  if (Y > 150) {
    fill = NAVY;
    stroke = WHITE;
  } else {
    // alternate orange/white for rhythm; highlights lean orange.
    const hasHighlight = c.tokens.some((t) => t.highlight);
    fill = hasHighlight || i % 2 === 0 ? ORANGE : WHITE;
    stroke = NAVY;
  }
  return {...c, fill, stroke};
});

// --- Assemble the full EDL ------------------------------------------------
const edl = edlSchema.parse({
  meta: {
    fps: 30,
    width: 1080,
    height: 1920,
    totalDurationSec: totalDuration,
    watermarkText: '@manosh',
  },
  source: {src: sourceRel, durationSec: totalDuration},
  cuts: brainPicks.cuts.length
    ? brainPicks.cuts
    : [{srcStartSec: 0, srcEndSec: totalDuration, outStartSec: 0}],
  captions: brainPicks.captions,
  broll: brainPicks.broll,
  overlays: brainPicks.overlays,
  audio: [],
});

writeFileSync(outPath, JSON.stringify(edl, null, 2));
console.log(`wrote ${outPath}`);
console.log(`  cuts: ${edl.cuts.length}, captions: ${edl.captions.length}, broll: ${edl.broll.length}, overlays: ${edl.overlays.length}`);
