import { describe, expect, it } from 'vitest'

import { frameToSourceUrl } from './source-link'

describe('frameToSourceUrl', () => {
  const repo = 'https://github.com/goliajp/sentori'

  it('builds a GitHub blob URL for an in-app frame', () => {
    expect(
      frameToSourceUrl({
        file: '/Users/x/proj/src/screens/Login.tsx',
        line: 42,
        sourceRepoUrl: repo,
      })
    ).toBe('https://github.com/goliajp/sentori/blob/main/src/screens/Login.tsx#L42')
  })

  it('respects an explicit ref', () => {
    expect(
      frameToSourceUrl({
        file: 'src/foo.ts',
        line: 1,
        ref: 'abc123',
        sourceRepoUrl: repo,
      })
    ).toBe('https://github.com/goliajp/sentori/blob/abc123/src/foo.ts#L1')
  })

  it('returns null without a configured repo', () => {
    expect(
      frameToSourceUrl({
        file: 'src/foo.ts',
        line: 1,
        sourceRepoUrl: null,
      })
    ).toBe(null)
    expect(
      frameToSourceUrl({
        file: 'src/foo.ts',
        line: 1,
        sourceRepoUrl: undefined,
      })
    ).toBe(null)
  })

  it('returns null for node_modules + bundle-URL frames', () => {
    expect(
      frameToSourceUrl({
        file: '/proj/node_modules/react-native/Libraries/X.js',
        line: 1,
        sourceRepoUrl: repo,
      })
    ).toBe(null)
    expect(
      frameToSourceUrl({
        file: 'http://192.168.1.100:8081/index.bundle?platform=ios',
        line: 1,
        sourceRepoUrl: repo,
      })
    ).toBe(null)
  })

  it('returns null when no repo-prefix root is detectable', () => {
    expect(
      frameToSourceUrl({
        file: '/Users/x/random/place/foo.ts',
        line: 1,
        sourceRepoUrl: repo,
      })
    ).toBe(null)
  })

  it('handles trailing-slash repo URLs without doubling', () => {
    expect(
      frameToSourceUrl({
        file: 'src/a.ts',
        line: 7,
        sourceRepoUrl: 'https://github.com/me/repo/',
      })
    ).toBe('https://github.com/me/repo/blob/main/src/a.ts#L7')
  })
})
