import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Sequence, OffthreadVideo, Img, Audio, staticFile, useVideoConfig, useCurrentFrame, interpolate, spring} from 'remotion';
import {z} from 'zod';
import {FONTS, ensureFontsLoaded} from './fonts';

const clipSchema = z.object({
  src: z.string(),
  startSec: z.number(),
  durationSec: z.number(),
  trimStartSec: z.number().default(0),
  kind: z.enum(['aroll', 'broll', 'image']).default('broll'),
});

const captionTokenSchema = z.object({
  text: z.string(),
  highlight: z.boolean().default(false),
});

const captionSchema = z.object({
  tokens: z.array(captionTokenSchema).optional(),
  text: z.string().optional(),
  highlightWords: z.array(z.string()).optional(),
  startSec: z.number(),
  durationSec: z.number(),
  position: z.enum(['top', 'middle', 'bottom']).default('top'),
  fill: z.string().default('#FFD23F'),
  stroke: z.string().default('#0F1B2D'),
});

const audioSchema = z.object({
  src: z.string(),
  startSec: z.number(),
  durationSec: z.number().optional(),
  volume: z.number().default(1),
  kind: z.enum(['music', 'sfx', 'voice']).default('sfx'),
});

export const reelEditSchema = z.object({
  plan: z.object({
    fps: z.number(),
    width: z.number(),
    height: z.number(),
    totalDurationSec: z.number(),
    aroll: z.array(clipSchema),
    broll: z.array(clipSchema),
    captions: z.array(captionSchema),
    audio: z.array(audioSchema).optional(),
    watermarkText: z.string().optional(),
  }),
});

export type Plan = z.infer<typeof reelEditSchema>['plan'];

const sec = (s: number, fps: number) => Math.max(1, Math.round(s * fps));

const Layer: React.FC<{clips: Plan['aroll']}> = ({clips}) => {
  const {fps} = useVideoConfig();
  return (
    <>
      {clips.filter((c) => c.src).map((c, i) => (
        <Sequence key={i} from={sec(c.startSec, fps)} durationInFrames={sec(c.durationSec, fps)}>
          {c.kind === 'image' ? (
            <Img src={c.src.startsWith('http') ? c.src : staticFile(c.src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            <OffthreadVideo
              src={c.src.startsWith('http') ? c.src : staticFile(c.src)}
              startFrom={sec(c.trimStartSec, fps)}
              style={{width: '100%', height: '100%', objectFit: 'cover'}}
              muted={c.kind === 'broll'}
            />
          )}
        </Sequence>
      ))}
    </>
  );
};

const KineticCaption: React.FC<{caption: z.infer<typeof captionSchema>}> = ({caption}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const tokens = caption.tokens
    ?? (caption.text ?? '').split(/\s+/).filter(Boolean).map((w) => ({
      text: w,
      highlight: caption.highlightWords?.includes(w.replace(/[^a-z]/gi, '').toLowerCase()) ?? false,
    }));
  const totalFrames = sec(caption.durationSec, fps);
  const perToken = totalFrames / Math.max(tokens.length, 1);
  const justifyContent = caption.position === 'top' ? 'flex-start' : caption.position === 'middle' ? 'center' : 'flex-end';
  const paddingTop = caption.position === 'top' ? 280 : 0;
  const paddingBottom = caption.position === 'bottom' ? 200 : 0;
  const fill = caption.fill ?? '#FFD23F';
  const stroke = caption.stroke ?? '#0F1B2D';
  // Layered text-shadow synthesizes a thick stroke + drop shadow that survives any background.
  const heavyStroke = (color: string) =>
    `-3px 0 0 ${color}, 3px 0 0 ${color}, 0 -3px 0 ${color}, 0 3px 0 ${color},`
    + ` -3px -3px 0 ${color}, 3px -3px 0 ${color}, -3px 3px 0 ${color}, 3px 3px 0 ${color},`
    + ` 0 6px 18px rgba(0,0,0,0.55)`;
  return (
    <AbsoluteFill style={{justifyContent, alignItems: 'center', paddingTop, paddingBottom, paddingLeft: 60, paddingRight: 60}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', maxWidth: '95%'}}>
        {tokens.map((tok, i) => {
          const inFrame = frame - i * perToken;
          if (inFrame < 0) return null;
          const pop = spring({frame: Math.max(0, inFrame), fps, config: {damping: 12, mass: 0.5}});
          const scale = interpolate(pop, [0, 1], [0.6, 1]);
          const opacity = interpolate(pop, [0, 0.6, 1], [0, 1, 1]);
          const isHighlight = tok.highlight;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                transform: `scale(${scale})`,
                opacity,
                fontFamily: isHighlight ? FONTS.aston : FONTS.interBlack,
                fontSize: isHighlight ? 158 : 128,
                fontWeight: isHighlight ? 400 : 900,
                color: fill,
                textShadow: heavyStroke(stroke),
                lineHeight: 1.0,
                letterSpacing: isHighlight ? 0 : -2,
                textTransform: isHighlight ? 'none' : 'uppercase',
                paddingBottom: isHighlight ? 8 : 0,
                transformOrigin: 'center bottom',
              }}
            >
              {tok.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Watermark: React.FC<{text: string}> = ({text}) => (
  <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'flex-start', paddingLeft: 32, paddingBottom: 56}}>
    <div style={{
      fontFamily: FONTS.inter,
      fontSize: 30,
      fontWeight: 800,
      color: 'rgba(255,255,255,0.85)',
      padding: '8px 14px',
      borderRadius: 8,
      backgroundColor: 'rgba(0,0,0,0.32)',
      textTransform: 'uppercase',
      letterSpacing: 1.2,
    }}>
      {text}
    </div>
  </AbsoluteFill>
);

const AudioTracks: React.FC<{tracks: Plan['audio']}> = ({tracks}) => {
  const {fps} = useVideoConfig();
  if (!tracks?.length) return null;
  return (
    <>
      {tracks.map((t, i) => (
        <Sequence key={i} from={sec(t.startSec, fps)} durationInFrames={t.durationSec ? sec(t.durationSec, fps) : undefined}>
          <Audio src={t.src.startsWith('http') ? t.src : staticFile(t.src)} volume={t.volume ?? 1} />
        </Sequence>
      ))}
    </>
  );
};

export const ReelEdit: React.FC<{plan: Plan}> = ({plan}) => {
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    ensureFontsLoaded().then(() => setFontsReady(true));
  }, []);
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: 'black'}}>
      <AbsoluteFill>
        <Layer clips={plan.aroll} />
      </AbsoluteFill>
      <AbsoluteFill>
        <Layer clips={plan.broll} />
      </AbsoluteFill>
      {fontsReady && (
        <>
          {plan.captions.map((c, i) => (
            <Sequence key={i} from={sec(c.startSec, fps)} durationInFrames={sec(c.durationSec, fps)}>
              <KineticCaption caption={c} />
            </Sequence>
          ))}
        </>
      )}
      {plan.watermarkText && <Watermark text={plan.watermarkText} />}
      <AudioTracks tracks={plan.audio} />
    </AbsoluteFill>
  );
};
