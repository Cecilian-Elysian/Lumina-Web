import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import {
  defaultSettings, loadSettings, saveSettings, applySettings,
  resetSettings, useSettings,
  ROWS_RANGE, WIDTH_RANGE, SPEED_RANGE,
} from './settings';
import { CONFIG } from './config';

const LS_KEY = 'lumina.settings';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
});

describe('settings 默认值', () => {
  it('rows/cardWidth 取自 CONFIG 且在范围内', () => {
    const d = defaultSettings();
    expect(d.rows).toBe(CONFIG.rows);
    expect(d.cardWidth).toBe(CONFIG.cardWidth);
    expect(d.rows).toBeGreaterThanOrEqual(ROWS_RANGE.min);
    expect(d.rows).toBeLessThanOrEqual(ROWS_RANGE.max);
    expect(d.cardWidth).toBeGreaterThanOrEqual(WIDTH_RANGE.min);
    expect(d.cardWidth).toBeLessThanOrEqual(WIDTH_RANGE.max);
    expect(d.speed).toBe(1);
    expect(d.animate).toBe(true);
  });
});

describe('loadSettings 校验', () => {
  it('无存储 → 默认值', () => {
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('非法 JSON → 默认值', () => {
    localStorage.setItem(LS_KEY, '{broken json');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('非对象存储 → 默认值', () => {
    localStorage.setItem(LS_KEY, '[1,2,3]');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('越界值逐字段 clamp', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      rows: 99, cardWidth: 10, speed: 100, animate: 'x',
    }));
    expect(loadSettings()).toEqual({
      rows: ROWS_RANGE.max,
      cardWidth: WIDTH_RANGE.min,
      speed: SPEED_RANGE.max,
      animate: true, // 非法类型回默认
    });
  });

  it('部分字段合法 → 合法字段保留,缺失字段补默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ rows: 5 }));
    const s = loadSettings();
    expect(s.rows).toBe(5);
    expect(s.cardWidth).toBe(defaultSettings().cardWidth);
    expect(s.speed).toBe(1);
    expect(s.animate).toBe(true);
  });
});

describe('持久化往返', () => {
  it('save → load 一致', () => {
    const s = { rows: 2, cardWidth: 420, speed: 1.5, animate: false };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
});

describe('applySettings 应用到 <html>', () => {
  it('写入 --card-w 与 data-anim', () => {
    applySettings({ rows: 3, cardWidth: 360, speed: 1, animate: false });
    expect(
      document.documentElement.style.getPropertyValue('--card-w'),
    ).toBe('360px');
    expect(document.documentElement.dataset.anim).toBe('off');

    applySettings({ rows: 3, cardWidth: 360, speed: 1, animate: true });
    expect(document.documentElement.dataset.anim).toBeUndefined();
  });
});

describe('useSettings 单例', () => {
  it('修改后持久化,resetSettings 恢复默认并持久化', async () => {
    const { settings } = useSettings();
    settings.value = { rows: 6, cardWidth: 560, speed: 3, animate: false };
    await nextTick(); // watch 异步 flush 后才写 LS
    expect(loadSettings().rows).toBe(6);

    resetSettings();
    await nextTick();
    expect(settings.value).toEqual(defaultSettings());
    expect(loadSettings()).toEqual(defaultSettings());
  });
});
