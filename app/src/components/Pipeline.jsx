import React from 'react';

const ICONS = {
  start: '○',
  step: '◐',
  log: '·',
  edl: '✦',
  done: '●',
  error: '✕',
};
const COLORS = {
  start: 'text-white/60',
  step: 'text-orange',
  log: 'text-white/50',
  edl: 'text-orange',
  done: 'text-emerald-400',
  error: 'text-rose-400',
};

export default function Pipeline({events}) {
  return (
    <div className="glass rounded-2xl p-4 max-h-[42vh] overflow-auto">
      <div className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">pipeline</div>
      {events.length === 0 ? (
        <div className="text-xs text-white/40">waiting for a clip…</div>
      ) : (
        <ol className="space-y-1 text-xs font-mono">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className={`shrink-0 ${COLORS[e.kind] ?? 'text-white/40'}`}>{ICONS[e.kind] ?? '·'}</span>
              <span className={`break-words ${e.kind === 'error' ? 'text-rose-300' : 'text-white/80'}`}>
                {e.msg ?? e.phase ?? e.kind}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
