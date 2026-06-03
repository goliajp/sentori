/**
 * Wire-format types now live in `@goliapkg/sentori-core`. This file is
 * kept as a thin re-export so existing relative imports inside the
 * package continue to work. JS-specific extras (the `InitOptions`
 * shape with `enableGlobalHooks`) are declared here.
 */
export type { App, Breadcrumb, BreadcrumbType, CaptureExtras, Device, DeviceOS, Event, EventKind, Frame, Platform, SentoriError, Tags, User, } from '@goliapkg/sentori-core';
import type { CommonInitOptions } from '@goliapkg/sentori-core';
export type InitOptions = CommonInitOptions & {
    /** Override automatic global hooks. Default: true on browser + node. */
    enableGlobalHooks?: boolean;
    /** Phase 44 sub-B — client-side sampling rates `[0, 1]`. Absent /
     *  null → 1.0 (keep everything). `traces` is deterministic over
     *  traceId so all spans of a trace share the same decision. */
    sampling?: {
        errors?: null | number;
        traces?: null | number;
        /** v2.0 — sampling rate for `kind: 'message'` events emitted via
         *  `captureMessage`. Default 1.0 (keep all). */
        messages?: null | number;
    };
    /** Phase 46 — opt in to recording a session-trail buffer that
     *  uploads alongside the next `captureException`. */
    capture?: {
        sessionTrail?: boolean;
        /** v2.1 W2 — start the 30 s runtime-metrics flusher. Off by
         *  default in JS because the auto-instrument modules (FPS /
         *  heap / network bytes) are RN-only in 2.1.0; web hosts that
         *  want to push metrics today can flip this on and call
         *  `emitMetric()` directly. The transport pipe is identical
         *  to RN's so the dashboard treats both sources uniformly.
         *  Defaults to `false`. */
        runtimeMetrics?: boolean;
    };
};
//# sourceMappingURL=types.d.ts.map