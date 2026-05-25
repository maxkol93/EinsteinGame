import { defineConfig } from 'vite';

// `base: './'` keeps asset URLs relative so the static build drops straight
// onto itch.io / any static host. `fs.allow: ['..']` lets the dev server read
// the cross-version source of truth in ../shared (palette, daily vectors).
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2020' },
});
