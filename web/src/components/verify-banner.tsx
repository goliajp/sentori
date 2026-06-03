import { useState } from 'react'
import { Link } from 'react-router'

import { useAuth } from '@/auth/state'

/**
 * Top-of-page banner shown when the signed-in user hasn't verified
 * their email yet. GitHub-style: warning-toned strip with a CTA to
 * resend the verification link.
 *
 * Hidden when:
 *   - not authed
 *   - email_verified === true
 *   - user closed the banner this session
 *   - user signed in via OAuth (provider already vouched for the email)
 */
export function VerifyBanner() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  if (!user || dismissed) return null
  if (user.emailVerified) return null
  if (user.oauthProvider) return null

  return (
    <div className="border-warning bg-warning/15 text-warning flex items-center justify-between gap-3 border-b px-4 py-1.5 text-[12px]">
      <span>
        <strong className="font-medium">Verify your email</strong> ·{' '}
        <span className="opacity-90">
          we sent a link to <span className="font-mono">{user.email}</span>. Check your inbox to
          unlock everything.
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3 font-mono text-[10px] tracking-[0.18em] uppercase">
        <Link className="hover:text-fg" to={`/verify?resend=${encodeURIComponent(user.email)}`}>
          resend →
        </Link>
        <button
          aria-label="Dismiss verification banner"
          className="text-warning hover:text-fg"
          onClick={() => setDismissed(true)}
          type="button"
        >
          ✕
        </button>
      </span>
    </div>
  )
}
