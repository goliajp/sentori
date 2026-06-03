import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// https://starlight.astro.build/reference/configuration/
//
// v2.4 — single-domain consolidation. Docs now lives at
// `sentori.golia.jp/docs/*` instead of its own subdomain. Astro's
// `base: '/docs'` makes built assets and internal links resolve
// under that prefix. The old `docs.sentori.golia.jp` host can
// stay as a redirect to `sentori.golia.jp/docs` for compatibility.
export default defineConfig({
  site: 'https://sentori.golia.jp',
  base: '/docs',
  integrations: [
    starlight({
      title: 'Sentori',
      description:
        'Documentation for Sentori — modern, RN-first error tracking.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/goliajp/sentori',
        },
      ],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting started', slug: 'getting-started' },
            {
              label: 'Quickstarts',
              collapsed: false,
              items: [
                { label: 'React', slug: 'getting-started/react' },
                { label: 'React Native', slug: 'getting-started/react-native' },
                { label: 'Next.js', slug: 'getting-started/nextjs' },
                { label: 'Node.js', slug: 'getting-started/node' },
              ],
            },
            { label: 'Self-hosting', slug: 'self-hosting' },
            { label: 'Teams & ownership', slug: 'teams' },
          ],
        },
        {
          label: 'Manual instrumentation',
          items: [
            { label: 'Manual issue reporting', slug: 'recipes/manual-issue' },
            { label: 'Manual trace', slug: 'recipes/manual-trace' },
            { label: 'Manual span', slug: 'recipes/manual-span' },
            { label: 'Manual moment', slug: 'recipes/manual-moment' },
            { label: 'Manual breadcrumb', slug: 'recipes/manual-breadcrumb' },
            { label: 'Track + metrics', slug: 'recipes/track-and-metrics' },
            { label: 'Runtime metrics', slug: 'recipes/runtime-metrics' },
            { label: 'v1 → v2 migration', slug: 'recipes/v1-to-v2-migration' },
          ],
        },
        {
          label: 'Recipes',
          items: [
            { label: 'Next.js', slug: 'recipes/nextjs' },
            { label: 'Remix', slug: 'recipes/remix' },
            { label: 'Vite + React', slug: 'recipes/vite' },
            { label: 'State management', slug: 'recipes/state-management' },
            { label: 'Suspense, RSC, streaming', slug: 'recipes/suspense-rsc' },
            { label: 'Distributed tracing', slug: 'recipes/distributed-tracing' },
            { label: 'Source map upload (CI)', slug: 'recipes/sourcemap-upload' },
            { label: 'Release versioning', slug: 'recipes/release-versioning' },
            { label: 'Multi-environment', slug: 'recipes/multi-environment' },
            { label: 'Endpoint health', slug: 'recipes/endpoint-health' },
            { label: 'Find bugs with /explore', slug: 'recipes/find-bugs-with-explore' },
          ],
        },
        {
          label: 'API reference',
          items: [
            { label: 'sentori.init()', slug: 'api/init' },
            { label: 'captureException / captureMessage', slug: 'api/capture' },
            { label: 'Scope (setUser / setTag / addBreadcrumb)', slug: 'api/scope' },
            { label: 'Tracing (startSpan / withSpan / startTrace)', slug: 'api/tracing' },
            { label: 'SDK logger', slug: 'api/logger' },
            { label: 'init.beforeSend hook', slug: 'api/before-send' },
          ],
        },
        {
          label: 'Privacy & compliance',
          items: [
            { label: 'Identity layer', slug: 'privacy/identity' },
            { label: 'GDPR DSR erase', slug: 'privacy/dsr' },
            { label: 'Sentry compat', slug: 'sentry-compat' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'SDK — React', slug: 'sdk-react' },
            { label: 'SDK — React Native', slug: 'sdk-react-native' },
            { label: 'SDK — Vue', slug: 'sdk-vue' },
            { label: 'SDK — Svelte', slug: 'sdk-svelte' },
            { label: 'SDK — SolidJS', slug: 'sdk-solid' },
            { label: 'Protocol', slug: 'protocol' },
            { label: 'Troubleshooting', slug: 'troubleshooting' },
          ],
        },
      ],
      customCss: ['./src/styles/overrides.css'],
      components: {
        Head: './src/components/Head.astro',
      },
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://sentori.golia.jp/docs/og.png' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:width', content: '1200' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:image:height', content: '630' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://sentori.golia.jp/docs/og.png' },
        },
      ],
    }),
  ],
})
