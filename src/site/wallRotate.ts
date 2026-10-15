/* ============================================================
 * 流动墙内容轮换 — 纯函数集(便于单测,无 Vue/DOM 依赖)
 * ------------------------------------------------------------
 * 思路:池子里图片顺序固定(RowItem.gi 始终指向池下标,灯箱依赖
 * 此下标)。墙上只放一个「登台窗口」:从池中取一段环形子集,每
 * 次轮换把窗口向前滑动 step 张 —— 转出旧图、转入新图,再由
 * HomeView 对每行重新洗牌(重排)。走完一整圈重洗池子。
 *
 * 窗口尺寸下限:
 *   - 至少「填满一屏」(否则一份内容宽 < 视口会在循环时露白),
 *     即每行 >= ceil(视口宽 / 卡片单元格) + 1
 *   - 至少池子的 WINDOW_RATIO 比例(保证单圈内多样性),但封顶 WINDOW_MAX
 *     (超大图库时 60% 可能上百张 → DOM 与预热开销过重)
 *   - 至少等于行数(每行至少一张)
 *   - 封顶 total(= total 时退化为「全量仅重排」)
 * ============================================================ */

/** 每行基准最少卡片数(循环宽度兜底) */
export const MIN_CARDS_PER_ROW = 6;
/** 登台窗口占全量池的最小比例 */
export const WINDOW_RATIO = 0.6;
/** 登台窗口张数上限(比例项封顶;填屏下限不受此限制) */
export const WINDOW_MAX = 90;
/** 每次轮换滑动比例(约换掉一半,保留一半保证连贯) */
export const STEP_RATIO = 0.5;

/**
 * 系统是否要求「减少动态效果」。命中时不自动轮换:该模式下 CSS 已关掉
 * 滚动动画,再硬切内容反而更突兀(晕动症友好)。无 matchMedia 时视为否。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 计算登台窗口张数。各参数非法值做防御性处理,结果落在 [0, total]。
 */
export function windowSize(
  total: number,
  rows: number,
  viewportWidth: number,
  cardWidth: number,
  gap: number,
): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const r = Math.max(1, Math.floor(rows) || 1);
  const cell = Math.max(1, (Number.isFinite(cardWidth) ? cardWidth : 0) + (Number.isFinite(gap) ? gap : 0));
  const vw = Number.isFinite(viewportWidth) ? Math.max(0, Math.floor(viewportWidth)) : 0;
  const fillPerRow = vw > 0 ? Math.ceil(vw / cell) + 1 : 0;
  const fill = r * Math.max(MIN_CARDS_PER_ROW, fillPerRow);
  // 比例项封顶 WINDOW_MAX(fill 项允许超出,否则大屏会露白)
  const ratio = Math.min(WINDOW_MAX, Math.ceil(total * WINDOW_RATIO));
  return Math.min(total, Math.max(r, fill, ratio));
}

/** 轮换一步的结果 */
export interface WindowStep {
  /** 本次取出的池下标(长度 = 窗口张数,环形顺序) */
  indices: number[];
  /** 前进后的游标(下次窗口起点,已取模) */
  nextCursor: number;
  /** 本次是否跨过池尾(整圈走完,调用方可重洗池子) */
  wrapped: boolean;
}

/**
 * 从固定池取出环形窗口并前进。cursor 可越界(内部取模);size 会被
 * clamp 到 [1, total]。step 缺省取窗口一半(相邻窗口重叠,画面连贯)。
 * 空池返回空结果。
 */
export function nextWindow(
  total: number,
  cursor: number,
  size: number,
  step?: number,
): WindowStep {
  if (!Number.isFinite(total) || total <= 0) {
    return { indices: [], nextCursor: 0, wrapped: false };
  }
  const s = Math.min(total, Math.max(1, Math.floor(size) || 1));
  const c = ((Math.floor(cursor) % total) + total) % total;
  const indices: number[] = [];
  for (let i = 0; i < s; i++) indices.push((c + i) % total);
  const st = step == null || !Number.isFinite(step)
    ? Math.max(1, Math.round(s * STEP_RATIO))
    : Math.max(1, Math.floor(step));
  const next = c + st;
  return { indices, nextCursor: next % total, wrapped: next >= total };
}
