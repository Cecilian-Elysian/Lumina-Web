import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import HomeView from './HomeView.vue';
import { useSettings, defaultSettings } from './settings';
import type { Image } from '@/shared/types';

/* rAF 垫片:markLoaded 的批量提交依赖 requestAnimationFrame,
 * jsdom 无 rAF 时用 setTimeout 兜底(仅测试环境) */
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = ((cb: (t: number) => void) =>
    setTimeout(() => cb(performance.now()), 16)) as unknown as typeof window.requestAnimationFrame;
}

/* ── mock 图片列表(10 张,窗口会全量登台) ── */
const imgs: Image[] = Array.from({ length: 10 }, (_, i) => ({
  url: `https://a/${i + 1}.jpg`,
  thumb: `https://t/${i + 1}.jpg`,
  name: `img${i + 1}`,
}));

vi.mock('@/shared/apiClient', () => ({
  loadImages: vi.fn(async () => ({ images: imgs })),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('HomeView 开屏最短时长(MIN_SPLASH_MS)', () => {
  beforeEach(() => {
    localStorage.clear();
    // 关掉自动轮换:就绪后不排轮换计时,测试时序不受 rotateSec 干扰
    const { settings } = useSettings();
    settings.value = { ...defaultSettings(), autoRotate: false };
  });

  it('瞬时加载完成 → 进度条仍停留满最短时长才就绪', async () => {
    const wrapper = mount(HomeView);
    await flushMicrotasks();
    // 名单已到,进入「加载图片 X / Y」阶段;墙未就绪
    expect(wrapper.find('.wall-progress').exists()).toBe(true);
    expect(wrapper.find('.wall.ready').exists()).toBe(false);

    // 全部 @load → forceReady;但距挂载远不足 800ms → 延迟就绪
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(80); // 等 rAF 批量提交 flushLoaded
    expect(wrapper.find('.wall.ready').exists()).toBe(false);

    await sleep(900); // 越过 800ms 补足窗
    expect(wrapper.find('.wall.ready').exists()).toBe(true);
    expect(wrapper.find('.wall-progress').exists()).toBe(false);
    wrapper.unmount();
  });

  it('慢加载(超过最短时长)→ 就绪不再被额外拖慢', async () => {
    const { loadImages } = await import('@/shared/apiClient');
    vi.mocked(loadImages).mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r({ images: imgs }), 950)),
    );

    const wrapper = mount(HomeView);
    await sleep(1050); // 名单 950ms 后才到
    expect(wrapper.find('.wall-progress').exists()).toBe(true);

    // 触发加载时已超 800ms → 只等 rAF 提交即就绪,无 800ms 补足
    for (const img of wrapper.findAll('.card img')) await img.trigger('load');
    await sleep(120);
    expect(wrapper.find('.wall.ready').exists()).toBe(true);
    wrapper.unmount();
  });
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
