// EDL = Edit Decision List. The single source of truth that flows
// transcribe → brain → hyperframes scene generator → renderer.
//
// Schema is authored in zod so the brain can validate Claude's tool-call
// output, and exported as a JSON Schema so Claude's tool definition matches
// exactly (forced tool use with strict:true guarantees conformance).
import {z} from 'zod';

export const PALETTE = {
  orange: '#FF6B35',
  white: '#FFFFFF',
  navy: '#0F1B2D',
};

// A frosted-glass caption pill. Captions stack vertically; each pill holds
// up to 3 tokens. `fill` should be one of the locked palette hexes; the
// deterministic post-processor may override it with a frame-sampled value
// to guarantee contrast against the underlying video.
const captionTokenSchema = z.object({
  text: z.string().min(1).max(40),
  highlight: z.boolean().default(false),
});

const captionSchema = z.object({
  tokens: z.array(captionTokenSchema).min(1).max(3),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  position: z.enum(['top', 'middle', 'bottom']).default('top'),
  fill: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default(PALETTE.orange),
  stroke: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default(PALETTE.navy),
  glass: z.object({
    blurPx: z.number().min(0).max(60).default(18),
    opacity: z.number().min(0).max(1).default(0.42),
    rimLight: z.boolean().default(true),
  }).prefault({blurPx: 18, opacity: 0.42, rimLight: true}),
});

// A cut keeps a segment of the source clip. Cuts compose into the final
// timeline in their listed order; `outStartSec` lets the brain leave
// intentional gaps for b-roll-only stretches if needed.
const cutSchema = z.object({
  srcStartSec: z.number().nonnegative(),
  srcEndSec: z.number().positive(),
  outStartSec: z.number().nonnegative(),
});

const brollSchema = z.object({
  src: z.string(),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  trimStartSec: z.number().nonnegative().default(0),
});

const overlaySchema = z.object({
  kind: z.enum(['liquid-glass-strip', 'vignette', 'grain']),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  props: z.record(z.string(), z.any()).default({}),
});

const audioSchema = z.object({
  src: z.string(),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive().optional(),
  volume: z.number().min(0).max(2).default(1),
  kind: z.enum(['music', 'sfx', 'voice']).default('sfx'),
});

export const edlSchema = z.object({
  meta: z.object({
    fps: z.number().int().positive().default(30),
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    totalDurationSec: z.number().positive(),
    watermarkText: z.string().default('@manosh'),
    palette: z.object({
      orange: z.string().default(PALETTE.orange),
      white: z.string().default(PALETTE.white),
      navy: z.string().default(PALETTE.navy),
    }).prefault({orange: PALETTE.orange, white: PALETTE.white, navy: PALETTE.navy}),
  }),
  source: z.object({
    src: z.string(),
    durationSec: z.number().positive(),
  }),
  cuts: z.array(cutSchema).default([]),
  captions: z.array(captionSchema).default([]),
  broll: z.array(brollSchema).default([]),
  overlays: z.array(overlaySchema).default([]),
  audio: z.array(audioSchema).default([]),
});

/**
 * The brain only invents a subset of the EDL — captions, cuts, broll cues,
 * overlays. Meta + source + audio are filled in deterministically before
 * the brain runs, then merged with the brain's output. This trims the
 * tool input_schema Claude sees so it focuses on the editorial choices.
 */
export const brainOutputSchema = z.object({
  cuts: z.array(cutSchema),
  captions: z.array(captionSchema),
  broll: z.array(brollSchema),
  overlays: z.array(overlaySchema),
});

// JSON Schema for Claude tool input_schema. Use zod 4's native exporter so
// we don't depend on a third-party converter that lags behind zod releases.
export function brainOutputJsonSchema() {
  const js = z.toJSONSchema(brainOutputSchema, {target: 'draft-7'});
  // Anthropic's tool-use parser doesn't want the $schema header.
  delete js.$schema;
  return js;
}

/** Validate + apply defaults to a raw EDL (e.g. loaded from disk). */
export function parseEDL(obj) {
  return edlSchema.parse(obj);
}
