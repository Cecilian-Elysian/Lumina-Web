/* ============================================================
 * 站点偏好设置 — localStorage 驱动的访客设置
 * ------------------------------------------------------------
 * 职责:
 *   - settings 模块级单例(所有视图共享同一份,同 lbState 模式)
 *   - load/save + 逐字段校验(clamp):非法字段回退默认,合法字段保留
 *   - initSettings(): main.ts 挂载前调用一次,把设置应用到 <html>
 *       --card-w   → .card flex-basis(styles.css 已有 var 回退)
 *       data-anim  → 关动画时置 'off'(CSS 暂停 .row-track 动画)
 *
 * 注意:theme 字段驱动深/浅主题(styles.css 的 :root[data-theme] 变量组)。
 *       screensaver 子对象由 screensaver.ts / ScreensaverOverlay.vue 消费,
 *       纯组件驱动,不写 <html> 属性。
 * ============================================================ */
import { ref, watch, watchEffect } from 'vue';
import { CONFIG } from './config';

export type ThemeName = 'dark' | 'light';
export type ScreensaverOrder = 'random' | 'seq';

/** 屏保子设置(闲置自动进入 / 换图间隔 / 顺序 / Ken Burns 动效) */
export interface ScreenSaverPrefs {
  /** 闲置自动进入的分钟数(0 = 关闭,默认) */
  idleMin: number;
  /** 换图间隔秒 */
  intervalSec: number;
  /** 播放顺序(random 洗牌 / seq 顺序循环) */
  order: ScreensaverOrder;
  /** Ken Burns 缓慢缩放动效 */
  kenBurns: boolean;
}

/** 各主题的 <meta name="theme-color"> 值(浏览器地址栏配色) */
const THEME_COLOR: Record<ThemeName, string> = {
  dark: '#14161a',
  light: '#f6f7f9',
};

export interface SiteSettings {
  /** 主题(dark 深色 / light 浅色) */
  theme: ThemeName;
  /** 图片墙行数(1–6) */
  rows: number;
  /** 卡片宽度 px(180–560) */
  cardWidth: number;
  /** 滚动速度倍率(0.25–3),1 = 默认 */
  speed: number;
  /** 滚动动画开关 */
  animate: boolean;
  /** 图片墙内容自动轮换开关(定时换掉一批图 + 重排) */
  autoRotate: boolean;
  /** 轮换间隔秒(15–180) */
  rotateSec: number;
  /** 屏保模式子设置 */
  screensaver: ScreenSaverPrefs;
}

const LS_KEY = 'lumina.settings';

export const ROWS_RANGE = { min: 1, max: 6 } as const;
export const WIDTH_RANGE = { min: 180, max: 560 } as const;
export const SPEED_RANGE = { min: 0.25, max: 3 } as const;
export const SAVER_IDLE_RANGE = { min: 0, max: 30 } as const;
export const SAVER_INTERVAL_RANGE = { min: 3, max: 120 } as const;
export const ROTATE_RANGE = { min: 15, max: 180 } as const;

/** 设置页分段按钮候选值(单位:分钟 / 秒;0 = 闲置自动关闭) */
export const IDLE_CHOICES = [0, 1, 3, 5, 10] as const;
export const INTERVAL_CHOICES = [5, 10, 20, 40] as const;
/** 图片墙轮换间隔候选值(秒) */
export const ROTATE_CHOICES = [20, 30, 45, 60, 90] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 宽松转数字:NaN/Infinity/非数字 → fallback */
function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 屏保默认值:idleMin 0 = 闲置自动进入关闭 */
export function defaultSaver(): ScreenSaverPrefs {
  return { idleMin: 0, intervalSec: 10, order: 'random', kenBurns: true };
}

/** 默认值:theme 深色,rows/cardWidth 取 CONFIG(纯字面量),speed/animate 出厂值 */
export function defaultSettings(): SiteSettings {
  return {
    theme: 'dark',
    rows: clamp(Math.round(toNum(CONFIG.rows, 3)), ROWS_RANGE.min, ROWS_RANGE.max),
    cardWidth: clamp(Math.round(toNum(CONFIG.cardWidth, 300)), WIDTH_RANGE.min, WIDTH_RANGE.max),
    speed: 1,
    animate: true,
    autoRotate: true,
    rotateSec: 45,
    screensaver: defaultSaver(),
  };
}

/** 读取并校验屏保子对象;非对象整体回默认,合法字段保留 */
function loadSaver(raw: unknown): ScreenSaverPrefs {
  const def = defaultSaver();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  return {
    idleMin: clamp(Math.round(toNum(o.idleMin, def.idleMin)), SAVER_IDLE_RANGE.min, SAVER_IDLE_RANGE.max),
    intervalSec: clamp(Math.round(toNum(o.intervalSec, def.intervalSec)), SAVER_INTERVAL_RANGE.min, SAVER_INTERVAL_RANGE.max),
    order: o.order === 'seq' ? 'seq' : 'random',
    kenBurns: typeof o.kenBurns === 'boolean' ? o.kenBurns : def.kenBurns,
  };
}

/** 读取并校验 localStorage;逐字段 clamp,只丢弃非法字段 */
export function loadSettings(): SiteSettings {
  const def = defaultSettings();
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return def;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  return {
    theme: o.theme === 'light' ? 'light' : 'dark',
    rows: clamp(Math.round(toNum(o.rows, def.rows)), ROWS_RANGE.min, ROWS_RANGE.max),
    cardWidth: clamp(Math.round(toNum(o.cardWidth, def.cardWidth)), WIDTH_RANGE.min, WIDTH_RANGE.max),
    speed: clamp(toNum(o.speed, def.speed), SPEED_RANGE.min, SPEED_RANGE.max),
    animate: typeof o.animate === 'boolean' ? o.animate : def.animate,
    autoRotate: typeof o.autoRotate === 'boolean' ? o.autoRotate : def.autoRotate,
    rotateSec: clamp(Math.round(toNum(o.rotateSec, def.rotateSec)), ROTATE_RANGE.min, ROTATE_RANGE.max),
    screensaver: loadSaver(o.screensaver),
  };
}

export function saveSettings(s: SiteSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等写入失败静默忽略 */
  }
}

/* ---- 模块级单例 + 自动持久化 ---- */
const state = { settings: ref<SiteSettings>(loadSettings()) };

watch(state.settings, (s) => saveSettings(s), { deep: true });

export function useSettings() {
  return { settings: state.settings };
}

/** 恢复出厂默认(立即生效并持久化) */
export function resetSettings(): void {
  state.settings.value = defaultSettings();
}

/** 把设置写到 <html>(幂等,可在测试中直接调用) */
export function applySettings(s: SiteSettings): void {
  const el = document.documentElement;
  el.style.setProperty('--card-w', s.cardWidth + 'px');
  el.dataset.theme = s.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[s.theme]);
  if (s.animate) delete el.dataset.anim;
  else el.dataset.anim = 'off';
}

/** main.ts 挂载前调用一次:应用当前值 + 后续变化实时应用 */
export function initSettings(): void {
  applySettings(state.settings.value);
  watchEffect(() => applySettings(state.settings.value));
}
