/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages のようにサブディレクトリへ置かれても動くよう相対参照にする
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
