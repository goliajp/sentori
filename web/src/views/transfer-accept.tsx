import { useParams } from 'react-router'

import { AuthShell } from './login'

export function TransferAcceptView() {
  const { token } = useParams<{ token: string }>()
  return (
    <AuthShell title="Accept transfer">
      <p className="text-fg-muted t-md">
        Transfer acceptance for token <span className="font-mono">{token}</span> isn&apos;t wired in
        v2 yet — talk to your admin to complete the transfer manually.
      </p>
    </AuthShell>
  )
}
