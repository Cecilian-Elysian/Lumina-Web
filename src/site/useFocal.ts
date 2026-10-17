/* ============================================================
 * useFocal — 焦点样式
 * ------------------------------------------------------------
 * ★ 键约定:FOCAL_POINTS 的键 = Image.url(原图直链)。
 *   旧版曾用 img.src(thumb 域)查表导致焦点 100% 失效,
 *   现改为在模板里 :style 绑定,键来源唯一(url),类型可查。
 * ============================================================ */
import type { CSSProperties } from 'vue';
import { FOCAL_POINTS } from './focalPoints';

export function useFocal() {
  const store = FOCAL_POINTS as Record<string, { x: number; y: number }>;

  /** 返回给定图片的 object-position CSS 变量;无数据返回空对象(回退 CSS 默认 50%/25%) */
  function focalStyle(url: string): CSSProperties {
    const p = store[url];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return {};
    return {
      '--focal-x': (p.x * 100).toFixed(2) + '%',
      '--focal-y': (p.y * 100).toFixed(2) + '%',
    } as CSSProperties;
  }

  return { focalStyle };
}
