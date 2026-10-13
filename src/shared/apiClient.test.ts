import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapImage, toFallbackImages, isFallback, rewriteThumb } from './apiClient';
import { CONFIG } from '@/site/config';

describe('mapImage', () => {
  it('按 CONFIG 字段路径映射 url/thumb/name/srcset', () => {
    const item = {
      origin_name: 'a.png',
      links: {
        url: 'https://bu.dusays.com/x/a.png',
        thumbnail_url: 'https://7bu.top/thumbnails/a.png',
      },
    };
    const img = mapImage(item);
    expect(img.url).toBe('https://bu.dusays.com/x/a.png');
    expect(img.thumb).toBe('https://7bu.top/thumbnails/a.png');
    expect(img.name).toBe('a.png');
    expect(img.srcset).toBe('https://7bu.top/thumbnails/a.png 1x, https://bu.dusays.com/x/a.png 2x');
  });

  it('thumb 字段缺失时回退 url', () => {
    const img = mapImage({ links: { url: 'https://a/1.jpg' } });
    expect(img.thumb).toBe('https://a/1.jpg');
  });
});

describe('toFallbackImages / isFallback', () => {
  it('兜底图 url === thumb,可被 isFallback 识别', () => {
    // 用真实 CONFIG 兜底列表的前缀(isFallback 与 CONFIG.fallbackImages 逐位比对)
    const imgs = toFallbackImages(CONFIG.fallbackImages.slice(0, 3));
    expect(imgs[0].thumb).toBe(imgs[0].url);
    expect(isFallback(imgs)).toBe(true);
    expect(isFallback([{ url: 'https://other/9.jpg', name: '', thumb: '', srcset: '' }])).toBe(false);
  });
});

describe('rewriteThumb', () => {
  it('thumbRewrite 为 null 时原样返回', () => {
    expect(rewriteThumb('https://a/t.jpg')).toBe('https://a/t.jpg');
  });
});

/* ---- loadImages 缓存(模块级单例 → vi.resetModules + 动态 import 取新实例) ---- */

/** 构造图床三段式响应(proxy 模式,单张图片) */
function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: { data: [{ origin_name: 'a.png', links: { url: 'https://x/a.png' } }] },
    }),
  };
}

describe('loadImages 缓存', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function freshLoadImages() {
    vi.resetModules();
    const mod = await import('./apiClient');
    return mod.loadImages;
  }

  it('TTL 内复用缓存:并发+顺序调用都只发一次请求', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    await Promise.all([loadImages(), loadImages()]);
    await loadImages();
    vi.advanceTimersByTime(30_000);
    await loadImages();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期后重新请求', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    await loadImages();
    vi.advanceTimersByTime(61_000);
    await loadImages();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('失败回退兜底图时不缓存,下次进入重试', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('boom'); });
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    const first = await loadImages();
    expect(isFallback(first.images)).toBe(true);
    const second = await loadImages();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isFallback(second.images)).toBe(true);
  });

  it('proxy 模式 URL 不再携带 _t 时间戳', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const loadImages = await freshLoadImages();

    await loadImages();
    const calledWith = String(fetchMock.mock.calls[0][0]);
    expect(calledWith).toBe('/api/images?per_page=' + CONFIG.perPage);
  });
});
