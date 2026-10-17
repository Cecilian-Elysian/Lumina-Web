import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

/* ============================================================
 * App.vue 装配回归测试
 * ------------------------------------------------------------
 * ★ 历史事故:d98a6f2「视图按需分包」重写 App.vue 的 import 块时,
 *   误删了 Lightbox / ScreensaverOverlay 的 import(只留下一句
 *   「保持静态引入」的注释),模板里的 <Lightbox /> 却还在。
 *   生产构建下未注册组件走 resolveComponent 兜底 → 渲染成未知元素
 *   <lightbox>,静默无报错 → 线上「点任何图都没反应」,
 *   而 165 个测试 + vue-tsc 全绿(没测 App.vue,且没开 strictTemplates)。
 *
 *   本文件就是那道缺失的防线:断言这两个常驻层确实被 App 挂载。
 * ============================================================ */

/* App.vue 在模块顶层读 window.__VIEW__ 决定挂哪个视图。
 * 置 notfound(最小静态视图)让装配测试不牵出 HomeView 的网络请求。
 * 必须早于 import —— 故用动态 import 而不是顶部静态 import。 */
(window as unknown as { __VIEW__: string }).__VIEW__ = 'notfound';
const { default: App } = await import('./App.vue');

const { useLightbox } = await import('./composables');
const { showScreensaver, hideScreensaver } = await import('./screensaver');

const items = [
  { url: 'https://a/1.jpg', name: 'one' },
  { url: 'https://a/2.jpg', name: 'two' },
];

let wrapper: VueWrapper | null = null;

async function mountApp(): Promise<VueWrapper> {
  wrapper = mount(App);
  // 等 defineAsyncComponent 的视图 chunk 解析完
  await nextTick();
  await nextTick();
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('App.vue 常驻层装配', () => {
  beforeEach(() => {
    useLightbox().close();
    hideScreensaver();
  });

  /* 这条断言就是本次线上事故的回归防线:
   * App.vue 少 import Lightbox → 组件解析不到 → 恒挂 → 必挂 */
  it('灯箱已挂载:open() 后渲染出 .lightbox', async () => {
    const app = await mountApp();
    expect(app.find('.lightbox').exists()).toBe(false);

    useLightbox().open(items, 0);
    await nextTick();
    expect(app.find('.lightbox').exists()).toBe(true);
    expect(app.find('.lb-img').attributes('src')).toBe('https://a/1.jpg');
  });

  /* 同一次误删连带的第二个受害者:屏保状态机照跑,遮罩没渲染 */
  it('屏保遮罩已挂载:showScreensaver() 后渲染出 .screensaver', async () => {
    const app = await mountApp();
    expect(app.find('.screensaver').exists()).toBe(false);

    await showScreensaver();
    await nextTick();
    expect(app.find('.screensaver').exists()).toBe(true);

    hideScreensaver();
    await nextTick();
    expect(app.find('.screensaver').exists()).toBe(false);
  });

  it('导航与页脚正常渲染', async () => {
    const app = await mountApp();
    expect(app.findAll('.navbar-link')).toHaveLength(3);
    expect(app.find('.site-footer').exists()).toBe(true);
  });
});
