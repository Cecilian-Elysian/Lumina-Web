import { describe, it, expect, beforeEach, vi } from 'vitest';

/* favorites 是模块级单例 → 每个用例 resetModules 取全新实例 */
function freshModule() {
  return import('./favorites') as Promise<typeof import('./favorites')>;
}

const LS_KEY = 'lumina.favs';

describe('useFavorites — 收藏单例', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('toggle 收藏 → 插到头部 + LS 持久化', async () => {
    const { useFavorites } = await freshModule();
    const { toggleFav, isFav, favs } = useFavorites();

    expect(toggleFav('https://a/1.jpg')).toBe(true);
    expect(isFav('https://a/1.jpg')).toBe(true);
    expect(favs.value).toEqual(['https://a/1.jpg']);
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toEqual(['https://a/1.jpg']);
  });

  it('再 toggle → 取消收藏并从 LS 移除', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(['https://a/1.jpg']));
    const { useFavorites } = await freshModule();
    const { toggleFav, isFav } = useFavorites();

    expect(isFav('https://a/1.jpg')).toBe(true);
    expect(toggleFav('https://a/1.jpg')).toBe(false);
    expect(isFav('https://a/1.jpg')).toBe(false);
    expect(JSON.parse(localStorage.getItem(LS_KEY) || '[]')).toEqual([]);
  });

  it('多条收藏保持最新在前(列表有序)', async () => {
    const { useFavorites } = await freshModule();
    const { toggleFav, favs } = useFavorites();

    toggleFav('https://a/1.jpg');
    toggleFav('https://a/2.jpg');
    toggleFav('https://a/3.jpg');
    expect(favs.value).toEqual(['https://a/3.jpg', 'https://a/2.jpg', 'https://a/1.jpg']);
  });

  it('移除中间项不乱序', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(['https://a/3.jpg', 'https://a/2.jpg', 'https://a/1.jpg']));
    const { useFavorites } = await freshModule();
    const { toggleFav, favs } = useFavorites();

    toggleFav('https://a/2.jpg');
    expect(favs.value).toEqual(['https://a/3.jpg', 'https://a/1.jpg']);
  });

  it('LS 损坏 → 空列表回退', async () => {
    localStorage.setItem(LS_KEY, '{broken json');
    const { useFavorites } = await freshModule();
    expect(useFavorites().favs.value).toEqual([]);
  });

  it('LS 非数组 → 空列表回退', async () => {
    localStorage.setItem(LS_KEY, '{"a":1}');
    const { useFavorites } = await freshModule();
    expect(useFavorites().favs.value).toEqual([]);
  });

  it('预置重复 / 非字符串项 → 去重清洗', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify([
      'https://a/1.jpg', 'https://a/1.jpg', 42, '', 'https://a/2.jpg', null,
    ]));
    const { useFavorites } = await freshModule();
    expect(useFavorites().favs.value).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
  });

  it('clearAll → 清空内存与 LS', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(['https://a/1.jpg']));
    const { useFavorites } = await freshModule();
    const { clearAll, favs, isFav } = useFavorites();

    clearAll();
    expect(favs.value).toEqual([]);
    expect(isFav('https://a/1.jpg')).toBe(false);
    expect(localStorage.getItem(LS_KEY)).toBe('[]');
  });

  it('隐私模式写入失败 → 内存状态不受影响', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { useFavorites } = await freshModule();
    const { toggleFav, isFav, favs } = useFavorites();

    expect(toggleFav('https://a/1.jpg')).toBe(true);
    expect(isFav('https://a/1.jpg')).toBe(true);
    expect(favs.value).toEqual(['https://a/1.jpg']);
  });
});
