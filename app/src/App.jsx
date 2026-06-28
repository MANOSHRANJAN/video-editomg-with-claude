import React, {useEffect, useRef, useState} from 'react';
import DropZone from './components/DropZone.jsx';
import Pipeline from './components/Pipeline.jsx';
import EDLEditor from './components/EDLEditor.jsx';
import VideoPreview from './components/VideoPreview.jsx';
import StyleRefs from './components/StyleRefs.jsx';

export default function App() {
  const [job, setJob] = useState(null); // {id, stem, sourcePath}
  const [events, setEvents] = useState([]);
  const [edl, setEdl] = useState(null);
  const [output, setOutput] = useState(null);
  const evtSrcRef = useRef(null);

  // Subscribe to SSE for the active job.
  useEffect(() => {
    if (!job) return;
    const es = new EventSource(`/api/status/${job.id}`);
    evtSrcRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        setEvents((prev) => [...prev, msg]);
        if (msg.kind === 'edl' && msg.edl) setEdl(msg.edl);
        if (msg.kind === 'done' && msg.output) setOutput(msg.output);
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [job?.id]);

  async function handleIngest(file) {
    const form = new FormData();
    form.append('clip', file);
    const res = await fetch('/api/ingest', {method: 'POST', body: form});
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`ingest failed: ${err.error ?? res.statusText}`);
      return;
    }
    const j = await res.json();
    setJob(j);
    setEvents([]);
    setEdl(null);
    setOutput(null);
  }

  async function handleEdlUpdate(next) {
    setEdl(next);
    if (!job) return;
    await fetch(`/api/edl/${job.id}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({edl: next}),
    });
  }

  async function handleRender() {
    if (!job) return;
    setOutput(null);
    setEvents((prev) => [...prev, {kind: 'log', msg: 'render queued'}]);
    const res = await fetch(`/api/render/${job.id}`, {method: 'POST'});
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(`render failed: ${err.error ?? res.statusText}`);
    }
  }

  return (
    <div className="min-h-screen p-6 grid gap-6" style={{gridTemplateColumns: '320px 1fr 420px'}}>
      {/* LEFT — drop zone + pipeline progress + style refs */}
      <aside className="space-y-4">
        <header className="glass rounded-2xl p-4">
          <h1 className="text-xl font-black tracking-tight">
            <span className="text-orange">video</span>-edit
          </h1>
          <p className="text-xs text-white/60 mt-1">drop clip → brain → render</p>
        </header>
        <DropZone onIngest={handleIngest} disabled={job && !output && !events.find((e) => e.kind === 'error')} />
        <Pipeline events={events} />
        <StyleRefs />
      </aside>

      {/* CENTER — live preview + result player */}
      <main className="space-y-4">
        <VideoPreview job={job} edl={edl} output={output} onRender={handleRender} />
      </main>

      {/* RIGHT — EDL editor */}
      <aside className="space-y-4">
        <EDLEditor edl={edl} onChange={handleEdlUpdate} />
      </aside>
    </div>
  );
}
