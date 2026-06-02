// v1.2 W2 / W3.c — single banner covering both JS sourcemaps and
// native source bundles (Swift / Kotlin / OC), keyed on the event's
// platform. The frame drawer's per-frame 404 also surfaces the same
// shortfall, but the operator has to click first; this banner sits
// above the stack so the missing-data case is visible up-front.
//
// Branching:
//   - Event platform is JS/RN → nudge about sourcemaps if missing.
//   - Event platform is iOS  → nudge about source_bundle_ios.
//   - Event platform is Android → nudge about source_bundle_android.
// Each branch only fires when there's at least one release in the
// project (no point yelling at a brand-new empty project).
//
// v1.4 W27 — also runs a per-release coverage probe. The
// project-wide check ("operator never uploaded anything") still
// triggers the initial nudge; once at least one release is covered,
// W27 detects releases that *individually* lack the artifact and
// nudges with the release name in the copy. That's the case where
// W2.b's extension heuristic was wrong: the project looked healthy
// but this specific event's release had no source uploaded.

import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'

export function SourceMapStatusBanner({
  platform,
  projectId,
  release,
}: {
  platform: string
  projectId: string
  release?: null | string
}) {
  const { data } = useQuery({
    queryFn: () => adminApi.sourcemapStatus(projectId),
    queryKey: qk.sourcemapStatus(projectId),
    staleTime: 5 * 60 * 1000,
  })
  // v1.4 W27 — per-release probe, only fired when we have a release
  // to ask about. Reuses the same staleTime as the project banner.
  const coverageQ = useQuery({
    enabled: !!release,
    queryFn: () => adminApi.sourceCoverage(projectId, release ?? ''),
    queryKey: qk.sourceCoverage(projectId, release ?? ''),
    staleTime: 5 * 60 * 1000,
  })

  if (!data) return null
  if (data.releasesTotal === 0) return null

  if (platform === 'ios') {
    if (data.releasesWithIosBundle === 0) {
      return (
        <NudgeBanner
          cliCommand="sentori-cli upload source-bundle --platform ios"
          recipeAnchor="ios-source-bundles"
          what="iOS source bundles"
        />
      )
    }
    if (release && coverageQ.data && !coverageQ.data.hasIosBundle) {
      return (
        <NudgeBanner
          cliCommand={`sentori-cli upload source-bundle --platform ios --release ${release}`}
          recipeAnchor="ios-source-bundles"
          release={release}
          what="iOS source bundle"
        />
      )
    }
    return null
  }
  if (platform === 'android') {
    if (data.releasesWithAndroidBundle === 0) {
      return (
        <NudgeBanner
          cliCommand="sentori-cli upload source-bundle --platform android"
          recipeAnchor="android-source-bundles"
          what="Android source bundles"
        />
      )
    }
    if (release && coverageQ.data && !coverageQ.data.hasAndroidBundle) {
      return (
        <NudgeBanner
          cliCommand={`sentori-cli upload source-bundle --platform android --release ${release}`}
          recipeAnchor="android-source-bundles"
          release={release}
          what="Android source bundle"
        />
      )
    }
    return null
  }
  // Default branch: JavaScript / React Native — nudge about sourcemaps.
  if (data.releasesWithSourcemap === 0) {
    return (
      <NudgeBanner
        cliCommand="sentori-cli upload sourcemap"
        recipeAnchor="sourcemap-upload"
        what="sourcemaps"
      />
    )
  }
  if (release && coverageQ.data && !coverageQ.data.hasJsSourcemap) {
    return (
      <NudgeBanner
        cliCommand={`sentori-cli upload sourcemap --release ${release}`}
        recipeAnchor="sourcemap-upload"
        release={release}
        what="sourcemap"
      />
    )
  }
  return null
}

function NudgeBanner({
  cliCommand,
  recipeAnchor,
  release,
  what,
}: {
  cliCommand: string
  recipeAnchor: string
  release?: string
  what: string
}) {
  return (
    <div className="border-warning/40 bg-warning/5 text-warning t-md mb-3 flex items-start gap-3 rounded border px-3 py-2">
      <span className="font-mono text-[10px] tracking-[0.18em] uppercase">No {what}</span>
      <span className="text-fg flex-1">
        {release ? (
          <>
            No {what} uploaded for release <code className="font-mono text-[11px]">{release}</code>.
            Frames will resolve symbols but source views below will be empty.
          </>
        ) : (
          <>
            No {what} uploaded for this project's releases. Frames will resolve symbols but source
            views below will be empty.
          </>
        )}{' '}
        Run <code className="font-mono">{cliCommand}</code> —{' '}
        <a
          className="text-accent hover:text-accent-strong underline"
          href={`/docs/recipes/${recipeAnchor}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          recipe
        </a>
        .
      </span>
    </div>
  )
}
