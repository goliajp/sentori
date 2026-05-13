import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyTemplate,
  getEditorTemplate,
  KNOWN_EDITORS,
  setEditorTemplate,
} from './editor-template'

// Use an in-memory localStorage stub. The vitest jsdom shim in this
// repo doesn't expose `.removeItem` / `.clear`, which makes "reset
// to empty between tests" impossible against the real window.
let _store: Record<string, string> = {}
beforeEach(() => {
  _store = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in _store ? _store[k]! : null),
    setItem: (k: string, v: string) => {
      _store[k] = v
    },
    removeItem: (k: string) => {
      delete _store[k]
    },
    clear: () => {
      _store = {}
    },
    key: (i: number) => Object.keys(_store)[i] ?? null,
    get length() {
      return Object.keys(_store).length
    },
  })
})

describe('editor-template', () => {
  it('defaults to VS Code when nothing stored', () => {
    expect(getEditorTemplate().id).toBe('vscode')
  })

  it('round-trips a known choice through localStorage', () => {
    setEditorTemplate({ id: 'cursor' })
    expect(getEditorTemplate().id).toBe('cursor')
  })

  it('falls back to VS Code when stored id is unknown', () => {
    window.localStorage.setItem('sentori:ui:editor-template:v1', 'not-a-real-editor')
    expect(getEditorTemplate().id).toBe('vscode')
  })

  it('stores + retrieves a custom template', () => {
    setEditorTemplate({
      customTemplate: 'myeditor://open?path={file}&row={line}',
      id: 'custom',
    })
    const got = getEditorTemplate()
    expect(got.id).toBe('custom')
    expect(got.template).toBe('myeditor://open?path={file}&row={line}')
  })

  it('rejects custom template without {file} placeholder', () => {
    window.localStorage.setItem('sentori:ui:editor-template:v1', 'custom')
    window.localStorage.setItem('sentori:ui:editor-template-custom:v1', 'broken-template')
    // No {file} → fall back to VS Code.
    expect(getEditorTemplate().id).toBe('vscode')
  })

  it('substitutes placeholders in applyTemplate', () => {
    expect(
      applyTemplate('vscode://file/{file}:{line}:{column}', {
        column: 9,
        file: '/a/b.ts',
        line: 42,
      })
    ).toBe('vscode://file//a/b.ts:42:9')
  })

  it('every known editor has a {file} placeholder', () => {
    for (const e of KNOWN_EDITORS) {
      expect(e.template).toContain('{file}')
    }
  })
})
