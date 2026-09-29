// What a platform value is called on screen.
//
// Four of the five are proper names and stay as they are in every
// language — translating `ios` would make it harder to read, not
// easier. `unknown` is the exception: it is not a runtime, it is what
// the server writes when an SDK names a platform this build predates,
// and a bare English word sitting among Chinese and Japanese labels
// reads as a bug rather than as the fact it is.

import type { MessageKey } from '../i18n/en';

const NAMES: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  javascript: 'JavaScript',
  weapp: '微信小程序',
  web: 'Web',
};

type Translate = (key: MessageKey, params?: Record<string, string>) => string;

export function platformLabel(platform: string | null | undefined, t: Translate): string {
  if (!platform) return '—';
  if (platform === 'unknown') return t('platform.unknown');
  return NAMES[platform] ?? platform;
}
