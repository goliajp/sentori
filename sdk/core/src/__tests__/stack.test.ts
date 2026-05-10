import { expect, test } from 'bun:test'

import { parseStack } from '../stack.js'

test('parses V8 frames with parens', () => {
  const stack = `Error: boom
    at handle (file:///app/index.js:10:5)
    at run (/app/runner.ts:42:1)`
  const frames = parseStack(stack)
  expect(frames).toHaveLength(2)
  expect(frames[0]).toMatchObject({
    column: 5,
    function: 'handle',
    inApp: true,
    line: 10,
  })
  expect(frames[1]?.function).toBe('run')
})

test('parses SpiderMonkey @-style', () => {
  const stack = `boom@http://example.com/app.js:5:7
@http://example.com/app.js:1:1`
  const frames = parseStack(stack)
  expect(frames).toHaveLength(2)
  expect(frames[0]).toMatchObject({
    column: 7,
    function: 'boom',
    inApp: false, // http URL → not inApp
    line: 5,
  })
})

test('shortFilenames: strips protocol + path', () => {
  const stack = `at fn (https://cdn.example.com/static/App.tsx:1:1)`
  const frames = parseStack(stack, { shortFilenames: true })
  expect(frames[0]?.file).toBe('static/App.tsx')
})

test('inApp: node_modules and node:* are out', () => {
  const stack = `at fn (node:internal/process/task_queues:95:5)
at fn2 (/app/node_modules/react/index.js:1:1)
at fn3 (/app/src/main.ts:10:1)`
  const frames = parseStack(stack)
  expect(frames.map((f) => f.inApp)).toEqual([false, false, true])
})

test('empty / non-string returns []', () => {
  expect(parseStack(undefined)).toEqual([])
  expect(parseStack('')).toEqual([])
  expect(parseStack('Error: just a header')).toEqual([])
})
