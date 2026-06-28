import React, {useEffect, useState} from 'react';

export default function StyleRefs() {
  const [refs, setRefs] = useState(null);
  useEffect(() => {
    fetch('/api/style-refs').then((r) => r.json()).then(setRefs).catch(() => {});
  }, []);
  if (!refs) return null;
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-2">style memory</div>
      <div className="text-[11px] text-white/70 space-y-1">
        <div><span className="text-white/40">profile:</span> {refs.editorialProfile?.genre ?? '—'}</div>
        <div><span className="text-white/40">mood:</span> {refs.editorialProfile?.mood ?? '—'}</div>
        <div><span className="text-white/40">references:</span> {refs.referenceCount}</div>
      </div>
    </div>
  );
}
