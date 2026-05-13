import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Frame } from '@/api/client'

import { StackList } from './issue-detail'

const appFrame = (over: Partial<Frame> = {}): Frame => ({
  column: 18,
  contextLine: '  await api.post(`/orders/${user.id}`, payload)',
  file: 'src/screens/Checkout.tsx',
  function: 'handleSubmit',
  inApp: true,
  line: 142,
  postContext: ['  navigation.navigate("Confirmation")', '}'],
  preContext: ['  const payload = { items, total }'],
  ...over,
})
const vendorFrame = (over: Partial<Frame> = {}): Frame => ({
  file: 'node_modules/react-native/Libraries/Core/setUpErrorHandling.js',
  function: 'handleException',
  inApp: false,
  line: 24,
  ...over,
})

describe('StackList', () => {
  it('renders an in-app frame with its inline source snippet', () => {
    render(<StackList stack={[appFrame()]} />)
    expect(screen.getByText('handleSubmit')).toBeInTheDocument()
    expect(screen.getByText('src/screens/Checkout.tsx:142:18')).toBeInTheDocument()
    // the at-line and a context line both show
    expect(screen.getByText(/await api\.post/)).toBeInTheDocument()
    expect(screen.getByText(/const payload =/)).toBeInTheDocument()
    // line numbers around the at-line (142): the pre line is 141
    expect(screen.getByText('141')).toBeInTheDocument()
    expect(screen.getByText('142')).toBeInTheDocument()
  })

  it('collapses a run of same-package vendor frames into a labelled fold', () => {
    render(<StackList stack={[appFrame(), vendorFrame(), vendorFrame({ function: 'b' })]} />)
    // not expanded by default → the vendor function isn't visible yet
    expect(screen.queryByText('handleException')).not.toBeInTheDocument()
    // Phase 42 sub-A.07: same-package run is named after the package.
    expect(screen.getByText('react-native')).toBeInTheDocument()
    expect(screen.getByText(/2 frames/)).toBeInTheDocument()
  })

  it('splits vendor runs by package boundary', () => {
    render(
      <StackList
        stack={[
          appFrame(),
          vendorFrame(),
          vendorFrame({ file: 'node_modules/expo-router/entry.js', function: 'init' }),
        ]}
      />
    )
    // Two separate folds, one per package.
    expect(screen.getByText('react-native')).toBeInTheDocument()
    expect(screen.getByText('expo-router')).toBeInTheDocument()
  })

  it('shows "upload a source map" when an in-app frame has no inline source and no map exists', () => {
    render(
      <StackList
        stack={[
          appFrame({ contextLine: undefined, preContext: undefined, postContext: undefined }),
        ]}
        symbolication={{ releaseHasMap: false }}
      />
    )
    expect(screen.getByText(/upload a source map for this release/i)).toBeInTheDocument()
    expect(screen.getByText(/sentori-cli upload sourcemap/)).toBeInTheDocument()
  })

  it('says the map did not resolve when one is uploaded but frames are still raw', () => {
    render(
      <StackList
        stack={[
          appFrame({ contextLine: undefined, preContext: undefined, postContext: undefined }),
        ]}
        symbolication={{ releaseHasMap: true }}
      />
    )
    expect(screen.getByText(/didn’t resolve through it/i)).toBeInTheDocument()
  })

  it('renders "No frames." for an empty stack', () => {
    render(<StackList stack={[]} />)
    expect(screen.getByText('No frames.')).toBeInTheDocument()
  })
})
