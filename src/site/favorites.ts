/* ============================================================
 * 收藏夹 — 模块级单例(同 likes.ts / settings.ts 模式)
 * ------------------------------------------------------------
 * 纯本地能力:localStorage lumina.favs(string[],键 = Image.url,
 * 与焦点/图集/标签/点赞查表约定一致)。
 *
 * - 列表有序:新收藏插到头部(展示 = 最近收藏在前)
 * - 不依赖服务端:无 ready 门控,恒可用
 * - LS 损坏 / 隐私模式写入失败 → 静默降级,不报错
 * - 展示侧由调用方与本次拉到的图片求交集(过滤图床已下架的图;
 *   LS 记录保留,图片回归后自动恢复——与图集同策略)
 * ============================================================ */
import { ref } from 'vue';

const LS_FAVS_KEY = 'lumina.favs';

function readFavs(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_FAVS_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string' && item && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeFavs(list: string[]): void {
  try {
    localStorage.setItem(LS_FAVS_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式等写入失败静默忽略(内存状态不受影响) */
  }
}

/* ---- 模块级单例状态 ---- */
const favs = ref<string[]>(readFavs());

export function useFavorites() {
  /** 是否已收藏 */
  function isFav(url: string): boolean {
    return favs.value.includes(url);
  }

  /** 收藏/取消收藏;返回操作后的收藏状态(true=已收藏) */
  function toggleFav(url: string): boolean {
    const rest = favs.value.filter((u) => u !== url);
    const wasFav = rest.length !== favs.value.length;
    if (!wasFav) rest.unshift(url); // 新收藏插到头部 = 最近在前
    favs.value = rest;
    writeFavs(rest);
    return !wasFav;
  }

  /** 清空全部收藏 */
  function clearAll(): void {
    favs.value = [];
    writeFavs([]);
  }

  return { favs, isFav, toggleFav, clearAll };
}
