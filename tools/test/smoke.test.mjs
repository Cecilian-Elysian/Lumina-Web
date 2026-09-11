/* ============================================================
 * Lumina Tools — 最小冒烟测试
 * ------------------------------------------------------------
 * 仅用来验证 vitest 配置 + 测试文件发现
 * 真正的逻辑测试见 parse-config.test.mjs / focal-merge.test.mjs
 * ============================================================ */
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('vitest works', () => {
    expect(1 + 1).toBe(2);
  });

  it('node version >= 18', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(18);
  });
});