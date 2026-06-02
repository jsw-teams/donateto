import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://pay.js.gripe',
  outDir: './dist',
  publicDir: './public'
});
