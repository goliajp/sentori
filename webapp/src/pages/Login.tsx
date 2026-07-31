// Sign-in — the only public entrance. No self-signup, no OAuth
// (design.md §9): accounts come from the owner or the env bootstrap.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useT } from '../i18n';
import { api } from '../lib/api';

export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFailed(false);
    try {
      await api.login(email, password);
      const returnTo = sessionStorage.getItem('sentori_return_to');
      sessionStorage.removeItem('sentori_return_to');
      navigate(returnTo && returnTo.startsWith('/') ? returnTo : '/');
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-6"
      >
        <h1 className="mb-1 text-xl font-semibold">{t('auth.signInTitle')}</h1>
        <p className="mb-5 font-mono text-xs opacity-40">sentori</p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block opacity-60">{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1.5"
          />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block opacity-60">{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1.5"
          />
        </label>

        {failed && (
          <p className="mb-3 text-xs text-[#ff5d5d]">{t('auth.signInFailed')}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-[var(--gds-accent,#4c8dff)] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
        >
          {loading ? t('auth.signingIn') : t('auth.signIn')}
        </button>

        <div className="mt-4 text-center text-xs opacity-50">
          <Link to="/forgot-password" className="hover:opacity-100">
            {t('auth.forgot')}
          </Link>
        </div>
      </form>
    </div>
  );
}
