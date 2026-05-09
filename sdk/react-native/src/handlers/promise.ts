import { captureError } from '../capture';

type RejectionTracker = (opts: {
  allRejections: boolean;
  onUnhandled: (id: number, rejection: unknown) => void;
}) => void;

type HermesInternalLike = {
  enablePromiseRejectionTracker?: RejectionTracker;
};

let _installed = false;

export const installPromiseHandler = (): void => {
  if (_installed) return;

  const hermes = (globalThis as { HermesInternal?: HermesInternalLike })
    .HermesInternal;
  if (hermes?.enablePromiseRejectionTracker) {
    _installed = true;
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        try {
          const err =
            rejection instanceof Error ? rejection : new Error(String(rejection));
          captureError(err);
        } catch {
          // never throw
        }
      },
    });
    return;
  }

  // No-op fallback: on JSC or older Hermes the SDK can't track rejections
  // without a polyfill. Users targeting these can call `captureError(err)` manually.
};
