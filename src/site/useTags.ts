/* ============================================================
 * useTags — 图片标签
 * ------------------------------------------------------------
 * 优先级: localStorage(lumina.tags.local) > TAGS 静态数据。
 * LS 值为 string[](覆盖静态)或 null(显式清空该图全部标签)。
 * ★ 键约定与焦点/图集一致:Image.url(原图直链),不是 thumb。
 * ============================================================ */
import { TAGS } from './tags';

const LS_TAGS_KEY = 'lumina.tags.local';

/** readTagOverrides 的单条缓存:键是 LS 原始字符串。
 *  tagsOf 在渲染路径上被高频调用(图集页搜索每敲一个字,
 *  全部过滤后卡片的标签都要重查一遍 ≈ 上百次),每次 getItem + JSON.parse
 *  纯属浪费。应用内没有该键的写入者(只有 DevTools 手动改,需刷新生效),
 *  以原始串做键既能命中,也能在外部被改动时自动失效。 */
let tagOverridesCache: { raw: string; data: Record<string, string[] | null> } | null = null;

function readTagOverrides(): Record<string, string[] | null> {
  const raw = localStorage.getItem(LS_TAGS_KEY) || '';
  if (tagOverridesCache?.raw === raw) return tagOverridesCache.data;
  let data: Record<string, string[] | null> = {};
  try {
    const o: unknown = JSON.parse(raw || '{}');
    if (o && typeof o === 'object' && !Array.isArray(o)) data = o as Record<string, string[] | null>;
  } catch {
    /* 解析失败保持 {} */
  }
  tagOverridesCache = { raw, data };
  return data;
}

/** 单图标签,非法项过滤 */
function sanitizeTags(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

export function useTags() {
  /** 单图标签(静态 TAGS + LS 覆盖合并) */
  function tagsOf(url: string): string[] {
    const override = readTagOverrides()[url];
    if (override !== undefined) return sanitizeTags(override);
    return sanitizeTags((TAGS as Record<string, unknown>)[url]);
  }

  /** 多图标签并集,按出现频次降序;同频次保持首次出现顺序(Map 插入序 + 稳定排序) */
  function albumTags(urls: string[]): string[] {
    const counts = new Map<string, number>();
    for (const u of urls) {
      for (const t of tagsOf(u)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }

  return { tagsOf, albumTags };
}
