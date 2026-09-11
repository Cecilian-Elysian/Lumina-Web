/* ============================================================
 * 测试 mergeFocalPoints(纯函数)
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { mergeFocalPoints } from '../server/lib/config-reader.mjs';

describe('mergeFocalPoints', () => {
  it('空 + 空 → 空', () => {
    const { merged, stats } = mergeFocalPoints({}, {});
    expect(merged).toEqual({});
    expect(stats).toEqual({ kept: 0, updated: 0, added: 0 });
  });

  it('已有 + 空 → 完全保留', () => {
    const existing = {
      'https://a.jpg': { x: 0.1, y: 0.2 },
      'https://b.jpg': { x: 0.3, y: 0.4 },
    };
    const { merged, stats } = mergeFocalPoints(existing, {});
    expect(merged).toEqual(existing);
    expect(stats).toEqual({ kept: 2, updated: 0, added: 0 });
  });

  it('空 + 新检测 → 全部新增', () => {
    const detected = {
      'https://c.jpg': { x: 0.5, y: 0.6 },
    };
    const { merged, stats } = mergeFocalPoints({}, detected);
    expect(merged).toEqual(detected);
    expect(stats).toEqual({ kept: 0, updated: 0, added: 1 });
  });

  it('已有 + 检测到 → 用检测的(更新)', () => {
    const existing = { 'https://a.jpg': { x: 0.1, y: 0.2 } };
    const detected = { 'https://a.jpg': { x: 0.5, y: 0.5 } };
    const { merged, stats } = mergeFocalPoints(existing, detected);
    expect(merged['https://a.jpg']).toEqual({ x: 0.5, y: 0.5 });
    expect(stats).toEqual({ kept: 0, updated: 1, added: 0 });
  });

  it('混合场景:保留 + 更新 + 新增', () => {
    const existing = {
      'https://a.jpg': { x: 0.1, y: 0.2 },  // AI 未检到 → 保留
      'https://b.jpg': { x: 0.3, y: 0.4 },  // AI 检到   → 更新
    };
    const detected = {
      'https://b.jpg': { x: 0.5, y: 0.5 },  // 更新
      'https://c.jpg': { x: 0.7, y: 0.7 },  // 新增
    };
    const { merged, stats } = mergeFocalPoints(existing, detected);
    expect(merged).toEqual({
      'https://a.jpg': { x: 0.1, y: 0.2 },  // 保留旧值
      'https://b.jpg': { x: 0.5, y: 0.5 },  // 更新
      'https://c.jpg': { x: 0.7, y: 0.7 },  // 新增
    });
    expect(stats).toEqual({ kept: 1, updated: 1, added: 1 });
  });

  it('不修改原对象(existing)', () => {
    const existing = { 'https://a.jpg': { x: 0.1, y: 0.2 } };
    const snapshot = JSON.stringify(existing);
    mergeFocalPoints(existing, { 'https://a.jpg': { x: 0.9, y: 0.9 } });
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it('AI 检测到 null/falsy 值时跳过', () => {
    const existing = { 'https://a.jpg': { x: 0.1, y: 0.2 } };
    const detected = {
      'https://a.jpg': null,
      'https://b.jpg': undefined,
      'https://c.jpg': { x: 0.5, y: 0.5 },
    };
    const { merged, stats } = mergeFocalPoints(existing, detected);
    expect(merged['https://a.jpg']).toEqual({ x: 0.1, y: 0.2 });
    expect(merged['https://c.jpg']).toEqual({ x: 0.5, y: 0.5 });
    expect(stats.added).toBe(1);
    expect(stats.updated).toBe(0);
  });

  it('核心安全场景:AI 未检出 → 人工标注绝不被覆盖', () => {
    // 模拟 build-focal-points.mjs 的合并场景
    // 已有的人工标注(可能是手工调过的)
    const manual = {
      'https://manual.jpg': { x: 0.123, y: 0.456 },
    };
    // AI 跑了所有 URL,但这张没检到人脸 → AI 不会写到 detected 里
    const detected = {
      'https://other.jpg': { x: 0.5, y: 0.5 },
    };
    const { merged } = mergeFocalPoints(manual, detected);
    // 关键断言:人工标注仍然在
    expect(merged['https://manual.jpg']).toEqual({ x: 0.123, y: 0.456 });
  });
});