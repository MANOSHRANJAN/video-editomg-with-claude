export const meta = {
  name: 'learn-edit-style',
  description: 'Read preprocessed reference videos, fan out vision agents per video, adversarially verify, synthesize editorial-style.json',
  phases: [
    {title: 'Read'},
    {title: 'Verify'},
    {title: 'Synthesize'},
  ],
}

const PREPROC_DIRS = [
  'From_Klickpin.com-_From_beginner_to_obsessed_Build_these_fresh_weekend_DIY_ideas',
  'From_Klickpin.com-_Luxury_Clean_Girl_Makeup_Looks___pin1027524471252035105',
  'From_Klickpin.com-_Luxury_Clean_Girl_Makeup_Looks___pin1081708404296737259',
  'From_Klickpin.com-_Luxury_Clean_Girl_Makeup_Looks___pin1086986060082933811',
  'From_Klickpin.com-_Luxury_Clean_Girl_Makeup_Looks___pin1147643917677607792',
  'From_Klickpin.com-_Luxury_Clean_Girl_Makeup_Looks___pin994451161484829882',
]

const PREPROC_BASE = '/Users/manoshranjan/new leads/video-edit/style-analysis/preproc'

const VIDEO_PROFILE_SCHEMA = {
  type: 'object',
  required: [
    'name', 'subject', 'shotComposition', 'cameraMotion', 'lightingPalette',
    'pacingDescription', 'cutOnBeat', 'transitionStyle', 'hookStructure',
    'captionStyle', 'voiceoverStyle', 'editorialIntent', 'distinctiveTechniques',
  ],
  properties: {
    name: {type: 'string'},
    subject: {type: 'string', description: 'what the video is about in 1 sentence based on transcript + visuals'},
    shotComposition: {type: 'string', description: 'framing patterns: close-up vs wide, centered vs rule-of-thirds, talking-head vs b-roll, hand-held vs locked-off'},
    cameraMotion: {type: 'string', description: 'static, push-in, pan, gimbal, hand-held, zoom'},
    lightingPalette: {type: 'string', description: 'how the colors land: clinical-bright, warm-natural, moody-low-key, high-contrast'},
    pacingDescription: {type: 'string', description: 'narrate the rhythm: builds slow then cuts fast, steady throughout, accelerates to punchline'},
    cutOnBeat: {type: 'object', properties: {
      observed: {type: 'boolean'},
      evidence: {type: 'string'},
    }, required: ['observed', 'evidence']},
    transitionStyle: {type: 'string', description: 'dominant transition kind and any signature moves'},
    hookStructure: {type: 'object', properties: {
      seconds0to3: {type: 'string', description: 'what literally happens in the first 3 seconds'},
      tension: {type: 'string', description: 'what makes the viewer stay'},
    }, required: ['seconds0to3', 'tension']},
    captionStyle: {type: 'object', properties: {
      present: {type: 'boolean'},
      pattern: {type: 'string', description: 'word-by-word, phrase, sentence; position; styling — guess from frames + transcript timing'},
    }, required: ['present', 'pattern']},
    voiceoverStyle: {type: 'string', description: 'spoken cadence, phrasing, hooks, CTAs'},
    editorialIntent: {type: 'string', description: 'what is the viewer supposed to feel/do'},
    distinctiveTechniques: {type: 'array', items: {type: 'string'}, description: 'signature moves a copycat editor would use'},
  },
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  required: ['editorialProfile', 'cuttingRules', 'brollGuidance', 'captionGuidance', 'hookFormula', 'pexelsKeywords', 'pacingPlaybook'],
  properties: {
    editorialProfile: {type: 'object', properties: {
      genre: {type: 'string'},
      mood: {type: 'string'},
      audience: {type: 'string'},
      brandFeel: {type: 'string'},
    }, required: ['genre', 'mood', 'audience', 'brandFeel']},
    cuttingRules: {type: 'array', items: {type: 'string'}},
    brollGuidance: {type: 'object', properties: {
      ratioToAroll: {type: 'string'},
      placementPrinciple: {type: 'string'},
      contentTypes: {type: 'array', items: {type: 'string'}},
    }, required: ['ratioToAroll', 'placementPrinciple', 'contentTypes']},
    captionGuidance: {type: 'object', properties: {
      style: {type: 'string'},
      timing: {type: 'string'},
      position: {type: 'string'},
    }, required: ['style', 'timing', 'position']},
    hookFormula: {type: 'string'},
    pexelsKeywords: {type: 'array', items: {type: 'string'}},
    pacingPlaybook: {type: 'object', properties: {
      shotLengthSec: {type: 'number'},
      acceleratesAtSec: {type: 'number'},
      cutOnBeat: {type: 'boolean'},
      rules: {type: 'array', items: {type: 'string'}},
    }, required: ['shotLengthSec', 'cutOnBeat', 'rules']},
  },
}

