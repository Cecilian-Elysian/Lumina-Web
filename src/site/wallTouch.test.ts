import { describe, it, expect } from 'vitest';
import {
  normalizeOffset, flingVelocity, isTap, flingStep,
  DRAG_SLOP, DOUBLE_TAP_MS, FLING_MIN_V,
} from './wallTouch';

describe('normalizeOffset — 手动位移归一化到 (-period, 0]', () => {
  it('周期内位移原样保留', () => {
    expect(normalizeOffset(0, 100)).toBe(0);
    expect(normalizeOffset(-50, 100)).toBe(-50);
    expect(normalizeOffset(-99.5, 100)).toBe(-99.5);
  });

  it('正向溢出折回左侧等价位置', () => {
    // 30 → 30-100 = -70(内容以 period 为周期,视觉等价)
    expect(normalizeOffset(30, 100)).toBe(-70);
    expect(normalizeOffset(230, 100)).toBe(-70);
    expect(normalizeOffset(100, 100)).toBe(0); // 100%100=0 → 落到 0
  });

  it('负向深溢出保持周期内', () => {
    expect(normalizeOffset(-230, 100)).toBe(-30);
    expect(normalizeOffset(-315, 100)).toBe(-15);
  });

  it('非法周期返回 0(未布局完时防 NaN)', () => {
    expect(normalizeOffset(50, 0)).toBe(0);
    expect(normalizeOffset(50, -10)).toBe(0);
    expect(normalizeOffset(50, Number.NaN)).toBe(0);
  });
});

describe('flingVelocity — 末段速度估算(px/ms)', () => {
  it('两点直除', () => {
    expect(flingVelocity([{ x: 0, t: 0 }, { x: 50, t: 100 }])).toBeCloseTo(0.5);
  });

  it('只取窗口内样本', () => {
    // 末点 t=560,窗口 100ms → cutoff=460,首样本取 (10, 500)
    const v = flingVelocity([
      { x: 0, t: 0 }, { x: 10, t: 500 }, { x: 60, t: 560 },
    ]);
    expect(v).toBeCloseTo(50 / 60);
  });

  it('样本不足或时间异常返回 0', () => {
    expect(flingVelocity([{ x: 0, t: 0 }])).toBe(0);
    expect(flingVelocity([])).toBe(0);
    expect(flingVelocity([{ x: 5, t: 100 }, { x: 5, t: 100 }])).toBe(0);
  });
});

describe('isTap — 点按判定', () => {
  it('位移小 + 时间短 = 点按', () => {
    expect(isTap(4, 120)).toBe(true);
    expect(isTap(DRAG_SLOP, 250)).toBe(true);
  });
  it('拖远或按太久都不是点按', () => {
    expect(isTap(DRAG_SLOP + 1, 120)).toBe(false);
    expect(isTap(4, 400)).toBe(false);
  });
});

describe('flingStep — 惯性衰减', () => {
  it('每帧速度衰减并产出位移', () => {
    const [v, dx] = flingStep(1, 16.7);
    expect(v).toBeCloseTo(0.94);
    expect(dx).toBeCloseTo(16.7);
  });

  it('速度低于阈值停止(增量 0)', () => {
    const [v, dx] = flingStep(0.01, 16.7);
    expect(v).toBe(0);
    expect(dx).toBe(0);
  });

  it('帧间隔折算衰减步长(慢帧衰减更快)', () => {
    const slow = flingStep(1, 66.8)[0]; // ≈4 帧
    const fast = flingStep(1, 16.7)[0];
    expect(slow).toBeLessThan(fast);
  });

  it('达到触发阈值附近的速度可用(联调常量合理性)', () => {
    expect(FLING_MIN_V).toBeGreaterThan(0);
    expect(DOUBLE_TAP_MS).toBe(300);
  });
});
