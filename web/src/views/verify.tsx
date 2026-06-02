import { Link } from 'react-router'

import { AuthShell, FooterLinks } from './login'

export function VerifyView() {
  return (
    <AuthShell title="Verify your email">
      <p className="text-[13px] text-[color:var(--ink-soft)]">
        A verification link is on its way to your inbox. Click it to activate your account, then
        come back here to sign in.
      </p>
      <FooterLinks>
        <Link className="hover:text-[color:var(--accent)]" to="/login">
          back to sign in
        </Link>
      </FooterLinks>
    </AuthShell>
  )
}
