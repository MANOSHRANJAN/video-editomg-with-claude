import React from 'react';

const PALETTE = [
  {name: 'orange', hex: '#FF6B35'},
  {name: 'white', hex: '#FFFFFF'},
  {name: 'navy', hex: '#0F1B2D'},
];

export default function EDLEditor({edl, onChange}) {
  if (!edl) {
    return (
      <div className="glass rounded-2xl p-4 h-full">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">edit list</div>
        <div className="text-xs text-white/40">brain hasn't run yet.</div>
      </div>
    );
  }
  const update = (next) => onChange({...edl, ...next});
  const setCaption = (i, patch) => {
    const captions = edl.captions.map((c, j) => j === i ? {...c, ...patch} : c);
    update({captions});
  };
  return (
    <div className="glass rounded-2xl p-4 h-full overflow-auto max-h-[88vh]">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/60">edit list</div>
        <div className="text-[10px] text-white/40">
          {edl.captions.length} captions · {edl.cuts.length} cuts · {edl.broll.length} b-roll
        </div>
      </div>
      <div className="space-y-2">
        {edl.captions.map((c, i) => (
          <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="text-white/40 font-mono">
                {c.startSec.toFixed(2)}s +{c.durationSec.toFixed(2)}s
              </div>
              <select
                value={c.position}
                onChange={(e) => setCaption(i, {position: e.target.value})}
                className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px]"
              >
                <option value="top">top</option>
                <option value="middle">middle</option>
                <option value="bottom">bottom</option>
              </select>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.tokens.map((t, ti) => (
                <span
                  key={ti}
                  className={`rounded px-1.5 py-0.5 font-display ${t.highlight ? 'bg-orange/20 text-orange ring-1 ring-orange' : 'bg-white/5 text-white/80'}`}
                >
                  {t.text}
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-white/40 text-[10px] uppercase tracking-wider">fill</span>
              {PALETTE.map((p) => (
                <button
                  key={p.hex}
                  onClick={() => setCaption(i, {fill: p.hex})}
                  className={`w-5 h-5 rounded-full border border-white/30 ${c.fill === p.hex ? 'ring-2 ring-white' : ''}`}
                  style={{background: p.hex}}
                  title={p.name}
                />
              ))}
              <span className="ml-auto text-white/40 text-[10px] uppercase tracking-wider">glass</span>
              <input
                type="range"
                min="0"
                max="60"
                value={c.glass.blurPx}
                onChange={(e) => setCaption(i, {glass: {...c.glass, blurPx: +e.target.value}})}
                className="w-16 accent-orange"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
