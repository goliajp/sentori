import type { Breadcrumb, BreadcrumbType } from './types.js';
export type AddBreadcrumbInput = {
    data?: Record<string, unknown>;
    type: BreadcrumbType;
};
export declare function addBreadcrumb(input: AddBreadcrumbInput): void;
export declare function getBreadcrumbs(): Breadcrumb[];
export declare function clearBreadcrumbs(): void;
//# sourceMappingURL=breadcrumbs.d.ts.map