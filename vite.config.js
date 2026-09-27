import { defineConfig } from 'vite';

// GitHub Pages（/atsumi-san/）と Capacitor の両方で動くよう相対パスで出力する
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },  // three.js 同梱で 500kB を超える
});
