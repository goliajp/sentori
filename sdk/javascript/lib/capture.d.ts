import { type TrailStep } from '@goliapkg/sentori-core';
import type { CaptureExtras, User } from './types.js';
/**
 * Phase 46 — record a step into the session-trail buffer. The buffer
 * is a fixed-size FIFO; pushing past capacity drops the oldest.
 * Uploaded as a `sessionTrail` attachment on the next
 * `captureException` only when `init({ capture: { sessionTrail:
 * true } })` is on.
 */
export declare function captureStep(label: string, opts?: Partial<TrailStep>): void;
export declare function __resetTrailForTests(): void;
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