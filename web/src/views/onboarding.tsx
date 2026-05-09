import { useAuth } from '@/auth/state'

/**
 * Phase 13 sub-F: stub — Phase 13 sub-H replaces this with the auto
 * personal-org flow, and Phase 14 turns it into the full SaaS wizard
 * (project create + token reveal + first event poll).
 */
export function OnboardingView() {
  const { logout, user } = useAuth()
  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <div className="border-border bg-bg w-[28rem] space-y-3 rounded-lg border p-6">
        <h1 className="text-fg text-lg font-semibold">Welcome to Sentori</h1>
        <p className="text-fg-muted text-sm leading-relaxed">
          Signed in as <span className="text-fg font-mono">{user?.email}</span>. You aren't a member
          of any organization yet. The onboarding wizard is wired up in a later phase — for now an
          admin can invite you to an existing org.
        </p>
        <button
          className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-3 py-1.5 text-sm"
          onClick={() => void logout()}
          type="button"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
