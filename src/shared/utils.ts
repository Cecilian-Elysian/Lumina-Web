/* ============================================================
 * 共享工具 — 纯函数,无副作用(site 与 manager 通用)
 * ============================================================ */

/** HTML 转义,防 XSS(插值场景下 Vue 模板已自动转义,此函数用于拼 title/URL 等属性的场景) */
export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 按点分路径取值,如 getByPath({a:{b:[1,2]}}, 'a.b') → [1,2];取不到返回 undefined */
export function getByPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((cur, key) => {
      if (cur == null) return undefined;
      return (cur as Record<string, unknown>)[key];
    }, obj);
}

/** Fisher-Yates 原地洗牌,返回同一引用 */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 防抖:连续触发只在最后一次 wait 毫秒后执行 */
export function debounce<F extends (...args: never[]) => void>(fn: F, wait: number): (...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 数值夹紧到 [0,1] */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

/** 从 URL 提取文件名(decode 失败时返回未解码的最后一段) */
export function fileName(url: string): string {
  const seg = (url || '').split('/').pop() || '';
  try {
    return decodeURIComponent(seg) || seg;
  } catch {
    return seg;
  }
}

/** 千位逗号分隔(页脚统计/点赞数展示用;非法值返回 '0') */
export function formatInt(v: unknown): string {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n.toLocaleString('en-US') : '0';
}
