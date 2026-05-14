import type { SourceLanguage } from '@/components/SourceCode'

/**
 * Phase 42 sub-A.04 — map a frame's filename to a SourceLanguage.
 *
 * Returns `null` for unknown extensions so `<SourceCode>` falls back
 * to plain text (no highlight) rather than guessing.
 *
 * Path stripping: the input `file` may be a long absolute path; we
 * only look at what comes after the last `/`, and then at the last
 * `.<ext>` segment. URLs (`http://…`) are handled the same way.
 */
export function languageOf(file: null | string | undefined): null | SourceLanguage {
  if (!file) return null
  const lastSlash = file.lastIndexOf('/')
  const base = lastSlash >= 0 ? file.slice(lastSlash + 1) : file
  const lastDot = base.lastIndexOf('.')
  if (lastDot < 0) return null
  // Strip query / hash that can ride on a bundle URL.
  const ext = base
    .slice(lastDot + 1)
    .split(/[?#]/)[0]!
    .toLowerCase()
  switch (ext) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'jsx':
      return 'jsx'
    case 'swift':
      return 'swift'
    case 'kt':
    case 'kts':
      return 'kotlin'
    case 'java':
      return 'java'
    case 'm':
    case 'mm':
    case 'h':
      return 'objc'
    default:
      return null
  }
}
