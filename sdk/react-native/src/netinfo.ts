// v0.8.0-c — cached read of the current network class.
//
// `@react-native-community/netinfo` is an OPTIONAL peer dep. If the
// host app has it installed (most production RN apps do — it's a
// standard library), we subscribe at SDK init time and cache the
// latest network state. `collectDevice()` reads the cache
// synchronously at capture time. If the peer isn't installed, the
// cache stays `undefined` and `device.networkType` is omitted —
// no warning, no crash.
//
// We collapse NetInfo's enum into the smaller set the protocol
// allows (see `Device.networkType` in `sdk/core/src/types.ts`):
// `wifi`, `2g/3g/4g/slow-2g`, `offline`, `unknown`. 5G collapses
// into `4g` because the schema doesn't have a 5g slot yet; the
// information loss is acceptable for an analytics dimension.

import type { Device } from '@goliapkg/sentori-core';

type NetworkType = Device['networkType'];

type NetInfoState = {
  details?: { cellularGeneration?: null | string };
  isConnected?: boolean | null;
  type?: string;
};

type NetInfoModule = {
  addEventListener?: (cb: (state: NetInfoState) => void) => () => void;
  default?: { addEventListener?: (cb: (state: NetInfoState) => void) => () => void };
};

let _cached: NetworkType;
let _started = false;
let _unsubscribe: (() => void) | null = null;

function mapState(state: NetInfoState): NetworkType {
  if (state.isConnected === false) return 'offline';
  if (state.type === 'wifi' || state.type === 'ethernet') return 'wifi';
  if (state.type === 'cellular') {
    const gen = state.details?.cellularGeneration;
    if (gen === '2g' || gen === '3g' || gen === '4g') return gen;
    if (gen === '5g') return '4g';
    return 'unknown';
  }
  if (state.type === 'none' || state.type === 'unknown') return 'unknown';
  return undefined;
}

/**
 * Idempotent — subscribe to NetInfo state changes and cache the
 * latest network class. Called once from `init()`. Pure no-op if
 * the peer isn't installed or we're not in an RN runtime.
 */
export function startNetworkTypeWatch(): void {
  if (_started) return;
  _started = true;
  try {
    // v0.8.4 hotfix — when the host has `@react-native-community/netinfo`
    // in package.json but the *native* module isn't linked (Expo Go,
    // pod install never ran, RN autolink turned off, etc.) the JS
    // package still imports fine but calling addEventListener throws
    // "NativeModule.RNCNetInfo is null" from inside the lib's async
    // emitter — past where this try/catch can reach. Gate on the
    // NativeModules entry first so we no-op cleanly in that case.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require('react-native') as {
      NativeModules?: Record<string, unknown>;
    };
    const native = RN.NativeModules?.RNCNetInfo;
    if (native == null) {
      // JS package present but native module isn't linked. Skip.
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/netinfo') as NetInfoModule;
    const add = mod.addEventListener ?? mod.default?.addEventListener;
    if (typeof add !== 'function') return;
    _unsubscribe = add((state) => {
      _cached = mapState(state);
    });
  } catch {
    // not installed / linked / something else broke — leave cache undefined
  }
}

/** Synchronous read at capture time. */
export function getCachedNetworkType(): NetworkType {
  return _cached;
}

/** Test-only. */
export function __resetNetworkTypeForTests(): void {
  _unsubscribe?.();
  _unsubscribe = null;
  _started = false;
  _cached = undefined;
}
