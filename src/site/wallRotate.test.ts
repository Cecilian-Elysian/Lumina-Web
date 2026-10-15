import { describe, it, expect, afterEach } from 'vitest';
import {
  windowSize, nextWindow, prefersReducedMotion,
  MIN_CARDS_PER_ROW, WINDOW_RATIO, WINDOW_MAX, STEP_RATIO,
} from './wallRotate';

describe('windowSize — 登台窗口张数', () => {
  it('空池/非法总量返回 0', () => {
    expect(windowSize(0, 3, 1440, 300, 16)).toBe(0);
    expect(windowSize(-5, 3, 1440, 300, 16)).toBe(0);
    expect(windowSize(Number.NaN, 3, 1440, 300, 16)).toBe(0);
  });

  it('小池子退化为全量(不隐藏图片)', () => {
    // total=16,rows=3,窄视口:fill=3*6=18 > 16 → 取全量
    expect(windowSize(16, 3, 800, 300, 16)).toBe(16);
  });

  it('大池子取比例且不小于填满一屏', () => {
    const size = windowSize(100, 3, 1440, 300, 16);
    // 比例下限 ceil(100*0.6)=60;填满一屏 3*(ceil(1440/316)+1)=3*6=18
    expect(size).toBe(60);
    expect(size).toBeLessThanOrEqual(100);
  });

  it('超宽视口时按「填满一屏」抬高窗口,避免循环露白', () => {
    // 4K 视口 + 小卡片:fill 更大,胜过 60% 比例
    const size = windowSize(100, 3, 3840, 180, 16);
    // fillPerRow = ceil(3840/196)+1 = 20+1 = 21 → 3*21 = 63
    expect(size).toBe(63);
    expect(size).toBeGreaterThan(Math.ceil(100 * WINDOW_RATIO));
  });

  it('每行至少一张(行数大于池子时不越界)', () => {
    expect(windowSize(2, 6, 1440, 300, 16)).toBe(2);
  });

  it('非法宽度/视口做防御,不产生 NaN', () => {
    // 视口未知 → 退化为比例下限 ceil(50*0.6)=30
    const size = windowSize(50, 3, Number.NaN, Number.NaN, Number.NaN);
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBe(30);
  });

  it('超大池子:比例项封顶 WINDOW_MAX(避免每次预热上百张)', () => {
    // total=400:比例 ceil(400*0.6)=240 → 封顶 90;填屏仅 18
    expect(windowSize(400, 3, 1440, 300, 16)).toBe(WINDOW_MAX);
  });

  it('封顶不影响「填满一屏」下限(宁可超出 WINDOW_MAX 也不能露白)', () => {
    // 6 行 + 3840 视口 + 120 卡片:fill=6*(ceil(3840/136)+1)=6*30=180
    const size = windowSize(400, 6, 3840, 120, 16);
    expect(size).toBe(180);
    expect(size).toBeGreaterThan(WINDOW_MAX);
  });
});

describe('prefersReducedMotion — 系统「减少动态效果」', () => {
  const orig = window.matchMedia;
  afterEach(() => {
    if (orig) window.matchMedia = orig;
  });
  const stub = (matches: boolean) => {
    window.matchMedia = ((q: string) => ({
      matches,
      media: q,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    })) as unknown as typeof window.matchMedia;
  };

  it('命中 reduce 时为真(此时不自动轮换)', () => {
    stub(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('未命中时为假', () => {
    stub(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('无 matchMedia(老环境)时安全返回 false,不抛错', () => {
    // @ts-expect-error 故意删掉 API 模拟老环境
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('nextWindow — 环形窗口前进', () => {
  it('空池返回空', () => {
    expect(nextWindow(0, 0, 5)).toEqual({ indices: [], nextCursor: 0, wrapped: false });
  });

  it('取连续窗口且不重复', () => {
    const r = nextWindow(10, 0, 4, 2);
    expect(r.indices).toEqual([0, 1, 2, 3]);
    expect(r.nextCursor).toBe(2);
    expect(r.wrapped).toBe(false);
  });

  it('越过池尾时环形包裹并标记 wrapped', () => {
    const r = nextWindow(10, 8, 4, 2);
    // 8,9,0,1
    expect(r.indices).toEqual([8, 9, 0, 1]);
    expect(r.nextCursor).toBe(0);
    expect(r.wrapped).toBe(true);
  });

  it('缺省步长 = 窗口一半(相邻窗口重叠,画面连贯)', () => {
    const r = nextWindow(20, 0, 6);
    expect(r.nextCursor).toBe(Math.round(6 * STEP_RATIO));
  });

  it('size 被 clamp 到 [1,total]', () => {
    expect(nextWindow(5, 0, 99).indices).toHaveLength(5);
    expect(nextWindow(5, 0, 0).indices).toHaveLength(1);
  });

  it('游标越界(负/超)内部取模', () => {
    expect(nextWindow(10, -1, 3, 3).indices).toEqual([9, 0, 1]);
    expect(nextWindow(10, 12, 3, 3).indices).toEqual([2, 3, 4]);
  });

  it('连续前进可覆盖全池(不遗漏)', () => {
    const total = 10;
    const size = 6;
    const seen = new Set<number>();
    let cursor = 0;
    for (let i = 0; i < 12; i++) {
      const r = nextWindow(total, cursor, size);
      r.indices.forEach((x) => seen.add(x));
      cursor = r.nextCursor;
    }
    expect(seen.size).toBe(total);
  });
});

describe('常量合理性', () => {
  it('比例为正值且窗口比例 > 步长比例(保留重叠)', () => {
    expect(MIN_CARDS_PER_ROW).toBeGreaterThan(0);
    expect(WINDOW_RATIO).toBeGreaterThan(0);
    expect(STEP_RATIO).toBeGreaterThan(0);
    expect(STEP_RATIO).toBeLessThanOrEqual(1);
  });

  it('窗口上限不会低于「至少每行 MIN_CARDS_PER_ROW 张」的合理规模', () => {
    expect(WINDOW_MAX).toBeGreaterThanOrEqual(MIN_CARDS_PER_ROW);
  });
});
