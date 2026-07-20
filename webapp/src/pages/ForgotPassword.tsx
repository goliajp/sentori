// Forgot password — calls /auth/forgot-password; the reset link
// arrives by email only.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSilent(false);
    setLoading(true);
    try {
      await api.authForgotPassword(email);
      setSilent(true);
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
        <h1 className="mb-1 text-xl font-semibold">Forgot password</h1>
        <p className="mb-6 text-sm text-zinc-500">
          We'll email you a password reset link.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-zinc-400">Email</span>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
        {err && (
          <p className="mb-3 text-xs text-red-400 break-all">{err}</p>
        )}
        {silent && (
          <p className="mb-3 text-xs text-zinc-300">
            If that email is registered, instructions have been sent.
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
        <div className="mt-4 text-center text-xs text-zinc-500">
          <Link to="/login" className="hover:text-zinc-300">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
