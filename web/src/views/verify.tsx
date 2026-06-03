import { Link } from 'react-router'

import { AuthShell, FooterLinks } from './login'

export function VerifyView() {
  return (
    <AuthShell title="Verify your email">
      <p className="text-fg-secondary text-[13px]">
        A verification link is on its way to your inbox. Click it to activate your account, then
        come back here to sign in.
      </p>
      <FooterLinks>
        <Link className="hover:text-accent" to="/login">
          back to sign in
        </Link>
      </FooterLinks>
    </AuthShell>
  )
}
