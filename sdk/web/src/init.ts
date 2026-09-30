// One call, and the page is reporting.
//
// Everything `init` installs is either passive (observers the browser
// is already filling) or additive (`addEventListener`, never an
// assignment to `window.onerror`). Nothing here replaces something the
// host already had, and nothing throws: a browser missing any of these
// APIs gets the rest.

import { safeFn, setInternalReporter, setLogLevel } from '@goliapkg/sentori-core'

import { getConfig, setConfig, type WebInitConfig } from './config.js'
import { installBreadcrumbs } from './handlers/breadcrumbs.js'
import { installNetworkSignals } from './handlers/network.js'
import { installUncaughtHandlers } from './handlers/uncaught.js'
import { installWebVitals } from './handlers/web-vitals.js'
import { startSession } from './sessions.js'
import { drainOfflineQueue, startTransport } from './transport.js'
import { internalFault } from './verbs.js'

let _initialized = false

export const init = safeFn('init', (config: WebInitConfig): void => {
  // Calling `init` twice is a mistake, not a reconfiguration — a
  // second set of listeners would double every event.
  if (_initialized) return
  _initialized = true

  setConfig({
    token: config.token,
    ingestUrl: config.ingestUrl.replace(/\/+$/, ''),
    release: config.release ?? '',
    environment: config.environment ?? 'production',
    enabled: true,
    backendHealthUrl: config.backendHealthUrl,
    beforeSend: config.beforeSend,
    detect: {
      uncaught: config.detect?.uncaught !== false,
      webVitals: config.detect?.webVitals !== false,
      breadcrumbs: config.detect?.breadcrumbs !== false,
    },
    replaySeconds: config.replaySeconds ?? 30,
    replayScreens: config.replayScreens ?? false,
  })
  setLogLevel(config.logLevel ?? 'warn')
  setInternalReporter(internalFault)

  startTransport()

  const resolved = getConfig()
  if (!resolved) return
  if (resolved.detect.uncaught) installUncaughtHandlers()
  if (resolved.detect.breadcrumbs) {
    installBreadcrumbs()
    installNetworkSignals(resolved.ingestUrl)
  }
  if (resolved.detect.webVitals) installWebVitals()

  startSession({
    environment: resolved.environment,
    platform: 'web',
    release: resolved.release,
    userId: null,
  })

  // Whatever a previous page view could not send.
  void drainOfflineQueue()
})

export const __resetForTests = (): void => {
  _initialized = false
}
