/* ============================================================
 * Vite 构建配置 — 双模式
 * ------------------------------------------------------------
 *   默认模式      → 站点(index / gallery / 404) → dist/
 *   --mode manager → 本地管理器                → dist-manager/
 *
 * 生产部署只包含 dist/(wrangler.toml 指向);
 * dist-manager/ 仅供本地 tools/server/serve.mjs 使用。
 * ============================================================ */
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  const isManager = mode === 'manager';

  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': r('./src') },
    },
    build: isManager
      ? {
          outDir: 'dist-manager',
          rollupOptions: {
            input: r('./manager.html'),
          },
        }
      : {
          outDir: 'dist',
          rollupOptions: {
            input: {
              index: r('./index.html'),
              gallery: r('./gallery.html'),
              '404': r('./404.html'),
            },
          },
        },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  };
});
