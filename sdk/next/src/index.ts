// Top-level entry point. Most callers should pull from the more
// specific subpaths instead — see exports map in package.json:
//
//   @goliapkg/sentori-next/client          — clientInit + React surface
//   @goliapkg/sentori-next/server          — serverInit + onRequestError
//   @goliapkg/sentori-next/instrumentation — drop-in register/onRequestError
//
// Re-exports below are kept thin so a default `import { ... } from
// '@goliapkg/sentori-next'` still works for the common cases.

export { clientInit } from './client.js'
export { serverInit, onRequestError } from './server.js'
export { resolveConfig } from './config.js'

export type { SentoriNextConfig } from './config.js'
export type { RequestErrorContext, RequestErrorRequest } from './server.js'

export {
  SentoriErrorBoundary,
  SentoriProvider,
  useCaptureError,
  useSentori,
} from '@goliapkg/sentori-react'
