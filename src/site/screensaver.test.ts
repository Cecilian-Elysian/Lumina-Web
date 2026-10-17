import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { advancePlaylist, shuffled } from './screensaver';

/* ── mock 图片列表 ── */
const imgs = [
  { url: 'https://a/1.jpg', thumb: 'https://t/1.jpg', name: 'one' },
  { url: 'https://a/2.jpg', thumb: 'https://t/2.jpg', name: 'two' },
  { url: 'https://a/3.jpg', thumb: 'https://t/3.jpg', name: 'three' },
];

vi.mock('@/shared/apiClient', () => ({
  loadImages: vi.fn(async () => ({ images: imgs })),
}));

/* 屏保/设置都是模块级单例 → 单例用例用 resetModules 取全新实例;
 * 纯函数(advancePlaylist/shuffled)不依赖单例状态,静态导入直接测 */
function freshModules() {
  return Promise.all([
    import('./screensaver'),
    import('./settings'),
  ]) as Promise<
    [typeof import('./screensaver'), typeof import('./settings')]
  >;
}

describe('advancePlaylist — 纯函数', () => {
  it('seq 顺序前进,到尾循环', () => {
    const list = ['a', 'b', 'c'];
    expect(advancePlaylist(list, 0, 'seq')).toEqual({ list, pos: 1, url: 'b' });
    expect(advancePlaylist(list, 2, 'seq')).toEqual({ list, pos: 0, url: 'a' });
  });

  it('random 中途前进 → 原列表 pos+1,不重洗', () => {
    const list = ['a', 'b', 'c'];
    const r = advancePlaylist(list, 0, 'random');
    expect(r.list).toBe(list); // 同一引用 = 未重洗
    expect(r.pos).toBe(1);
    expect(r.url).toBe('b');
  });

  it('random 走完一圈 → 重洗为新排列,且首项 ≠ 当前项', () => {
    const list = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 20; i++) {
      const r = advancePlaylist(list, list.length - 1, 'random');
      expect(r.pos).toBe(0);
      expect([...r.list].sort()).toEqual([...list].sort()); // 排列不变
      expect(r.list).not.toBe(list);
      expect(r.url).not.toBe(list[list.length - 1]); // 防连续重复
    }
  });

  it('单图列表走完一圈 → 原图重复播放,不崩', () => {
    const r = advancePlaylist(['only'], 0, 'random');
    expect(r.url).toBe('only');
    expect(r.pos).toBe(0);
  });
});

describe('shuffled — 洗牌', () => {
  it('返回新数组且为原列表的排列', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    const out = shuffled(list);
    expect(out).not.toBe(list);
    expect([...out].sort()).toEqual([...list].sort());
  });
});

describe('useScreensaver — 屏保单例', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(async () => {
    const [{ useScreensaver }] = await freshModules();
    useScreensaver().hide();
  });

  it('show → 激活并展示首张,hide → 复位', async () => {
    const [{ useScreensaver }] = await freshModules();
    const saver = useScreensaver();

    expect(saver.active.value).toBe(false);
    await saver.show();
    expect(saver.active.value).toBe(true);
    expect(imgs.map((i) => i.url)).toContain(saver.current.value);

    saver.hide();
    expect(saver.active.value).toBe(false);
    expect(saver.current.value).toBe('');
  });

  it('show 幂等:激活中重复调用不重建序列', async () => {
    const [{ useScreensaver }] = await freshModules();
    const saver = useScreensaver();

    await saver.show();
    const first = saver.current.value;
    await saver.show();
    expect(saver.current.value).toBe(first);
  });

  it('seq 顺序播放:间隔到达自动换图,hide 后停走', async () => {
    vi.useFakeTimers();
    try {
      const [{ useScreensaver }, { useSettings, defaultSettings, defaultSaver }] = await freshModules();
      const { settings } = useSettings();
      settings.value = {
        ...defaultSettings(),
        screensaver: { ...defaultSaver(), order: 'seq', intervalSec: 5 },
      };

      const saver = useScreensaver();
      await saver.show();
      expect(saver.current.value).toBe('https://a/1.jpg');

      await vi.advanceTimersByTimeAsync(5000);
      expect(saver.current.value).toBe('https://a/2.jpg');

      saver.hide();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(saver.current.value).toBe('');
      expect(saver.active.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useScreensaver — 边界与竞态', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('图片列表为空 → 不激活', async () => {
    const [{ showScreensaver, useScreensaver }] = await freshModules();
    const { loadImages } = await import('@/shared/apiClient');
    vi.mocked(loadImages).mockResolvedValueOnce({ images: [] });

    await showScreensaver();
    expect(useScreensaver().active.value).toBe(false);
    expect(useScreensaver().current.value).toBe('');
  });

  it('两图列表 seq 循环轮换:不重洗,首尾相接', async () => {
    const [{ showScreensaver, useScreensaver }, { useSettings, defaultSettings, defaultSaver }] =
      await freshModules();
    const { loadImages } = await import('@/shared/apiClient');
    vi.mocked(loadImages).mockResolvedValueOnce({ images: [imgs[0], imgs[1]] });
    const { settings } = useSettings();
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), order: 'seq', intervalSec: 5 },
    };

    vi.useFakeTimers();
    try {
      const saver = useScreensaver();
      await showScreensaver();
      expect(saver.current.value).toBe('https://a/1.jpg');

      await vi.advanceTimersByTimeAsync(5000);
      expect(saver.current.value).toBe('https://a/2.jpg');

      await vi.advanceTimersByTimeAsync(5000);
      expect(saver.current.value).toBe('https://a/1.jpg');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hide 使在途 show 作废(加载完成前退出 → 不激活)', async () => {
    const [{ showScreensaver, hideScreensaver, useScreensaver }] = await freshModules();
    const { loadImages } = await import('@/shared/apiClient');
    let resolveLoad!: (v: { images: typeof imgs }) => void;
    vi.mocked(loadImages).mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }),
    );

    const pending = showScreensaver(); // 挂在图片加载上
    hideScreensaver();                 // 加载完成前退出
    resolveLoad({ images: imgs });
    await pending;

    expect(useScreensaver().active.value).toBe(false);
    expect(useScreensaver().current.value).toBe('');
  });
});

