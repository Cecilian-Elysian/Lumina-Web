import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ScreensaverOverlay from './ScreensaverOverlay.vue';
import Lightbox from './Lightbox.vue';
import { useScreensaver } from './screensaver';
import { useLightbox } from './composables';
import { useSettings, defaultSettings, defaultSaver } from './settings';

/* Overlay 不自己拉数据/不需要真实 rAF 时序:
 *  - 屏保状态直接写单例 ref(active/current)
 *  - requestAnimationFrame stub 为同步执行 → 双 rAF 点亮立即完成 */
const saver = useScreensaver();
const lb = useLightbox();
const { settings } = useSettings();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  saver.hide();
  lb.close();
  document.body.style.overflow = '';
  settings.value = defaultSettings();
  vi.unstubAllGlobals();
});

describe('ScreensaverOverlay 渲染与淡入', () => {
  it('未激活时不渲染(v-if)', async () => {
    const wrapper = mount(ScreensaverOverlay);
    await flushPromises();
    expect(wrapper.find('.screensaver').exists()).toBe(false);
    wrapper.unmount();
  });

  it('首张:渲染到隐藏槽位后由双 rAF 点亮(从黑场淡入)', async () => {
    const wrapper = mount(ScreensaverOverlay);
    saver.active.value = true;
    await flushPromises();
    expect(wrapper.findAll('.ss-layer')).toHaveLength(0); // current 未设,无图层

    saver.current.value = 'https://a/1.jpg';
    await flushPromises(); // rAF stub 同步执行 → 点亮已完成
    const layer = wrapper.find('.ss-layer');
    expect(layer.attributes('src')).toBe('https://a/1.jpg');
    expect(layer.classes()).toContain('on');
    expect(layer.classes()).toContain('kenburns');
    wrapper.unmount();
  });

  it('换图走另一槽位交叉淡入;重入后槽位复位,重新走首张路径', async () => {
    const wrapper = mount(ScreensaverOverlay);
    saver.active.value = true;
    await flushPromises();

    saver.current.value = 'https://a/1.jpg';
    await flushPromises();
    let layers = wrapper.findAll('.ss-layer');
    expect(layers).toHaveLength(1);
    expect(layers[0].classes()).toContain('on');

    saver.current.value = 'https://a/2.jpg';
    await flushPromises();
    layers = wrapper.findAll('.ss-layer');
    expect(layers).toHaveLength(2);
    expect(layers[1].classes()).toContain('on');
    expect(layers[0].classes()).not.toContain('on');

    saver.hide(); // 退出:DOM 移除 + 槽位清空
    await flushPromises();
    expect(wrapper.find('.screensaver').exists()).toBe(false);

    saver.active.value = true; // 重入:第一张应重新走「单层 + 点亮」
    saver.current.value = 'https://a/3.jpg';
    await flushPromises();
    layers = wrapper.findAll('.ss-layer');
    expect(layers).toHaveLength(1);
    expect(layers[0].attributes('src')).toBe('https://a/3.jpg');
    expect(layers[0].classes()).toContain('on');
    wrapper.unmount();
  });

  it('缓慢缩放关闭 → kenburns 动画保留但播放状态 paused(冻结)', async () => {
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), kenBurns: false, intervalSec: 20 },
    };
    const wrapper = mount(ScreensaverOverlay);
    saver.active.value = true;
    await flushPromises();
    saver.current.value = 'https://a/1.jpg';
    await flushPromises();

    const layer = wrapper.find('.ss-layer');
    expect(layer.classes()).toContain('kenburns'); // 动画仍挂载,只是冻结
    expect(layer.attributes('style')).toContain('animation-play-state: paused');
    wrapper.unmount();
  });

  it('动画时长 = 换图间隔 + 2s 缓冲', async () => {
    settings.value = {
      ...defaultSettings(),
      screensaver: { ...defaultSaver(), intervalSec: 40 },
    };
    const wrapper = mount(ScreensaverOverlay);
    saver.active.value = true;
    await flushPromises();
    saver.current.value = 'https://a/1.jpg';
    await flushPromises();
    expect(wrapper.find('.ss-layer').attributes('style')).toContain('animation-duration: 42000ms');
    wrapper.unmount();
  });
});

describe('ScreensaverOverlay 退出与提示', () => {
  it('进入即锁滚动;800ms 内点击免疫,之后点击退出并解锁', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const wrapper = mount(ScreensaverOverlay);
      saver.active.value = true;
      await flushPromises();
      expect(document.body.style.overflow).toBe('hidden');

      window.dispatchEvent(new Event('pointerdown'));
      expect(saver.active.value).toBe(true); // 免疫期内不退出

      await vi.advanceTimersByTimeAsync(800);
      window.dispatchEvent(new Event('pointerdown'));
      expect(saver.active.value).toBe(false);
      await flushPromises(); // active 的 watcher 异步 flush 后才解锁
      expect(document.body.style.overflow).toBe('');
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('操作提示 3 秒后淡出,重入重新显示', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      const wrapper = mount(ScreensaverOverlay);
      saver.active.value = true;
      await flushPromises();
      expect(wrapper.find('.ss-hint').classes()).not.toContain('fade');

      await vi.advanceTimersByTimeAsync(3000);
      expect(wrapper.find('.ss-hint').classes()).toContain('fade');

      saver.hide();
      await flushPromises();
      saver.active.value = true;
      await flushPromises();
      expect(wrapper.find('.ss-hint').classes()).not.toContain('fade');
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('灯箱开着时屏保退出不代解滚动锁,灯箱关闭时归还', async () => {
    const lbWrapper = mount(Lightbox);
    const wrapper = mount(ScreensaverOverlay);

    saver.active.value = true;
    await flushPromises();
    expect(document.body.style.overflow).toBe('hidden');

    saver.hide(); // 灯箱没开 → 正常解锁
    await flushPromises();
    expect(document.body.style.overflow).toBe('');

    lb.open([{ url: 'https://x/1.jpg', name: 'x' }], 0); // 灯箱上锁
    await flushPromises();
    expect(document.body.style.overflow).toBe('hidden');

    saver.active.value = true;
    await flushPromises();
    saver.hide();
    await flushPromises();
    expect(document.body.style.overflow).toBe('hidden'); // 灯箱仍持有,不代解

    lb.close();
    await flushPromises();
    expect(document.body.style.overflow).toBe(''); // 灯箱关闭时归还

    wrapper.unmount();
    lbWrapper.unmount();
  });
});
