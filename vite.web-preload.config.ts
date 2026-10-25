import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * 远程桌面 web-preload：把桌面 preload 打成浏览器经典脚本（electron 换成隧道垫片），
 * 与 renderer 产物放在一起，由宿主经配对隧道下发。须在 electron-vite build 之后执行。
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^electron$/, replacement: path.resolve(__dirname, 'src/web/electronShim.ts') },
      { find: '@shared', replacement: path.resolve(__dirname, 'src/shared') },
    ],
  },
  build: {
    outDir: 'out/renderer',
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'es2022',
    minify: 'esbuild',
    lib: {
      entry: path.resolve(__dirname, 'src/web/preload.ts'),
      formats: ['iife'],
      name: 'EnsoWebPreload',
      fileName: () => 'web-preload.js',
    },
  },
});
