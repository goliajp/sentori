import { describe, expect, it } from 'vitest'

import type { Frame } from '@/api/client'

import { roleOf } from './frame-role'

function frame(file: string, inApp: boolean): Frame {
  return { column: 0, file, function: 'fn', inApp, line: 1 }
}

describe('roleOf', () => {
  it('returns "you" for in-app frames', () => {
    expect(roleOf(frame('/proj/src/Foo.tsx', true))).toBe('you')
  })

  it('returns "framework" for react-native + react + expo cores', () => {
    expect(roleOf(frame('/proj/node_modules/react-native/Libraries/X.js', false))).toBe('framework')
    expect(roleOf(frame('/proj/node_modules/react/cjs/react.dev.js', false))).toBe('framework')
    expect(roleOf(frame('/proj/node_modules/expo-router/entry.js', false))).toBe('framework')
  })

  it('returns "framework" for @react-navigation/* scope', () => {
    expect(roleOf(frame('/proj/node_modules/@react-navigation/native/src/i.tsx', false))).toBe(
      'framework'
    )
  })

  it('returns "lib" for unrecognized node_modules', () => {
    expect(roleOf(frame('/proj/node_modules/lodash/get.js', false))).toBe('lib')
    expect(roleOf(frame('/proj/node_modules/@scope/pkg/index.js', false))).toBe('lib')
  })

  it('returns "unknown" for vendor frames with no recognized path shape', () => {
    expect(roleOf(frame('http://example.com/foo.js', false))).toBe('unknown')
    expect(roleOf(frame('/system/dyld', false))).toBe('unknown')
  })
})
