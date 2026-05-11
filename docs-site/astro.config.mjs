import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// https://starlight.astro.build/reference/configuration/
export default defineConfig({
  site: 'https://docs.sentori.golia.jp',
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
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'SDK — React', slug: 'sdk-react' },
            { label: 'SDK — React Native', slug: 'sdk-react-native' },
            { label: 'SDK — Vue (planned)', slug: 'sdk-vue' },
            { label: 'SDK — Svelte (planned)', slug: 'sdk-svelte' },
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
          attrs: { property: 'og:image', content: 'https://docs.sentori.golia.jp/og.png' },
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
          attrs: { name: 'twitter:image', content: 'https://docs.sentori.golia.jp/og.png' },
        },
      ],
    }),
  ],
})
