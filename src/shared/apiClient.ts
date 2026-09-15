/* ============================================================
 * 图片列表加载 — 主页与图集页共用
 * ------------------------------------------------------------
 * 数据流:
 *   proxy 模式  → fetch /api/images(Cloudflare Pages Function 注入 token)
 *   direct 模式 → 前端直连图床(token 暴露,仅调试用)
 *   任一失败    → 回退 fallbackImages
 * ============================================================ */
import { getByPath } from './utils';
import type { Image } from './types';
import { CONFIG } from '@/site/config';

interface RawItem {
  [k: string]: unknown;
}

/** 按 CONFIG.thumbRewrite 改写缩略图 URL(失败回退原值) */
export function rewriteThumb(thumb: string): string {
  // config.ts 为纯字面量,thumbRewrite: null 会被推断为 null 类型,此处放宽
  const rule = CONFIG.thumbRewrite as string | null;
  if (!rule) return thumb;
  try {
    const sep = rule.indexOf(':');
    const mode = sep === -1 ? rule : rule.slice(0, sep);
    const arg = sep === -1 ? '' : rule.slice(sep + 1);
    if (mode === 'query') {
      const u = new URL(thumb);
      u.searchParams.set(arg, String(CONFIG.thumbWidth));
      return u.toString();
    }
    if (mode === 'replace') {
      const parts = arg.split('::');
      const from = parts[0];
      const to = parts.slice(1).join('::');
      return from ? thumb.split(from).join(to) : thumb;
    }
    if (mode === 'append') {
      return thumb + arg;
    }
    console.warn('[Lumina] 未知的 thumbRewrite 模式:', mode);
  } catch (err) {
    console.warn('[Lumina] thumbRewrite 失败,回退原 thumb:', err);
  }
  return thumb;
}

/** 把图床接口数组元素映射为统一的 Image 格式(字段路径来自 CONFIG) */
export function mapImage(item: RawItem): Image {
  const url = String(getByPath(item, CONFIG.imgUrlField) ?? '');
  const rawThumb = String(
    (CONFIG.imgThumbField && getByPath(item, CONFIG.imgThumbField)) || url,
  );
  const thumb = rewriteThumb(rawThumb);
  const name = String((CONFIG.imgNameField && getByPath(item, CONFIG.imgNameField)) || '');
  return { url, name, thumb, srcset: `${thumb} 1x, ${url} 2x` };
}

/** fallback 图片包装成统一 Image(url 与 thumb 相同,焦点/图集查表可命中) */
export function toFallbackImages(urls: string[]): Image[] {
  return urls.map((u) => ({ url: u, name: '', thumb: u, srcset: `${u} 1x, ${u} 2x` }));
}

/** 是否使用兜底图(proxy 不可达时供调用方判断,避免图集页误判) */
export function isFallback(images: Image[]): boolean {
  const fb = CONFIG.fallbackImages;
  return images.length > 0 && images.length <= fb.length &&
    images.every((it, i) => it.url === fb[i]);
}

function buildDirectHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = CONFIG.token;
  if (!token || CONFIG.authType === 'none') return headers;
  if (CONFIG.authType === 'bearer') {
    headers.Authorization = 'Bearer ' + token;
  } else if (CONFIG.authType === 'header') {
    headers[CONFIG.authKey] = CONFIG.tokenPrefix + token;
  }
  return headers;
}

/**
 * 拉取图片列表。永不 reject:上游失败时回退兜底图并返回错误信息。
 * @returns { images, error? }
 */
export async function loadImages(): Promise<{ images: Image[]; error: string | null }> {
  // 显式关闭图床 API → 直接走兜底,不发起任何网络请求
  if (CONFIG.apiDisabled) {
    return { images: toFallbackImages(CONFIG.fallbackImages), error: null };
  }

  let url: string;
  let headers: Record<string, string>;

  if (CONFIG.mode === 'proxy') {
    // &_t= 时间戳绕开浏览器/CDN 对列表的缓存
    url = '/api/images?per_page=' + CONFIG.perPage + '&_t=' + Date.now();
    headers = { Accept: 'application/json' };
  } else {
    if (!CONFIG.apiBase || !CONFIG.token) {
      return { images: toFallbackImages(CONFIG.fallbackImages), error: null };
    }
    url = CONFIG.apiBase + CONFIG.listPath + '?order=newest&per_page=' + CONFIG.perPage;
    headers = buildDirectHeaders();
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);

    const json: unknown = await res.json();
    const arr = getByPath(json, CONFIG.imgField);
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('imgField 路径 "' + CONFIG.imgField + '" 未命中数组');
    }

    const images = (arr as RawItem[])
      .map(mapImage)
      .filter((it) => it.url)
      .slice(0, CONFIG.perPage);
    if (images.length === 0) {
      throw new Error('图片 URL 字段 "' + CONFIG.imgUrlField + '" 未命中');
    }
    return { images, error: null };
  } catch (err) {
    // 静默回退:fallback 是预期行为,不打扰用户
    // 调试信息仅打到 console(DevTools 可见),不弹 banner
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Lumina] 图床加载失败:', msg, '→ 已回退兜底图。');
    return { images: toFallbackImages(CONFIG.fallbackImages), error: null };
  }
}
