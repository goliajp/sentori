import { Link } from 'react-router'

import { AuthShell } from './login'

export function VerifyView() {
  return (
    <AuthShell title="Verify your email">
      <p className="text-fg-muted t-md">
        We sent a verification link to your email. Click it to activate your account, then come back
        here to sign in.
      </p>
      <div className="text-fg-muted t-sm mt-4 text-center">
        <Link className="hover:text-fg" to="/login">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
