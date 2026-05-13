import { describe, expect, it } from 'vitest'

import { packageOf } from './frame-package'

describe('packageOf', () => {
  it('extracts unscoped npm packages', () => {
    expect(packageOf('/Users/x/proj/node_modules/expo-router/entry.js')).toBe('expo-router')
    expect(packageOf('/abs/node_modules/lodash/get.js')).toBe('lodash')
  })

  it('extracts scoped npm packages', () => {
    expect(packageOf('/proj/node_modules/@react-navigation/native/src/index.tsx')).toBe(
      '@react-navigation/native'
    )
    expect(packageOf('/proj/node_modules/@scope/pkg/lib/index.js')).toBe('@scope/pkg')
  })

  it('detects React Native core across both common layouts', () => {
    expect(
      packageOf(
        '/Users/x/proj/node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-dev.js'
      )
    ).toBe('react-native')
    expect(packageOf('/proj/Libraries/react-native/Libraries/Pressability/Pressability.js')).toBe(
      'react-native'
    )
  })

  it('decodes percent-encoded Metro lazy-bundle URLs', () => {
    expect(
      packageOf('http://192.168.1.100:8081/node_modules%2Fexpo-router%2Fentry.bundle?platform=ios')
    ).toBe('expo-router')
  })

  it('returns null for user code + unrecognized paths', () => {
    expect(packageOf('/Users/x/proj/src/screens/Login.tsx')).toBe(null)
    expect(packageOf(null)).toBe(null)
    expect(packageOf(undefined)).toBe(null)
    expect(packageOf('')).toBe(null)
    expect(packageOf('http://example.com/foo.js')).toBe(null)
  })
})
