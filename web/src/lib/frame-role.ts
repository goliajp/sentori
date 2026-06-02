import type { Frame } from '@/api/client'

import { packageOf } from './frame-package'

/**
 * Phase 42 sub-A.09 — assign a role to a stack frame for badge /
 * colour coding in the stack viewer.
 *
 *   you        — application code (`frame.inApp === true`)
 *   framework  — React Native, React, Expo, React Navigation, etc.
 *                — "platform glue" that's almost always uninteresting
 *   lib        — any other `node_modules` package
 *   boundary   — async / event-handler boundary (Promise.then, setTimeout,
 *                event dispatch). Phase 42 sub-A4 — not detected yet.
 *   unknown    — vendor frame the heuristic can't place; treated as `lib`
 *                in the UI but kept distinct so we can iterate the rules.
 */
export type FrameRole = 'boundary' | 'framework' | 'lib' | 'unknown' | 'you'

const FRAMEWORK_PACKAGES = new Set<string>([
  'react',
  'react-dom',
  'react-native',
  'react-native-web',
  'expo',
  'expo-router',
  '@expo/vector-icons',
])

const FRAMEWORK_SCOPES = ['@react-navigation/', '@expo/', '@react-native/']

export function roleOf(frame: Frame): FrameRole {
  if (frame.inApp) return 'you'
  const pkg = packageOf(frame.file)
  if (pkg) {
    if (FRAMEWORK_PACKAGES.has(pkg)) return 'framework'
    if (FRAMEWORK_SCOPES.some((s) => pkg.startsWith(s))) return 'framework'
    return 'lib'
  }
  return 'unknown'
}
