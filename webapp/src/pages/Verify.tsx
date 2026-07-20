// Email-verification landing — the link in the verification
// email points here with ?token=…; we consume it immediately.

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../lib/api';

export default function Verify() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [err, setErr] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (!token) {
      setErr('Missing token — open the link from your email.');
      setState('error');
      return;
    }
    api
      .authVerify(token)
      .then(() => setState('ok'))
      .catch(e => {
        setErr(String(e));
        setState('error');
      });
  }, [token]);

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="w-96 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="mb-1 text-xl font-semibold">Verify email</h1>
        <p className="mb-6 text-sm text-zinc-500">Sentori</p>
        {state === 'working' && (
          <p className="text-sm text-zinc-300">Verifying…</p>
        )}
        {state === 'ok' && (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">
              Email verified — your account is active.
            </p>
            <Link
              to="/login"
              className="block rounded bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
            >
              Sign in
            </Link>
          </div>
        )}
        {state === 'error' && (
          <div className="space-y-3">
            <p className="break-all text-xs text-red-400">{err}</p>
            <p className="text-xs text-zinc-500">
              The link may have expired. Sign up again or request a
              new verification email.
            </p>
            <Link
              to="/login"
              className="block rounded border border-zinc-700 px-3 py-2 text-center text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