phase('Read')
log(`Fanning out ${PREPROC_DIRS.length} per-video editorial agents`)

const profiles = await parallel(PREPROC_DIRS.map((dir) => async () => {
  const absDir = `${PREPROC_BASE}/${dir}`
  const prompt = `You are an editorial reviewer for a vertical short-form reel. Read the preprocessed bundle for ONE video and produce a structured editorial profile.

VIDEO BUNDLE: ${absDir}

STEP 1 — Read these JSON files with the Read tool:
  ${absDir}/meta.json
  ${absDir}/shots.json
  ${absDir}/transcript.json
  ${absDir}/beats.json
  ${absDir}/transitions.json

STEP 2 — Read AT MOST 6 keyframe images with the Read tool. Pick: first shot, last shot, and up to 4 evenly spaced in between. These are JPEGs.

STEP 3 — Read AT MOST 4 hook frames (first 5s sampled). Pick frames 01, 03, 05, 09 from hookFrames.

DO NOT read every frame. Limit total Read calls to 10 images max — the prompt context overflows otherwise.

STEP 4 — Cross-reference the visuals + transcript text + cut times + beat times to build your profile. Be concrete:
  - shotComposition: name actual framings you see ("medium-close talking-head, centered, neutral background" beats "close-up shot")
  - cutOnBeat: compare shots[].startSec to beats.beatTimes[]. If most cuts land within ~0.25s of a beat, observed=true. Cite specific timestamps.
  - hookStructure.seconds0to3: describe literally what's on screen in the hook frames in the first 3 seconds.
  - captionStyle: scan keyframes for visible text overlays — describe font, position, animation pattern based on transcript word timing.
  - distinctiveTechniques: the signature moves an editor would copy. NOT generic — name what's actually here.

Filename keywords ("Luxury Clean Girl Makeup") are MISLEADING SEO bait — ignore them. Use what you see + hear.

STEP 5 — Call StructuredOutput with the profile.`

  return await agent(prompt, {
    label: `read:${dir.slice(-30)}`,
    phase: 'Read',
    schema: VIDEO_PROFILE_SCHEMA,
    agentType: 'general-purpose',
  })
}))

const validProfiles = profiles.filter(Boolean)
log(`${validProfiles.length}/${PREPROC_DIRS.length} profiles produced`)

if (validProfiles.length === 0) {
  return {error: 'no profiles produced'}
}

phase('Verify')

const verifyPrompt = `You are reviewing ${validProfiles.length} per-video editorial profiles for a "learn-the-edit-style" pipeline. Each profile claims things about pacing, hook, captions, B-roll, etc.

Stress-test as a SKEPTIC. For each profile, identify any claim that is:
- Inferred without visual evidence
- Contradicted by another profile in the set
- Vague to uselessness
- Likely hallucinated

PROFILES:
${JSON.stringify(validProfiles, null, 2)}

Return: {sustained, retracted, crossVideoConsensus}.`

const verdict = await agent(verifyPrompt, {
  label: 'verify:cross-video',
  phase: 'Verify',
  schema: {
    type: 'object',
    required: ['sustained', 'retracted', 'crossVideoConsensus'],
    properties: {
      sustained: {type: 'array', items: {type: 'string'}},
      retracted: {type: 'array', items: {
        type: 'object',
        properties: {claim: {type: 'string'}, reason: {type: 'string'}},
        required: ['claim', 'reason'],
      }},
      crossVideoConsensus: {type: 'array', items: {type: 'string'}},
    },
  },
})

phase('Synthesize')

const synthPrompt = `Merge ${validProfiles.length} per-video editorial profiles + the adversarial verdict into ONE editorial-style guide that an automated planner will use to drive Remotion + Hyperframes + Pexels.

PROFILES:
${JSON.stringify(validProfiles, null, 2)}

VERDICT (drop retracted, lean on sustained + consensus):
${JSON.stringify(verdict, null, 2)}

Output a synthesis where:
- pexelsKeywords are CONCRETE search terms ("warren buffett", "stock chart", "office building", not "luxury vibes")
- cuttingRules are mechanically applicable ("cut every 1.8-2.4s during voiceover, drop b-roll on every beat hit at >120bpm")
- hookFormula is a reusable template ("[bold text overlay states the hook] → [face/product reveal at 1.0s] → [voiceover begins at 1.5s]")`

const synthesis = await agent(synthPrompt, {
  label: 'synth:editorial-style',
  phase: 'Synthesize',
  schema: SYNTHESIS_SCHEMA,
})

return {
  perVideo: validProfiles,
  verdict,
  synthesis,
}
