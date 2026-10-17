import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { Image } from '@/shared/types';

/* ── mock 图片列表 ── */
const imgs: Image[] = [
  { url: 'https://a/1.jpg', thumb: 'https://t/1.jpg', name: 'one' },
  { url: 'https://a/2.jpg', thumb: 'https://t/2.jpg', name: 'two' },
  { url: 'https://a/3.jpg', thumb: 'https://t/3.jpg', name: 'three' },
];

vi.mock('@/shared/apiClient', async () => {
  const { CONFIG } = await import('@/site/config');
  return {
    loadImages: vi.fn(async () => ({ images: imgs, error: null })),
    /* 与真实实现同逻辑:列表恰好等于 CONFIG.fallbackImages 即视为回退态 */
    isFallback: (list: Image[]) => {
      const fb = CONFIG.fallbackImages;
      return list.length > 0 && list.length <= fb.length &&
        list.every((it, i) => it.url === fb[i]);
    },
  };
});

import SettingsView from './SettingsView.vue';
import { useLightbox } from './composables';
import { useScreensaver } from './screensaver';
import { useFavorites } from './favorites';
import { flushSettingsSave, resetSettings } from './settings';

const SETTINGS_KEY = 'lumina.settings';
const FAVS_KEY = 'lumina.favs';

beforeEach(() => {
  localStorage.clear();
  resetSettings();
  useFavorites().clearAll(); // 收藏是模块级单例,用 API 复位(改 LS 不影响已加载的 ref)
});

afterEach(() => {
  useScreensaver().hide();
});

async function mountView() {
  const wrapper = mount(SettingsView);
  await flushPromises();
  return wrapper;
}

describe('SettingsView 我的收藏', () => {
  it('空收藏 → 空态文案,无操作按钮', async () => {
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('还没有收藏');
    expect(wrapper.find('.favs-actions').exists()).toBe(false);
    expect(wrapper.find('.favs-strip').exists()).toBe(false);
    wrapper.unmount();
  });

  it('有收藏 → 计数 + 预览条,「查看全部」开灯箱(收藏列表,最新在前)', async () => {
    const favs = useFavorites();
    favs.toggleFav('https://a/1.jpg');
    favs.toggleFav('https://a/3.jpg');
    const wrapper = await mountView();

    expect(wrapper.find('.favs-count').text()).toBe('2 张');
    expect(wrapper.findAll('.favs-thumb')).toHaveLength(2);
    /* 注:焦点定位经 :style 注入 --focal-x/y,jsdom 的 CSSOM 不支持自定义属性,
     * 无法在 DOM 上断言,绑定正确性由 typecheck + focalStyle 单测保障 */

    await wrapper.find('.favs-actions .favs-btn').trigger('click');
    const lb = useLightbox();
    expect(lb.isOpen.value).toBe(true);
    expect(lb.items.value).toHaveLength(2);
    expect(lb.items.value[0]).toEqual({ url: 'https://a/3.jpg', name: 'three' });
    lb.close();
    wrapper.unmount();
  });

  it('图床失败回退兜底图 → 收藏区提示加载失败而非「还没有收藏」', async () => {
    useFavorites().toggleFav('https://a/1.jpg'); // 明明有收藏
    const { loadImages } = await import('@/shared/apiClient');
    const { CONFIG } = await import('@/site/config');
    const fbImgs: Image[] = CONFIG.fallbackImages.map((u) => ({
      url: u, name: '', thumb: u,
    }));
    vi.mocked(loadImages).mockResolvedValueOnce({ images: fbImgs, error: null });

    const wrapper = await mountView();
    expect(wrapper.text()).toContain('图片列表加载失败');
    expect(wrapper.text()).not.toContain('还没有收藏');
    wrapper.unmount();
  });

  it('已下架图片自动过滤(LS 保留)', async () => {
    const favs = useFavorites();
    favs.toggleFav('https://a/1.jpg');
    favs.toggleFav('https://gone/9.jpg');
    const wrapper = await mountView();
    expect(wrapper.find('.favs-count').text()).toBe('1 张');
    expect(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]')).toEqual(['https://gone/9.jpg', 'https://a/1.jpg']);
    wrapper.unmount();
  });

  it('清空收藏需两击确认,误触不清', async () => {
    useFavorites().toggleFav('https://a/1.jpg');
    const wrapper = await mountView();
    const clearBtn = wrapper.findAll('.favs-actions .favs-btn')[1];

    await clearBtn.trigger('click');
    expect(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]')).toEqual(['https://a/1.jpg']);
    expect(clearBtn.text()).toContain('再点一次确认');

    await clearBtn.trigger('click');
    expect(localStorage.getItem(FAVS_KEY)).toBe('[]');
    wrapper.unmount();
  });

  it('点击预览缩略图 → 灯箱定位到该图', async () => {
    const favs = useFavorites();
    favs.toggleFav('https://a/1.jpg');
    favs.toggleFav('https://a/3.jpg');
    const wrapper = await mountView();
    await wrapper.findAll('.favs-thumb')[1].trigger('click');
    const lb = useLightbox();
    expect(lb.isOpen.value).toBe(true);
    expect(lb.index.value).toBe(1);
    expect(lb.current.value?.url).toBe('https://a/1.jpg');
    lb.close();
    wrapper.unmount();
  });
});

describe('SettingsView 屏保', () => {
  it('「立即进入」→ 屏保激活', async () => {
    const wrapper = await mountView();
    await wrapper.find('.favs-btn.enter').trigger('click');
    await flushPromises();
    expect(useScreensaver().active.value).toBe(true);
    wrapper.unmount();
  });

  it('闲置分段按钮写回 settings 并持久化', async () => {
    const wrapper = await mountView();
    const idleGroup = wrapper.find('[aria-labelledby="set-saver-idle-label"]');
    const fiveMin = idleGroup.findAll('button').find((b) => b.text() === '5 分')!;
    await fiveMin.trigger('click');
    await nextTick();
    flushSettingsSave(); // 持久化有 250ms 防抖,测试里直接冲刷

    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    expect(saved.screensaver.idleMin).toBe(5);
    expect(fiveMin.classes()).toContain('active');
    wrapper.unmount();
  });

  it('间隔 / 顺序 / 缩放均渲染为四组控件', async () => {
    const wrapper = await mountView();
    expect(wrapper.text()).toContain('换图间隔');
    expect(wrapper.text()).toContain('播放顺序');
    expect(wrapper.text()).toContain('缓慢缩放');
    expect(wrapper.text()).toContain('任意点击、按键或滚轮退出屏保');
    wrapper.unmount();
  });
});
