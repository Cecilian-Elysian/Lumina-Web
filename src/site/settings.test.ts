import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import {
  defaultSettings, loadSettings, saveSettings, applySettings,
  resetSettings, useSettings,
  ROWS_RANGE, WIDTH_RANGE, SPEED_RANGE,
} from './settings';
import type { SiteSettings } from './settings';
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
    expect(d.theme).toBe('dark');
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
      rows: 99, cardWidth: 10, speed: 100, animate: 'x', theme: 'blue',
    }));
    expect(loadSettings()).toEqual({
      rows: ROWS_RANGE.max,
      cardWidth: WIDTH_RANGE.min,
      speed: SPEED_RANGE.max,
      animate: true, // 非法类型回默认
      theme: 'dark', // 非法主题回默认
    });
  });

  it('部分字段合法 → 合法字段保留,缺失字段补默认', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ rows: 5 }));
    const s = loadSettings();
    expect(s.rows).toBe(5);
    expect(s.cardWidth).toBe(defaultSettings().cardWidth);
    expect(s.speed).toBe(1);
    expect(s.animate).toBe(true);
    expect(s.theme).toBe('dark');
  });
});

describe('持久化往返', () => {
  it('save → load 一致', () => {
    const s: SiteSettings = { theme: 'light', rows: 2, cardWidth: 420, speed: 1.5, animate: false };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
});

describe('applySettings 应用到 <html>', () => {
  it('写入 --card-w 与 data-anim', () => {
    applySettings({ theme: 'dark', rows: 3, cardWidth: 360, speed: 1, animate: false });
    expect(
      document.documentElement.style.getPropertyValue('--card-w'),
    ).toBe('360px');
    expect(document.documentElement.dataset.anim).toBe('off');

    applySettings({ theme: 'dark', rows: 3, cardWidth: 360, speed: 1, animate: true });
    expect(document.documentElement.dataset.anim).toBeUndefined();
  });
});

describe('theme 主题', () => {
  /** jsdom 无内建 meta,真实页面 4 个入口 HTML 均已声明 */
  function ensureThemeColorMeta(): HTMLMetaElement {
    let m = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    return m;
  }

  it('light 应用 dataset.theme 与 meta theme-color', () => {
    const meta = ensureThemeColorMeta();
    applySettings({ theme: 'light', rows: 3, cardWidth: 300, speed: 1, animate: true });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(meta.getAttribute('content')).toBe('#f6f7f9');
  });

  it('dark 应用 dataset.theme 与 meta theme-color', () => {
    const meta = ensureThemeColorMeta();
    applySettings({ theme: 'dark', rows: 3, cardWidth: 300, speed: 1, animate: true });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(meta.getAttribute('content')).toBe('#14161a');
  });

  it('非法 theme 值回退 dark', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ theme: 'blue' }));
    expect(loadSettings().theme).toBe('dark');
  });

  it('LS 预置 light 正确读出', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ theme: 'light' }));
    expect(loadSettings().theme).toBe('light');
  });
});

describe('useSettings 单例', () => {
  it('修改后持久化,resetSettings 恢复默认并持久化', async () => {
    const { settings } = useSettings();
    settings.value = { theme: 'light', rows: 6, cardWidth: 560, speed: 3, animate: false };
    await nextTick(); // watch 异步 flush 后才写 LS
    expect(loadSettings().rows).toBe(6);

    resetSettings();
    await nextTick();
    expect(settings.value).toEqual(defaultSettings());
    expect(loadSettings()).toEqual(defaultSettings());
  });
});
