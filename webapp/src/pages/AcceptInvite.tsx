import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../lib/api';

/// Landing page for an invite link (`/invite?token=…`). The logged-in
/// visitor joins the token's workspace; a not-logged-in visitor is
/// pointed at login/register first (the token is preserved in the URL
/// so reopening the link after auth completes the join).
type State =
  | { kind: 'working' }
  | { kind: 'joined'; workspace_id: string; role: string }
  | { kind: 'need_auth' }
  | { kind: 'error'; message: string };

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  // Derive the no-token error state at init rather than via a
  // synchronous setState in the effect (which cascades renders).
  const [state, setState] = useState<State>(() =>
    token ? { kind: 'working' } : { kind: 'error', message: 'Missing invite token.' },
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // Confirm there's a session first: accepting needs one, and a
    // bare accept call would bounce through the global 401 redirect
    // and lose the token.
    api
      .authMe()
      .then(() => api.acceptInvite(token))
      .then(r => {
        if (!cancelled) {
          setState({
            kind: 'joined',
            workspace_id: r.workspace_id,
            role: r.role,
          });
        }
      })
      .catch(e => {
        if (cancelled) return;
        const msg = String(e);
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          setState({ kind: 'need_auth' });
        } else {
          setState({ kind: 'error', message: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">Workspace invite</h1>

        {state.kind === 'working' && (
          <p className="mt-4 text-sm text-zinc-400">Accepting invite…</p>
        )}

        {state.kind === 'joined' && (
          <>
            <p className="mt-4 text-sm text-zinc-300">
              You've joined the workspace as{' '}
              <span className="font-medium text-emerald-400">{state.role}</span>.
            </p>
            <Link
              to="/main"
              onClick={() => {
                // Land in the freshly-joined workspace's dashboard.
              }}
              className="mt-5 inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Go to dashboard
            </Link>
          </>
        )}

        {state.kind === 'need_auth' && (
          <>
            <p className="mt-4 text-sm text-zinc-400">
              Log in or create an account first, then reopen this invite
              link to join.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Link
                to="/login"
                className="rounded bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
              >
                Log in
              </Link>
              <Link
                to="/register"
                className="rounded border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-600"
              >
                Sign up
              </Link>
            </div>
          </>
        )}

        {state.kind === 'error' && (
          <p className="mt-4 text-sm text-rose-400">{state.message}</p>
        )}
      </div>
    </div>
  );
}