describe('initScreensaver — 闲置自动进入', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const [{ useScreensaver }] = await freshModules();
    useScreensaver().hide();
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  it('idleMin=1 → 闲置 1 分钟后自动进入', async () => {
    const [{ initScreensaver, useScreensaver }, { useSettings, defaultSettings, defaultSaver }] = await freshModules();
    const { settings } = useSettings();
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), idleMin: 1 },
    };

    initScreensaver();
    expect(useScreensaver().active.value).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(useScreensaver().active.value).toBe(true);
  });

  it('交互重置闲置计时', async () => {
    const [{ initScreensaver, useScreensaver }, { useSettings, defaultSettings, defaultSaver }] = await freshModules();
    const { settings } = useSettings();
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), idleMin: 1 },
    };

    initScreensaver();
    await vi.advanceTimersByTimeAsync(50_000);
    window.dispatchEvent(new Event('pointermove'));
    await vi.advanceTimersByTimeAsync(50_000); // 若未重置早已触发
    expect(useScreensaver().active.value).toBe(false);
  });

  it('idleMin=0(默认关)→ 永不自动进入', async () => {
    const [{ initScreensaver, useScreensaver }] = await freshModules();
    initScreensaver();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(useScreensaver().active.value).toBe(false);
  });

  it('激活期间交互不排闲置计时,hide 后无残留自动进入', async () => {
    const [{ initScreensaver, useScreensaver, showScreensaver, hideScreensaver }, { useSettings, defaultSettings, defaultSaver }] = await freshModules();
    const { settings } = useSettings();
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), idleMin: 1 },
    };

    initScreensaver();
    await showScreensaver();
    window.dispatchEvent(new Event('pointerdown'));
    hideScreensaver();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(useScreensaver().active.value).toBe(false);
  });

  it('URL 直达 ?screensaver=1 → 列表加载完自动激活', async () => {
    history.replaceState(null, '', '/?screensaver=1');
    try {
      const [{ initScreensaver, useScreensaver }, { useSettings, defaultSettings, defaultSaver }] =
        await freshModules();
      const { settings } = useSettings();
      settings.value = {
        ...defaultSettings(),
        screensaver: { ...defaultSaver(), order: 'seq' }, // 固定顺序,断言首张可预测
      };
      initScreensaver();
      await vi.advanceTimersByTimeAsync(0); // 冲刷 loadImages 微任务
      expect(useScreensaver().active.value).toBe(true);
      expect(useScreensaver().current.value).toBe('https://a/1.jpg');
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('URL 直达仅认 screensaver=1(=0 不触发)', async () => {
    history.replaceState(null, '', '/?screensaver=0');
    try {
      const [{ initScreensaver, useScreensaver }] = await freshModules();
      initScreensaver();
      await vi.advanceTimersByTimeAsync(0);
      expect(useScreensaver().active.value).toBe(false);
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('后台标签页隐藏时跳过换图,回前台恢复', async () => {
    const [{ initScreensaver, showScreensaver, useScreensaver }, { useSettings, defaultSettings, defaultSaver }] =
      await freshModules();
    const { settings } = useSettings();
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), order: 'seq', intervalSec: 5 },
    };
    initScreensaver();
    await showScreensaver();

    const setHidden = (v: boolean) =>
      Object.defineProperty(document, 'hidden', { value: v, configurable: true });
    setHidden(true);
    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(useScreensaver().current.value).toBe('https://a/1.jpg'); // 隐藏:未换图

      setHidden(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(useScreensaver().current.value).toBe('https://a/2.jpg'); // 回前台:恢复
    } finally {
      setHidden(false);
    }
  });
});

describe('reportBrokenImage — 坏图跳过', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(async () => {
    const [{ useScreensaver }] = await freshModules();
    useScreensaver().hide();
  });

  it('当前图加载失败 → 不等间隔立即跳下一张', async () => {
    vi.useFakeTimers();
    try {
      const [{ showScreensaver, useScreensaver, reportBrokenImage }, { useSettings, defaultSettings, defaultSaver }] =
        await freshModules();
      const { settings } = useSettings();
      settings.value = {
        ...defaultSettings(),
        screensaver: { ...defaultSaver(), order: 'seq', intervalSec: 60 },
      };

      const saver = useScreensaver();
      await showScreensaver();
      expect(saver.current.value).toBe('https://a/1.jpg');

      reportBrokenImage('https://a/1.jpg');
      await vi.advanceTimersByTimeAsync(0);
      expect(saver.current.value).toBe('https://a/2.jpg');
    } finally {
      vi.useRealTimers();
    }
  });

  it('已登记的坏图在后续换图时被跳过', async () => {
    vi.useFakeTimers();
    try {
      const [{ showScreensaver, useScreensaver, reportBrokenImage }, { useSettings, defaultSettings, defaultSaver }] =
        await freshModules();
      const { settings } = useSettings();
      settings.value = {
        ...defaultSettings(),
        screensaver: { ...defaultSaver(), order: 'seq', intervalSec: 5 },
      };

      const saver = useScreensaver();
      await showScreensaver();
      expect(saver.current.value).toBe('https://a/1.jpg');

      reportBrokenImage('https://a/2.jpg'); // 非当前图:只登记
      expect(saver.current.value).toBe('https://a/1.jpg');

      await vi.advanceTimersByTimeAsync(5000);
      expect(saver.current.value).toBe('https://a/3.jpg'); // 跳过坏的 2
    } finally {
      vi.useRealTimers();
    }
  });

  it('整条列表全坏 → 退出屏保(防死循环)', async () => {
    const [{ showScreensaver, useScreensaver, reportBrokenImage }] = await freshModules();
    const { loadImages } = await import('@/shared/apiClient');
    vi.mocked(loadImages).mockResolvedValueOnce({ images: [imgs[0], imgs[1]] });

    const saver = useScreensaver();
    await showScreensaver();
    expect(saver.current.value).toBe('https://a/1.jpg');

    reportBrokenImage('https://a/1.jpg'); // 1 坏 → 跳到 2
    expect(saver.current.value).toBe('https://a/2.jpg');

    reportBrokenImage('https://a/2.jpg'); // 2 也坏 → 无图可放
    expect(saver.active.value).toBe(false);
    expect(saver.current.value).toBe('');
  });

  it('hide 后重新 show 清空坏图登记(上次的坏图重新参与播放)', async () => {
    vi.useFakeTimers();
    try {
      const [{ showScreensaver, useScreensaver, reportBrokenImage, hideScreensaver }, { useSettings, defaultSettings, defaultSaver }] =
        await freshModules();
      const { settings } = useSettings();
      settings.value = {
        ...defaultSettings(),
        screensaver: { ...defaultSaver(), order: 'seq', intervalSec: 5 },
      };

      const saver = useScreensaver();
      await showScreensaver();
      reportBrokenImage('https://a/2.jpg');
      await vi.advanceTimersByTimeAsync(5000);
      expect(saver.current.value).toBe('https://a/3.jpg'); // 上次会话:2 被跳过

      hideScreensaver();
      await showScreensaver(); // 新会话
      expect(saver.current.value).toBe('https://a/1.jpg');
      await vi.advanceTimersByTimeAsync(5000);
      expect(saver.current.value).toBe('https://a/2.jpg'); // 登记已清空:2 回归
    } finally {
      vi.useRealTimers();
    }
  });
});
