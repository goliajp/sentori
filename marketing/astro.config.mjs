import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import sitemap from '@astrojs/sitemap'

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: 'https://sentori.golia.jp',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
})
