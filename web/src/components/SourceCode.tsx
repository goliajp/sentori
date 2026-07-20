import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

/**
 * Phase 42 sub-A.02 — syntax-highlighted source snippet.
 *
 * Built on `@wooorm/starry-night` (GitHub's own TextMate-grammar
 * highlighter): renders each line as its own `<div>` so we can:
 *   - prepend a line number
 *   - tint background red on lines named in `highlightLines`
 *   - lazy-load the highlighter (~120 KB gzipped of grammars + WASM)
 *     after first paint, falling back to plain text while loading
 *
 * Async load is deliberate: the rest of the page is already rendered
 * from cached event JSON, so the highlighter is the longest tail —
 * we show un-highlighted text immediately, then upgrade in-place
 * once the grammar is parsed. No layout shift; the structure is
 * identical pre/post highlight.
 *
 * For short snippets (±3 lines in `FrameRow`) we tokenise per-line.
 * Long multi-line strings or block comments that cross the boundary
 * may render slightly off, but the snippet itself is correct line
 * by line. For full-file rendering (`FrameSourceDrawer`) the same
 * component is used because lines are the addressing unit anyway.
 */

export type SourceLanguage =
  'java' | 'javascript' | 'jsx' | 'kotlin' | 'objc' | 'swift' | 'tsx' | 'typescript'

const SCOPE_BY_LANG: Record<SourceLanguage, string> = {
  java: 'source.java',
  javascript: 'source.js',
  jsx: 'source.js', // GitHub treats .jsx as a JavaScript dialect
  kotlin: 'source.kotlin',
  objc: 'source.objc',
  swift: 'source.swift',
  tsx: 'source.tsx',
  typescript: 'source.ts',
}

const SCOPES = Object.values(SCOPE_BY_LANG).filter((v, i, a) => a.indexOf(v) === i)

type StarryNight = {
  highlight: (value: string, scope: string) => unknown
}

// Singleton — starts the (one-shot, idempotent) grammar load on the
// first mount of any `<SourceCode>` instance, and every later instance
// awaits the same promise.
let _instance: null | Promise<StarryNight> = null

function getStarryNight(): Promise<StarryNight> {
  if (_instance) return _instance
  _instance = (async () => {
    const [{ createStarryNight }, ...grammars] = await Promise.all([
      import('@wooorm/starry-night'),
      import('@wooorm/starry-night/source.ts'),
      import('@wooorm/starry-night/source.tsx'),
      import('@wooorm/starry-night/source.js'),
      import('@wooorm/starry-night/source.swift'),
      import('@wooorm/starry-night/source.kotlin'),
      import('@wooorm/starry-night/source.java'),
      import('@wooorm/starry-night/source.objc'),
    ])
    return createStarryNight(grammars.map((g) => g.default))
  })()
  return _instance
}

type Props = {
  /** Source code (newline-delimited). */
  code: string
  /** TextMate language id. If unknown, renders plain text. */
  language?: SourceLanguage | null
  /** 1-indexed line numbers to highlight with a tinted background. */
  highlightLines?: number[]
  /** Starting line number (1-indexed) for the rendered slice. */
  startLine?: number
  /** Show the line-number column. Default true. */
  showLineNumbers?: boolean
  /** Optional id for scroll-to-line anchors (`<div id="L42">`). */
  lineAnchorPrefix?: string
}

export function SourceCode({
  code,
  highlightLines,
  language,
  lineAnchorPrefix,
  showLineNumbers = true,
  startLine = 1,
}: Props) {
  const [sn, setSn] = useState<null | StarryNight>(null)

  useEffect(() => {
    let live = true
    getStarryNight().then((instance) => {
      if (live) setSn(instance)
    })
    return () => {
      live = false
    }
  }, [])

  const scope = language ? SCOPE_BY_LANG[language] : null
  const lines = useMemo(() => code.split('\n'), [code])
  const highlightSet = useMemo(() => new Set(highlightLines ?? []), [highlightLines])

  return (
    <pre className="bg-bg-tertiary/30 overflow-x-auto font-mono text-[11px] leading-[1.5]">
      {lines.map((line, i) => {
        const lineNo = startLine + i
        const isHit = highlightSet.has(lineNo)
        return (
          <div
            className={`flex ${isHit ? 'text-fg -mx-3 bg-red-500/10 px-3' : 'text-fg-muted/90'}`}
            id={lineAnchorPrefix ? `${lineAnchorPrefix}L${lineNo}` : undefined}
            key={i}
          >
            {showLineNumbers && (
              <span className="text-fg-muted/60 mr-3 inline-block w-10 shrink-0 text-right tabular-nums select-none">
                {lineNo}
              </span>
            )}
            <span className="flex-1">{renderLine(sn, scope, line)}</span>
          </div>
        )
      })}
    </pre>
  )
}

function renderLine(sn: null | StarryNight, scope: null | string, line: string): ReactNode {
  if (!sn || !scope || !SCOPES.includes(scope)) {
    // Fallback: show plain text. Empty lines get a non-breaking space
    // so the row still has height.
    return line || ' '
  }
  try {
    const tree = sn.highlight(line, scope)
    // `toJsxRuntime` expects a `Root` hast node.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return toJsxRuntime(tree as any, { Fragment, jsx, jsxs }) as ReactNode
  } catch {
    return line || ' '
  }
}
