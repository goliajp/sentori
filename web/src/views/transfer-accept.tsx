import { useParams } from 'react-router'

import { AuthShell } from './login'

export function TransferAcceptView() {
  const { token } = useParams<{ token: string }>()
  return (
    <AuthShell title="Accept transfer">
      <p className="text-[13px] text-[color:var(--ink-soft)]">
        Transfer acceptance for token{' '}
        <span className="font-mono text-[color:var(--ink)]">{token}</span> isn&apos;t wired in v2
        yet — ask your admin to complete the transfer manually.
      </p>
    </AuthShell>
  )
}
