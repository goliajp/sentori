import { useParams } from 'react-router'

import { AuthShell } from './login'

export function TransferAcceptView() {
  const { token } = useParams<{ token: string }>()
  return (
    <AuthShell title="Accept transfer">
      <p className="text-fg-secondary text-[13px]">
        Transfer acceptance for token <span className="text-fg font-mono">{token}</span> isn&apos;t
        wired in v2 yet — ask your admin to complete the transfer manually.
      </p>
    </AuthShell>
  )
}
