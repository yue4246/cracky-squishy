import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  plugins: [{
    name: 'classic-script',
    apply: 'build',
    transformIndexHtml: html => html.replace(/ type="module"(?: crossorigin)?/g, ' defer'),
  }],
  build: {
    target: ['es2017', 'chrome61'],
    rollupOptions: { output: { format: 'iife' } },
  },
  server: { port: 5173, host: '127.0.0.1' },
});
