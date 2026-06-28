// build-hyperframes.mjs — turn an EDL into a Hyperframes composition.
//
//   node scripts/build-hyperframes.mjs <edl.json> [--out <path>]
//
// Writes hyperframes-scenes/index.html with:
//   - <video> aroll cuts (track 0)
//   - <video muted> broll cutaways (track 1)
//   - <audio> for the aroll source (one track, single mux)
//   - frosted-glass caption pills (track 5+) with per-token spring-scale
//     entrances via GSAP, palette-locked colors
//   - grain + vignette overlays when the brain calls for them
//   - watermark
//
// 1080×1920 throughout — reconciling the resolution mismatch the inventory
// flagged.
import {existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync} from 'node:fs';
import {basename, dirname, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEDL, PALETTE} from '../src/schema/edl.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HF = resolve(ROOT, 'hyperframes-scenes');
const HF_ASSETS = resolve(HF, 'assets/media');

const args = process.argv.slice(2);
const edlArg = args[0];
if (!edlArg) {
  console.error('usage: node scripts/build-hyperframes.mjs <edl.json> [--out <path>]');
  process.exit(2);
}
const edlPath = resolve(edlArg);
if (!existsSync(edlPath)) {
  console.error(`no such edl: ${edlPath}`);
  process.exit(1);
}
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : resolve(HF, 'index.html');

const edl = parseEDL(JSON.parse(readFileSync(edlPath, 'utf8')));
const {meta, source} = edl;
const W = meta.width;
const H = meta.height;
const T = meta.totalDurationSec;

// --- Asset staging --------------------------------------------------------
// Hyperframes resolves paths relative to the composition HTML. We copy the
// source + broll into hyperframes-scenes/assets/media/ so render is hermetic.
mkdirSync(HF_ASSETS, {recursive: true});

