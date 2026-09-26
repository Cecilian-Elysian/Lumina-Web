/* ============================================================
 * 流动墙触屏手势 — 纯函数集(便于单测,无 Vue/DOM 依赖)
 * ------------------------------------------------------------
 * 坐标系:行轨道内容渲染为双份(displayRows),CSS 动画从
 * translateX(0) → translateX(-50%) 无缝循环。手动位移叠加在
 * 外层 .row-drag 上,同样以 -50% 轨道宽度为一个视觉周期。
 * ============================================================ */

/** 一次移动采样(横向位置 px + 时间戳 ms) */
export interface MoveSample {
  x: number;
  t: number;
}

/** 拖拽判定阈值:位移超过此值(px)视为拖拽而非点按 */
export const DRAG_SLOP = 8;
/** 双击判定:两次点按间隔上限(ms) */
export const DOUBLE_TAP_MS = 300;
/** 惯性触发阈值(|v| px/ms) */
export const FLING_MIN_V = 0.15;

/**
 * 把手动位移归一化到 (-period, 0] 区间。
 * period = 轨道宽度的一半(一份内容宽)。任何位移都等价映射进
 * 一个视觉周期内,保证拖出边界时画面依然是连续内容。
 * 非法宽度(未布局完等)返回 0。
 */
export function normalizeOffset(offset: number, period: number): number {
  if (!Number.isFinite(period) || period <= 0) return 0;
  let x = offset % period;
  if (x > 0) x -= period;
  return x;
}

/**
 * 从移动采样序列估算松手瞬间速度(px/ms)。
 * 只取末尾 windowMs 窗口内的样本(首尾差/时间差);
 * 样本不足或时间倒流返回 0。
 */
export function flingVelocity(samples: MoveSample[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const cutoff = last.t - windowMs;
  // 从末尾向前找窗口内(t >= cutoff)最早的样本
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (samples[i].t < cutoff) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return (last.x - first.x) / dt;
}

/** 是否为点按:位移小且时间短(双击暂停/继续的判定基础) */
export function isTap(dragDist: number, durationMs: number, slop = DRAG_SLOP, maxMs = 250): boolean {
  return dragDist <= slop && durationMs <= maxMs;
}

/**
 * 惯性衰减一步:输入当前速度与帧间隔,返回 [新速度, 本帧位移]。
 * 衰减系数按 60fps 基准折算到实际 dt;速度低于 minV 视为停止。
 */
export function flingStep(velocity: number, dtMs: number, decay = 0.94, minV = 0.02): [number, number] {
  if (!Number.isFinite(velocity) || velocity === 0) return [0, 0];
  const step = Math.max(0.5, Math.min(4, dtMs / 16.7));
  const next = velocity * Math.pow(decay, step);
  if (Math.abs(next) < minV) return [0, 0];
  return [next, velocity * dtMs];
}
