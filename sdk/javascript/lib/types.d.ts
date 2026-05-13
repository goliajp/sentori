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
    };
};
//# sourceMappingURL=types.d.ts.map