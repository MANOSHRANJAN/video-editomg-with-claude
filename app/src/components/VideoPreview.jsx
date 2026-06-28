import React from 'react';

export default function VideoPreview({job, edl, output, onRender}) {
  if (!job) {
    return (
      <div className="glass rounded-2xl p-12 text-center">
        <div className="text-5xl mb-4 text-white/20">⬡</div>
        <div className="text-white/70">drop a clip on the left to begin</div>
        <div className="text-xs text-white/40 mt-2">
          whisper → claude brain → hyperframes → mp4
        </div>
      </div>
    );
  }
  const sourceUrl = `/media/source/${job.id}`;
  const outUrl = output ? `/media/out/${job.id}` : null;
  return (
    <>
      <div className="glass rounded-2xl p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-white/60">{output ? 'final cut' : 'source'}</div>
            <div className="text-white/80 font-mono text-xs mt-0.5">{job.stem}.mp4</div>
          </div>
          <button
            disabled={!edl}
            onClick={onRender}
            className="px-4 py-2 rounded-xl bg-orange text-navy font-black uppercase tracking-wider text-xs disabled:opacity-40"
          >
            {output ? 'rerender' : 'render mp4'}
          </button>
        </div>
        <div className="rounded-2xl overflow-hidden border border-white/10 aspect-[9/16] max-h-[78vh] mx-auto" style={{maxWidth: 'calc(78vh * 9 / 16)'}}>
          <video
            key={outUrl ?? sourceUrl}
            src={outUrl ?? sourceUrl}
            controls
            className="w-full h-full object-cover bg-black"
          />
        </div>
      </div>
      {edl && !output && (
        <div className="glass rounded-2xl p-4 text-xs text-white/70">
          <span className="text-orange font-semibold">EDL ready.</span>{' '}
          Tweak captions on the right, then hit render. Changes to the EDL stream straight into the renderer.
        </div>
      )}
    </>
  );
}
