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
};
//# sourceMappingURL=types.d.ts.map