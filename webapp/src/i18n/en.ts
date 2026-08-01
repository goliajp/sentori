// English is the source of truth for the message catalogue.
//
// `Messages` is derived from this object, and the other locales are
// typed as `Messages` — so a key added here that is missing from
// zh.ts or ja.ts is a compile error, not a string that silently
// renders in the wrong language.
//
// Keys read `area.thing`. Keep them sorted; it makes a missing
// translation obvious in review.

export const en = {
  'auth.backToSignIn': 'Back to sign in',
  'auth.confirm': 'Confirm password',
  'auth.email': 'Email',
  'auth.forgot': 'Forgot password',
  'auth.forgotHint': 'Enter your email and we will send a reset link.',
  'auth.password': 'Password',
  'auth.passwordTooShort': 'Password must be at least 8 characters',
  'auth.passwordsDiffer': 'Passwords do not match',
  'auth.resetFailed': 'Reset failed — the link may have expired',
  'auth.resetPassword': 'Reset password',
  'auth.resetSent': 'If that address exists, a reset link is on its way',
  'auth.saving': 'Saving…',
  'auth.sendReset': 'Send reset link',
  'auth.sending': 'Sending…',
  'auth.setNewPassword': 'Set a new password',
  'auth.signIn': 'Sign in',
  'auth.signInFailed': 'Sign-in failed — check the email and password',
  'auth.signInTitle': 'Sign in to Sentori',
  'auth.signingIn': 'Signing in…',

  'common.delete': 'Delete',
  'common.retry': 'Retry',

  'inbox.emptyHint': 'Nothing to handle — events will group here as issues.',
  'inbox.emptyNoProject':
    'Create a project in Settings, mint an ingest token, and point the SDK at this instance.',
  'inbox.emptyTitle': 'Inbox zero',
  'inbox.group.ignored': 'Ignored',
  'inbox.group.open': 'Open',
  'inbox.group.resolved': 'Resolved',
  'inbox.groupNew': 'New (24h)',
  'inbox.groupRegressed': 'Regressed',
  'inbox.loadFailed': 'Could not load the inbox.',
  'inbox.pulse': 'today: {fresh} new · {regressed} regressed',
  'inbox.status.ignored': 'ignored',
  'inbox.status.open': 'open',
  'inbox.status.resolved': 'resolved',
  'inbox.selectedCount': '{n} selected',
  'inbox.clearSelection': 'Clear',

  'health.replay': 'replay',
  'health.silent': 'no events yet',

  'identity.copied': 'Copied',
  'identity.copyHint': 'Copy the full user key',

  'instruments.assertRan': 'ran {total} · failed {failed}',
  'instruments.asserts': 'Assertions',
  'instruments.assertsEmpty':
    'No production assertions yet — sentori.assert(name, ok) creates the liveness ledger.',
  'instruments.guardedIssue': 'guarded issue',
  'instruments.loadFailed': 'Could not load instruments.',
  'instruments.noProject': 'No project yet',
  'instruments.probeFired': 'fired {count}× · last {last}',
  'instruments.probeSilent': 'silent since {since} — fix holding',
  'instruments.probes': 'Probes',
  'instruments.probesEmpty':
    'No tripwires yet — plant sentori.probe(ref) in a fixed branch and register with `sentori-cli probes sync`.',
  'instruments.traces': 'Trace points',
  'instruments.tracesEmpty':
    'No observation points yet — sentori.trace(name) marks a code path as seen.',

  'issue.activity': 'Activity',
  'issue.code': 'Where it broke',
  'issue.addNote': 'Add note',
  'issue.assignee': 'Assignee',
  'issue.copied': 'Copied',
  'issue.copyForAi': 'Copy for AI',
  'issue.eventMoment': '{kind} fired',
  'issue.environment': 'Environment',
  'issue.firstSeen': 'first',
  'issue.guardAnchored':
    'Resolved in {release}. Only a recurrence in that release or newer reopens this.',
  'issue.guardProbeHint':
    'Plant sentori.probe(ref) in the fixed branch — a silent probe is proof the fix holds.',
  'issue.guardTitle': 'Guard status',
  'issue.handoff': 'Fix it',
  'issue.handoffHint':
    'One paste for your AI: the failing code, the journey, the environment.',
  'issue.guardUnanchored':
    'Resolved without a release anchor — any later recurrence reopens this.',
  'issue.ignore': 'Ignore',
  'issue.lastSeen': 'last',
  'issue.latestCase': 'latest',
  'issue.loadFailed': 'Could not load this issue.',
  'issue.noActivity': 'No activity yet',
  'issue.note': 'Note',
  'issue.occurrences': 'Occurrences',
  'issue.reopen': 'Reopen',
  'issue.replayFrom': 'From the occurrence {when} — the newest event carried no replay.',
  'issue.replayWireframe':
    'Wireframe replay — this build has replayScreens off, so no pixels were captured.',
  'issue.replayNone':
    'No visual replay came with this event — set replayScreens: true in the SDK to capture the minute before.',
  'issue.resolve': 'Resolve',
  'issue.resolveInRelease': 'Fixed in release',
  'issue.system': 'system',
  'issue.timeline': 'What the user was doing',
  'issue.unassigned': 'Unassigned',

  'nav.inbox': 'Inbox',
  'nav.instruments': 'Instruments',
  'nav.projects': 'Projects',
  'nav.releases': 'Releases',
  'nav.settings': 'Settings',

  'notify.loadFailed': 'Could not load notification preferences.',
  'notify.onNewIssue': 'new issue',
  'notify.onRegression': 'regression',
  'notify.prefsHint':
    'Per-project switches for your own inbox. Both on by default.',
  'notify.prefsTitle': 'Email me about',
  'notify.smtpTitle': 'SMTP',
  'notify.smtpUnconfigured':
    'SMTP is not configured — set SENTORI_SMTP_HOST to enable email notifications.',
  'notify.testButton': 'Send test email',
  'notify.testFailed': 'Test email failed — check the SMTP settings and server log.',
  'notify.testSending': 'Sending…',
  'notify.testSent': 'Test email sent — check your inbox.',
  'palette.placeholder': 'Jump to a page or search issues…',

  'projects.col.created': 'Created',
  'projects.col.lastEvent': 'Last event',
  'projects.col.name': 'Project',
  'projects.col.platform': 'Platform',
  'projects.col.release': 'Release in the field',
  'projects.col.users': 'Users',
  'projects.count': '{n} projects',

  'releases.emptyHint':
    'Releases appear when the SDK reports one or the CLI uploads artifacts.',
  'releases.emptyTitle': 'No releases yet',
  'releases.loadFailed': 'Could not load releases.',
  'replay.empty': 'No frames in this replay.',
  'replay.frameAlt': 'Replay frame at {t}s',
  'replay.loadFailed': 'Could not load the replay.',
  'replay.pause': 'Pause',
  'replay.play': 'Play',
  'replay.scrubber': 'Replay position',
  'replay.title': 'What the screen showed',
  'releases.noArtifacts':
    'No symbolication artifacts for this release — stacks stay minified until uploaded:',

  'settings.adminEmail': 'admin email',
  'settings.auditLoadFailed': 'Could not load the audit log.',
  'settings.changePassword': 'Change password',
  'settings.createAdmin': 'Create admin',
  'settings.createProject': 'Create',
  'settings.currentPassword': 'current password',
  'settings.deleteAdminConfirm': 'Delete admin {email}? Their sessions end immediately.',
  'settings.deleteProjectConfirm':
    'Delete project {name}? All its events and issues go with it.',
  'settings.initialPassword': 'initial password (8+ chars)',
  'settings.language': 'Language',
  'settings.mintToken': 'Mint',
  'settings.newPassword': 'new password (8+ chars)',
  'settings.projectName': 'project name',
  'settings.revoke': 'Revoke',
  'settings.revokeConfirm':
    'Revoke token {name}? Clients using it stop reporting immediately.',
  'settings.revoked': 'revoked',
  'settings.save': 'Save',
  'settings.saved': 'Saved',
  'settings.tab.account': 'Account',
  'settings.tab.audit': 'Audit',
  'settings.tab.notifications': 'Notifications',
  'settings.tab.tokens': 'Tokens',
  'settings.tab.users': 'Admins',
  'settings.tokenName': 'token name',
  'settings.tokenOnce': 'This token is shown exactly once — copy it now.',
  'settings.usersLoadFailed': 'Could not load admins.',
  'stack.libraryFrames': '{n} library frames',
  'stack.libraryFramesOpen': 'library frames',
  'stack.minified': 'minified',
  'stack.truncated': '… {n} more frames',

  'table.empty': 'Nothing here yet',

  'triage.pickHint': 'j/k move · Enter opens · ⌘K search',
  'triage.pickTitle': 'Pick an issue from the queue',

  'shell.loading': 'Loading…',

  'strip.events': 'events',
  'strip.frames': 'frames',
  'strip.signals': 'actions',
  'theme.dark': 'Dark',
  'theme.label': 'Theme',
  'theme.light': 'Light',
  'theme.system': 'Match system',
  'shell.roleAdmin': 'Admin',
  'shell.roleOwner': 'Owner',
} as const;

/** The shape every locale must satisfy in full. */
export type Messages = Record<keyof typeof en, string>;
export type MessageKey = keyof typeof en;
