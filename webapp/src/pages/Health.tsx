import { useEffect, useState } from 'react';
import { api, HealthResponse } from '../lib/api';

export function HealthPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stamp, setStamp] = useState<string>(new Date().toLocaleTimeString());

  function refresh() {
    setStamp(new Date().toLocaleTimeString());
    api.health().then(setHealth).catch((e: unknown) => setErr(String(e)));
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Health</h2>
          <p className="text-xs text-zinc-500">last refresh: {stamp}</p>
        </div>
        <button
          onClick={refresh}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        >
          Refresh
        </button>
      </div>
      {err && (
        <div className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          {err}
        </div>
      )}
      {health && (
        <pre className="rounded border border-zinc-800 bg-zinc-900 p-4 text-xs font-mono text-zinc-300">
          {JSON.stringify(health, null, 2)}
        </pre>
      )}
    </div>
  );
}
