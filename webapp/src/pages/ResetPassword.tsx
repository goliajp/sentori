// Password-reset landing — the link in the reset email points
// here with ?token=…; the user picks a new password.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 12) {
      setErr('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.authResetPassword(token, password);
      setDone(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <form
        onSubmit={submit}
        className="w-96 rounded-lg border border-zinc-800 bg-zinc-900 p-6"
      >
        <h1 className="mb-1 text-xl font-semibold">Reset password</h1>
        <p className="mb-6 text-sm text-zinc-500">Sentori</p>
        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">
              Password updated — sign in with your new password.
            </p>
            <Link
              to="/login"
              className="block rounded bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <>
            {!token && (
              <p className="mb-3 text-xs text-red-400">
                Missing token — open the link from your email.
              </p>
            )}
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-zinc-400">
                New password (≥12 chars)
              </span>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-zinc-400">Confirm</span>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </label>
            {err && (
              <p className="mb-3 break-all text-xs text-red-400">{err}</p>
            )}
            <button
              type="submit"
              disabled={loading || !token}
              className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Set new password'}
            </button>
            <p className="mt-4 text-center text-xs text-zinc-500">
              <Link to="/login" className="hover:text-zinc-300">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
