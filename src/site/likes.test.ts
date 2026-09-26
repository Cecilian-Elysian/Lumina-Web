import { describe, it, expect, beforeEach, vi } from 'vitest';

/* likes/composables 都是模块级单例 → 每个用例 resetModules 取全新实例,
 * 动态导入保证测试与被测代码共享同一份单例注册表 */
function freshModules() {
  return Promise.all([import('./likes'), import('./composables')]) as Promise<
    [typeof import('./likes'), typeof import('./composables')]
  >;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('useLikes — 点赞单例', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('initLikes 成功 → 计数就绪,ready=true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true, data: { likes: { 'https://a/1.jpg': 5 } } }),
    }));
    const [{ initLikes, useLikes }] = await freshModules();
    await initLikes();

    const { likeCount, ready } = useLikes();
    expect(ready.value).toBe(true);
    expect(likeCount('https://a/1.jpg')).toBe(5);
    expect(likeCount('https://a/missing.jpg')).toBe(0);
  });

  it('initLikes 失败 → ready 保持 false(UI 隐藏)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('bad url')));
    const [{ initLikes, useLikes }] = await freshModules();
    await initLikes();

    expect(useLikes().ready.value).toBe(false);
  });

  it('点赞 → 乐观 +1 → 服务端权威计数覆盖 → LS 记录', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { likes: {} } }) })
      // 服务端实际是 4 +1 = 5(验证权威覆盖乐观值 1)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { url: 'https://a/1.jpg', count: 5 } }) }));
    const [{ initLikes, useLikes }] = await freshModules();
    await initLikes();

    const { toggleLike, isLiked, likeCount } = useLikes();
    expect(toggleLike('https://a/1.jpg')).toBe(true);
    expect(isLiked('https://a/1.jpg')).toBe(true);
    expect(likeCount('https://a/1.jpg')).toBe(1); // 乐观值

    await flushMicrotasks();
    expect(likeCount('https://a/1.jpg')).toBe(5); // 服务端权威值
    expect(JSON.parse(localStorage.getItem('lumina.liked') || '[]')).toContain('https://a/1.jpg');
  });

  it('取消点赞 → delta=-1,计数回落且无负数', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { likes: { 'https://a/1.jpg': 5 } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { url: 'https://a/1.jpg', count: 6 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { url: 'https://a/1.jpg', count: 5 } }) }));
    const [{ initLikes, useLikes }] = await freshModules();
    await initLikes();

    const { toggleLike, isLiked, likeCount } = useLikes();
    toggleLike('https://a/1.jpg');
    await flushMicrotasks();
    expect(likeCount('https://a/1.jpg')).toBe(6);

    toggleLike('https://a/1.jpg');
    expect(isLiked('https://a/1.jpg')).toBe(false);
    await flushMicrotasks();
    expect(likeCount('https://a/1.jpg')).toBe(5);
  });

  it('POST 失败 → 状态回滚 + 错误横条', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { likes: { 'https://b/2.jpg': 3 } } }) })
      .mockRejectedValueOnce(new Error('network down')));
    const [{ initLikes, useLikes }, { useErrorBanner }] = await freshModules();
    await initLikes();

    const { toggleLike, isLiked, likeCount } = useLikes();
    expect(toggleLike('https://b/2.jpg')).toBe(true);
    expect(likeCount('https://b/2.jpg')).toBe(4); // 乐观值

    await flushMicrotasks();
    expect(likeCount('https://b/2.jpg')).toBe(3); // 回滚
    expect(isLiked('https://b/2.jpg')).toBe(false); // 回滚
    expect(JSON.parse(localStorage.getItem('lumina.liked') || '[]')).not.toContain('https://b/2.jpg');
    expect(useErrorBanner().msg.value).toContain('点赞失败');
  });

  it('在途请求期间重复点击被忽略(pending 去重)', async () => {
    let resolvePost!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data: { likes: {} } }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; })));
    const [{ initLikes, useLikes }] = await freshModules();
    await initLikes();

    const { toggleLike, isLiked, likeCount } = useLikes();
    expect(toggleLike('https://c/3.jpg')).toBe(true);
    expect(toggleLike('https://c/3.jpg')).toBe(false); // 在途,忽略

    resolvePost({ ok: true, json: async () => ({ status: true, data: { url: 'https://c/3.jpg', count: 1 } }) });
    await flushMicrotasks();

    expect(isLiked('https://c/3.jpg')).toBe(true);
    expect(likeCount('https://c/3.jpg')).toBe(1);
  });
});
