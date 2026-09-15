import { describe, it, expect } from 'vitest';
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
