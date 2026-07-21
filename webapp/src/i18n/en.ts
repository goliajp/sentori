// English is the source of truth for the message catalogue.
//
// `Messages` is derived from this object, and the other locales are
// typed as `Messages` — so a key added here that is missing from
// zh.ts or ja.ts is a compile error, not a string that silently
// renders in the wrong language. That is the whole reason this is a
// typed object rather than a runtime i18n library with fallbacks.
//
// Keys read `area.thing`. Keep them sorted; it makes a missing
// translation obvious in review.

export const en = {
  'action.cancel': 'Cancel',
  'action.copy': 'Copy',
  'action.create': 'Create',
  'action.delete': 'Delete',
  'action.dismiss': 'Dismiss',
  'action.refresh': 'Refresh',
  'action.retry': 'Retry',
  'action.save': 'Save',
  'action.signOut': 'Sign out',

  'common.error': 'Something went wrong',
  'common.loading': 'Loading…',
  'common.none': 'None',
  'common.search': 'Search',

  'crash.artefacts': 'Captured artefacts',
  'crash.causedBy': 'caused by',
  'crash.context': 'Context',
  'crash.crash': 'crash',
  'crash.device': 'Device',
  'crash.emptyRecording': 'The recording is empty.',
  'crash.framesHidden': 'frames outside your code',
  'crash.loadFailed': 'This recording could not be loaded',
  'crash.loadingRecording': 'Loading recording…',
  'crash.message': 'Message',
  'crash.noContext': 'This SDK sent no device or release context.',
  'crash.noEvent': 'No event has been collected for this issue yet.',
  'crash.pause': 'Pause',
  'crash.play': 'Play',
  'crash.recordingPosition': 'Recording position',
  'crash.release': 'Release',
  'crash.sharedPlayhead': 'recording and log share a playhead',
  'crash.stack': 'Stack',
  'crash.step': 'step',
  'crash.steps': 'steps',
  'crash.tags': 'Tags',
  'crash.timeline': 'Before the crash',
  'crash.user': 'User',

  'nav.alerts': 'Alerts',
  'nav.audit': 'Audit',
  'nav.billing': 'Billing',
  'nav.cert': 'Cert monitor',
  'nav.events': 'Events',
  'nav.health': 'Health',
  'nav.inbox': 'Inbox',
  'nav.integrations': 'Integrations',
  'nav.issues': 'Issues',
  'nav.members': 'Members',
  'nav.metrics': 'Metrics',
  'nav.overview': 'Overview',
  'nav.probes': 'Endpoint probes',
  'nav.projects': 'Projects',
  'nav.push': 'Push',
  'nav.releases': 'Releases',
  'nav.replays': 'Replays',
  'nav.saasAdmin': 'SaaS admin',
  'nav.savedViews': 'Saved views',
  'nav.search': 'Search',
  'nav.sectionProject': 'Project',
  'nav.sectionWorkspace': 'Workspace',
  'nav.settings': 'Settings',
  'nav.tokens': 'Tokens',
  'nav.traces': 'Traces',

  'prefs.language': 'Language',
  'prefs.theme': 'Theme',
  'prefs.themeDark': 'Dark',
  'prefs.themeLight': 'Light',
  'prefs.themeSystem': 'System',
} as const;

/** The shape every locale must satisfy in full. */
export type Messages = Record<keyof typeof en, string>;
export type MessageKey = keyof typeof en;
