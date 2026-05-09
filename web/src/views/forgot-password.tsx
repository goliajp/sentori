import { Link } from 'react-router'

export function ForgotPasswordView() {
  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <div className="border-border bg-bg w-96 space-y-3 rounded-lg border p-6">
        <h1 className="text-fg text-lg font-semibold">Forgot password</h1>
        <p className="text-fg-muted text-sm leading-relaxed">
          Self-serve password reset isn't wired up yet. For now, ask the org owner to invite a new
          email and recreate the account, or contact your self-host admin.
        </p>
        <Link className="text-accent text-sm hover:underline" to="/login">
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
