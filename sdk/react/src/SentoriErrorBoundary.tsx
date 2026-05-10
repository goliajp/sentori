import { Component, type ErrorInfo, type ReactNode } from 'react'

import { useSentoriCtx } from './SentoriProvider.js'

type Props = {
  children: ReactNode
  /** Rendered after an error is caught. Receives the error and a
   *  `reset` callback that clears the boundary so retries can run. */
  fallback: (props: { error: Error; reset: () => void }) => ReactNode
  /** Optional additional logging hook. Runs after Sentori capture. */
  onError?: (error: Error, info: ErrorInfo) => void
}

type State = { error: Error | null }

/**
 * Wraps `<SentoriErrorBoundaryInner>` so we can grab the capture
 * function from context — class components can't use hooks directly,
 * but they CAN receive props from a thin functional wrapper.
 */
export function SentoriErrorBoundary(props: Props) {
  const { captureError } = useSentoriCtx()
  return (
    <SentoriErrorBoundaryInner
      {...props}
      capture={(err, info) => {
        captureError(err, { tags: { source: 'react.errorBoundary' } })
        props.onError?.(err, info)
      }}
    />
  )
}

class SentoriErrorBoundaryInner extends Component<
  Props & { capture: (e: Error, info: ErrorInfo) => void },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.capture(error, info)
  }

  reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset })
    }
    return this.props.children
  }
}
