import { describe, expect, it } from 'vitest'

import { languageOf } from './source-language'

describe('languageOf', () => {
  it('maps common JS / TS variants', () => {
    expect(languageOf('src/Foo.ts')).toBe('typescript')
    expect(languageOf('src/Foo.tsx')).toBe('tsx')
    expect(languageOf('src/Foo.js')).toBe('javascript')
    expect(languageOf('src/Foo.mjs')).toBe('javascript')
    expect(languageOf('src/Foo.cjs')).toBe('javascript')
    expect(languageOf('src/Foo.jsx')).toBe('jsx')
  })

  it('maps native languages', () => {
    expect(languageOf('ios/MyApp/AppDelegate.swift')).toBe('swift')
    expect(languageOf('android/app/src/main/java/Foo.kt')).toBe('kotlin')
    expect(languageOf('build.gradle.kts')).toBe('kotlin')
    expect(languageOf('Foo.java')).toBe('java')
    expect(languageOf('Foo.m')).toBe('objc')
    expect(languageOf('Foo.mm')).toBe('objc')
    expect(languageOf('Foo.h')).toBe('objc')
  })

  it('handles paths with no slashes + URL with query string', () => {
    expect(languageOf('Foo.ts')).toBe('typescript')
    expect(languageOf('http://host:8081/src/Foo.bundle?platform=ios&dev=true')).toBe(null)
  })

  it('returns null for unknown / missing extensions', () => {
    expect(languageOf(null)).toBe(null)
    expect(languageOf(undefined)).toBe(null)
    expect(languageOf('')).toBe(null)
    expect(languageOf('Makefile')).toBe(null)
    expect(languageOf('Foo.go')).toBe(null)
  })

  it('is case-insensitive on extension', () => {
    expect(languageOf('Foo.TS')).toBe('typescript')
    expect(languageOf('Foo.JSX')).toBe('jsx')
  })
})
