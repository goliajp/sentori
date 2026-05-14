/**
 * Phase 45 sub-B — Vue 3 adapter for Sentori.
 *
 * Plugin shape:
 *
 *     import { createApp } from 'vue'
 *     import sentori from '@goliapkg/sentori-vue'
 *
 *     const app = createApp(App)
 *     app.use(sentori, {
 *       token: 'st_pk_…',
 *       release: 'myapp@1.0.0',
 *       sampling: { errors: 1.0 },
 *     })
 *
 * What `app.use(sentori, opts)` does:
 *   1. forwards `opts` to `@goliapkg/sentori-javascript`'s init
 *   2. wires `app.config.errorHandler` so any error thrown inside
 *      a render / lifecycle bubbles into `captureException`
 *   3. tags every Sentori event with `tags.vue.version` so the
 *      dashboard knows which framework is producing the data
 *
 * Router integration (Vue Router) lives in the `/router` subpath:
 *
 *     import { setupTraceNavigation } from '@goliapkg/sentori-vue/router'
 *     setupTraceNavigation(router)
 */

import type { App, Plugin } from 'vue'
import { coerceError } from '@goliapkg/sentori-core'
import {
  captureException as captureExceptionJs,
  initSentori as initSentoriJs,
  type InitOptions,
} from '@goliapkg/sentori-javascript'

export type SentoriVueOptions = InitOptions

const plugin: Plugin = {
  install(app: App, options: SentoriVueOptions) {
    // 1. init the core JS SDK.
    initSentoriJs(options)

    // 2. Vue's global error handler. Sentori captureException
    //    accepts an Error; Vue's handler receives `unknown`. Wrap
    //    non-Error values so the SDK still gets a stack.
    const previous = app.config.errorHandler
    app.config.errorHandler = (err, instance, info) => {
      // `coerceError` JSON-stringifies plain-object throws — Vue's
      // errorHandler regularly sees non-Error values from user code
      // (`throw {code: 'auth/expired'}`). Without it those collapse to
      // the literal text `[object Object]` in the dashboard.
      const e = coerceError(err)
      captureExceptionJs(e, {
        tags: {
          'vue.component': instance?.$options?.name ?? '<anonymous>',
          'vue.errorInfo': info,
        },
      })
      // Chain to any previously installed handler so plugins layer.
      if (previous) previous(err, instance, info)
    }
  },
}

export default plugin
export { plugin as sentori }

export {
  addBreadcrumb,
  captureException,
  captureException as captureError,
  captureStep,
  getUser,
  setUser,
} from '@goliapkg/sentori-javascript'

export { SentoriErrorBoundary } from './ErrorBoundary.js'
