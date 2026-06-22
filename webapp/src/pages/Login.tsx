import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

/// Login page — v0.1 skeleton. Real auth lands once the K2
/// auth-session HTTP middleware is wired into the
/// self-hosted server. Until then this is a UI shell only.
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    // Stub: in v0.1.x once /v1/auth/login lands, this will
    // call api.login(email, password). For now just route
    // to /projects (the dashboard is anonymous-readable in
    // the skeleton).
    if (!email || !password) {
      setErr('email + password required');
      return;
    }
    navigate('/projects');
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={handleSubmit}
        className="w-80 rounded-lg border border-zinc-800 bg-zinc-900 p-6"
      >
        <h1 className="mb-1 text-xl font-semibold">Sign in to Sentori</h1>
        <p className="mb-6 text-sm text-zinc-500">
          v0.1 skeleton — full auth lands next.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-zinc-400">Email</span>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-zinc-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
        {err && (
          <p className="mb-3 text-sm text-red-400">{err}</p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
