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
 * 注意:站点固定深色主题,本模块不涉及配色。
 * ============================================================ */
import { ref, watch, watchEffect } from 'vue';
import { CONFIG } from './config';

export interface SiteSettings {
  /** 图片墙行数(1–6) */
  rows: number;
  /** 卡片宽度 px(180–560) */
  cardWidth: number;
  /** 滚动速度倍率(0.25–3),1 = 默认 */
  speed: number;
  /** 滚动动画开关 */
  animate: boolean;
}

const LS_KEY = 'lumina.settings';

export const ROWS_RANGE = { min: 1, max: 6 } as const;
export const WIDTH_RANGE = { min: 180, max: 560 } as const;
export const SPEED_RANGE = { min: 0.25, max: 3 } as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 宽松转数字:NaN/Infinity/非数字 → fallback */
function toNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 默认值:rows/cardWidth 取 CONFIG(纯字面量),speed/animate 出厂值 */
export function defaultSettings(): SiteSettings {
  return {
    rows: clamp(Math.round(toNum(CONFIG.rows, 3)), ROWS_RANGE.min, ROWS_RANGE.max),
    cardWidth: clamp(Math.round(toNum(CONFIG.cardWidth, 300)), WIDTH_RANGE.min, WIDTH_RANGE.max),
    speed: 1,
    animate: true,
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
    rows: clamp(Math.round(toNum(o.rows, def.rows)), ROWS_RANGE.min, ROWS_RANGE.max),
    cardWidth: clamp(Math.round(toNum(o.cardWidth, def.cardWidth)), WIDTH_RANGE.min, WIDTH_RANGE.max),
    speed: clamp(toNum(o.speed, def.speed), SPEED_RANGE.min, SPEED_RANGE.max),
    animate: typeof o.animate === 'boolean' ? o.animate : def.animate,
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
  if (s.animate) delete el.dataset.anim;
  else el.dataset.anim = 'off';
}

/** main.ts 挂载前调用一次:应用当前值 + 后续变化实时应用 */
export function initSettings(): void {
  applySettings(state.settings.value);
  watchEffect(() => applySettings(state.settings.value));
}
