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
