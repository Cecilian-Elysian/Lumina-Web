import { defineConfig } from 'vitest/config';

// 独立配置:阻断 vitest 向上查找到根目录 vite.config.ts
// (根配置 include 只认 src/**/*.test.ts,会漏掉 tools 的 node 侧测试)
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
  },
});
