import { Link } from 'react-router'

import { AuthShell } from './login'

export function ForgotPasswordView() {
  return (
    <AuthShell title="Forgot password">
      <p className="text-fg-muted t-md">
        Password reset isn&apos;t exposed in this build yet. Contact your org admin or the system
        operator to reset your credentials.
      </p>
      <div className="text-fg-muted t-sm mt-4 text-center">
        <Link className="hover:text-fg" to="/login">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
