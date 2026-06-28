import React, {useCallback, useState} from 'react';

export default function DropZone({onIngest, disabled}) {
  const [over, setOver] = useState(false);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) onIngest(file);
  }, [disabled, onIngest]);
  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) onIngest(file);
  };
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`glass block rounded-2xl p-6 text-center cursor-pointer transition ${over ? 'ring-2 ring-orange' : ''} ${disabled ? 'opacity-60 pointer-events-none' : 'hover:ring-1 hover:ring-white/30'}`}
    >
      <div className="text-orange text-4xl mb-2">↓</div>
      <div className="text-sm font-semibold">{disabled ? 'pipeline running…' : 'drop a clip'}</div>
      <div className="text-xs text-white/50 mt-1">or click to pick</div>
      <input type="file" accept="video/*" className="hidden" onChange={onPick} disabled={disabled} />
    </label>
  );
}
