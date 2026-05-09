import type { CaptureExtras, User } from './types.js';
/**
 * Attach a stable user identifier to events captured after this call.
 *
 * PII policy: User shape is `{ id?, anonymous? }` only — no email,
 * name, IP, or other identifying fields. The server schema enforces
 * the same shape; extras would be rejected with `validationFailed`.
 */
export declare function setUser(user: User | null): void;
export declare function getUser(): User | null;
export declare function captureError(error: Error, extras?: CaptureExtras): void;
export declare const captureException: typeof captureError;
//# sourceMappingURL=capture.d.ts.map