function stage(srcRel) {
  // srcRel is relative to public/ (the convention from the EDL).
  const absSrc = resolve(ROOT, 'public', srcRel);
  if (!existsSync(absSrc)) {
    console.error(`missing media: ${absSrc}`);
    process.exit(1);
  }
  const flat = srcRel.replace(/\//g, '_');
  const dst = resolve(HF_ASSETS, flat);
  if (!existsSync(dst) || isNewer(absSrc, dst)) {
    copyFileSync(absSrc, dst);
  }
  // Path written into the HTML is relative to hyperframes-scenes/.
  return `assets/media/${flat}`;
}
function isNewer(a, b) {
  try { return statSync(a).mtimeMs > statSync(b).mtimeMs; }
  catch { return true; }
}

const arollAsset = stage(source.src);
const brollAssets = edl.broll.map((b) => ({...b, asset: stage(b.src)}));

// --- HTML helpers ---------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => Number(n.toFixed(3));

// --- Caption pills --------------------------------------------------------
// Each pill is a `.caption` clip; per-token spans animate in via GSAP.
const POSITION_TOP = 240;
const POSITION_MIDDLE = (H - 200) / 2;
const POSITION_BOTTOM = H - 540;
function pillTop(position) {
  if (position === 'middle') return POSITION_MIDDLE;
  if (position === 'bottom') return POSITION_BOTTOM;
  return POSITION_TOP;
}

const captionHtml = edl.captions.map((c, idx) => {
  const top = pillTop(c.position);
  const trackIdx = 100 + idx; // each caption on its own track, well above broll/overlays
  const tokens = c.tokens.map((t, i) => {
    const cls = t.highlight ? 'tok hl' : 'tok';
    return `<span class="${cls}" data-cap="${idx}" data-tok="${i}">${esc(t.text)}</span>`;
  }).join('');
  // Glass styles inline so each caption can carry its own intensity.
  const glassStyle = [
    `top:${top}px`,
    `background:rgba(15,27,45,${c.glass.opacity})`,
    `backdrop-filter:blur(${c.glass.blurPx}px) saturate(140%)`,
    `-webkit-backdrop-filter:blur(${c.glass.blurPx}px) saturate(140%)`,
    `--cap-fill:${c.fill}`,
    `--cap-stroke:${c.stroke}`,
  ].join(';');
  return `<div id="cap-${idx}" class="clip caption" data-start="${fmt(c.startSec)}" data-duration="${fmt(c.durationSec)}" data-track-index="${trackIdx}" style="${glassStyle}">${tokens}</div>`;
}).join('\n      ');

// --- A-roll video clips ---------------------------------------------------
// One <video> per cut, all on track 0 (cuts are sequential, no overlap).
// data-media-start trims into the source. Audio comes from a separate track.
const cutsHtml = edl.cuts.map((c, i) => {
  const dur = c.srcEndSec - c.srcStartSec;
  return `<video id="aroll-${i}" class="clip aroll" src="${arollAsset}" data-start="${fmt(c.outStartSec)}" data-duration="${fmt(dur)}" data-media-start="${fmt(c.srcStartSec)}" data-track-index="0" muted playsinline></video>`;
}).join('\n      ');

// --- B-roll cutaways (track 50+, above aroll). Each on its own track so
// adjacent cutaways can briefly overlap if the brain wants a cross-fade. ---
const brollHtml = brollAssets.map((b, i) => {
  return `<video id="broll-${i}" class="clip broll" src="${b.asset}" data-start="${fmt(b.startSec)}" data-duration="${fmt(b.durationSec)}" data-media-start="${fmt(b.trimStartSec)}" data-track-index="${50 + i}" muted playsinline></video>`;
}).join('\n      ');

// --- Audio (single track) -------------------------------------------------
const audioHtml = `<audio id="aroll-audio" class="clip" src="${arollAsset}" data-start="0" data-duration="${fmt(T)}" data-track-index="90" data-volume="1" data-has-audio="true"></audio>`;

// --- Overlays -------------------------------------------------------------
const overlaysHtml = edl.overlays.map((o, i) => {
  const id = `overlay-${o.kind}-${i}`;
  if (o.kind === 'grain') {
    return `<div id="${id}" class="clip grain" data-start="${fmt(o.startSec)}" data-duration="${fmt(o.durationSec)}" data-track-index="${200 + i}"></div>`;
  }
  if (o.kind === 'vignette') {
    return `<div id="${id}" class="clip vignette" data-start="${fmt(o.startSec)}" data-duration="${fmt(o.durationSec)}" data-track-index="${210 + i}"></div>`;
  }
  if (o.kind === 'liquid-glass-strip') {
    return `<div id="${id}" class="clip glass-strip" data-start="${fmt(o.startSec)}" data-duration="${fmt(o.durationSec)}" data-track-index="${220 + i}"></div>`;
  }
  return '';
}).filter(Boolean).join('\n      ');

// --- Watermark ------------------------------------------------------------
const watermarkHtml = meta.watermarkText
  ? `<div id="watermark" class="clip watermark" data-start="0" data-duration="${fmt(T)}" data-track-index="300">${esc(meta.watermarkText)}</div>`
  : '';

// --- GSAP timeline --------------------------------------------------------
// Per-token spring-style entrance. Mirrors the Remotion config: scale 0.6→1,
// opacity 0→1, stagger across the pill's duration.
const captionTimelines = edl.captions.map((c, idx) => {
  const perToken = Math.min(0.18, c.durationSec / Math.max(c.tokens.length * 1.4, 2));
  // Set initial state for each token, then animate to 1.
  const sets = c.tokens.map((_, i) =>
    `tl.set("#cap-${idx} .tok[data-tok='${i}']", {scale: 0.6, opacity: 0}, ${fmt(c.startSec + i * perToken)});`
  ).join('\n      ');
  const tos = c.tokens.map((_, i) =>
    `tl.to("#cap-${idx} .tok[data-tok='${i}']", {scale: 1, opacity: 1, duration: 0.32, ease: "back.out(1.9)"}, ${fmt(c.startSec + i * perToken)});`
  ).join('\n      ');
  return `${sets}\n      ${tos}`;
}).join('\n      ');

// --- The composition HTML -------------------------------------------------
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face {
        font-family: "InterBlack";
        src: url("fonts/Inter_28pt-Black.ttf") format("truetype");
        font-weight: 900;
      }
      @font-face {
        font-family: "AstonScript";
        src: url("fonts/Aston Script.ttf") format("truetype");
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${W}px; height: ${H}px;
        overflow: hidden;
        background: #000;
        font-family: "InterBlack", system-ui, sans-serif;
      }
      #root { position: relative; width: ${W}px; height: ${H}px; }
      .aroll, .broll {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        object-fit: cover;
      }
      /* Caption pill: frosted glass behind stacked tokens. */
      .caption {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 26px 44px;
        border-radius: 36px;
        border: 1px solid rgba(255,255,255,0.18);
        box-shadow:
          0 12px 40px rgba(0,0,0,0.45),
          inset 0 1px 0 rgba(255,255,255,0.22),
          inset 0 -1px 0 rgba(0,0,0,0.25);
        max-width: ${W - 120}px;
      }
      .caption .tok {
        display: inline-block;
        font-family: "InterBlack", sans-serif;
        font-weight: 900;
        font-size: 130px;
        line-height: 1.0;
        letter-spacing: -2px;
        text-transform: uppercase;
        color: var(--cap-fill);
        text-shadow:
          -3px 0 0 var(--cap-stroke), 3px 0 0 var(--cap-stroke),
          0 -3px 0 var(--cap-stroke), 0 3px 0 var(--cap-stroke),
          -3px -3px 0 var(--cap-stroke), 3px -3px 0 var(--cap-stroke),
          -3px 3px 0 var(--cap-stroke), 3px 3px 0 var(--cap-stroke),
          0 8px 24px rgba(0,0,0,0.55);
        transform-origin: center bottom;
      }
      .caption .tok.hl {
        font-family: "AstonScript", cursive;
        font-weight: 400;
        font-size: 168px;
        letter-spacing: 0;
        text-transform: none;
        padding-bottom: 8px;
      }
      /* Overlays */
      .grain {
        position: absolute; inset: 0; pointer-events: none;
        background-image:
          repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px),
          repeating-linear-gradient(90deg, rgba(0,0,0,0.025) 0 1px, transparent 1px 3px);
        mix-blend-mode: overlay;
      }
      .vignette {
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%);
      }
      .glass-strip {
        position: absolute;
        left: 0; right: 0;
        top: ${Math.round(H * 0.42)}px;
        height: ${Math.round(H * 0.16)}px;
        background: rgba(255,255,255,0.08);
        backdrop-filter: blur(28px) saturate(160%);
        -webkit-backdrop-filter: blur(28px) saturate(160%);
        border-top: 1px solid rgba(255,255,255,0.22);
        border-bottom: 1px solid rgba(255,255,255,0.22);
        box-shadow: 0 0 60px rgba(255,107,53,0.25);
      }
      .watermark {
        position: absolute;
        left: 36px; bottom: 64px;
        padding: 10px 18px;
        font-family: "InterBlack", sans-serif;
        font-size: 32px;
        letter-spacing: 1.4px;
        color: rgba(255,255,255,0.9);
        background: rgba(0,0,0,0.32);
        border-radius: 10px;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${fmt(T)}" data-width="${W}" data-height="${H}">
      ${cutsHtml}
      ${brollHtml}
      ${audioHtml}
      ${overlaysHtml}
      ${captionHtml}
      ${watermarkHtml}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${captionTimelines}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
console.log(`  ${W}x${H} @ ${meta.fps}fps, ${T.toFixed(2)}s`);
console.log(`  cuts: ${edl.cuts.length}, broll: ${edl.broll.length}, captions: ${edl.captions.length}, overlays: ${edl.overlays.length}`);
