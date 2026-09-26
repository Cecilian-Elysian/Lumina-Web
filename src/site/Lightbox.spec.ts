import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Lightbox from './Lightbox.vue';
import { useLightbox } from './composables';

const items = [
  { url: 'https://a/1.jpg', name: 'one' },
  { url: 'https://a/2.jpg', name: 'two' },
  { url: 'https://a/3.jpg', name: 'three' },
];

describe('Lightbox 组件', () => {
  const lb = useLightbox();

  beforeEach(() => {
    lb.close();
  });

  it('默认关闭时不渲染', () => {
    const wrapper = mount(Lightbox);
    expect(wrapper.find('.lightbox').exists()).toBe(false);
    wrapper.unmount();
  });

  it('open(list, 1) 显示第 2 张与计数', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 1);
    await nextTick();

    expect(wrapper.find('.lightbox').exists()).toBe(true);
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/2.jpg');
    expect(wrapper.text()).toContain('2 / 3');
    expect(wrapper.text()).toContain('two');
    wrapper.unmount();
  });

  it('next() 循环到第一张,prev() 循环到最后一张', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 2);
    await nextTick();

    lb.next();
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/1.jpg');

    lb.prev();
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/3.jpg');
    wrapper.unmount();
  });

  it('键盘 → 切换,Esc 关闭', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/2.jpg');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(wrapper.find('.lightbox').exists()).toBe(false);
    wrapper.unmount();
  });

  it('点击遮罩关闭,点击图片不关闭', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();

    await wrapper.find('.lightbox').trigger('click');
    expect(wrapper.find('.lightbox').exists()).toBe(false);

    lb.open(items, 0);
    await nextTick();
    await wrapper.find('.lb-img').trigger('click');
    expect(wrapper.find('.lightbox').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('Lightbox 缩放', () => {
  const lb = useLightbox();

  beforeEach(() => {
    lb.close();
  });

  it('+ / - / 0 键缩放并夹紧范围', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    expect(lb.scale.value).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(lb.scale.value).toBe(1.25);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    expect(lb.scale.value).toBe(1);

    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    }
    expect(lb.scale.value).toBe(4); // max

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    expect(lb.scale.value).toBe(3.75);
    wrapper.unmount();
  });

  it('换图与关闭后缩放复位', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    lb.zoomBy(1.5);
    expect(lb.scale.value).toBe(2.5);

    lb.next();
    expect(lb.scale.value).toBe(1);

    lb.zoomBy(1.5);
    lb.close();
    lb.open(items, 0);
    expect(lb.scale.value).toBe(1);
    wrapper.unmount();
  });
});

/* ---- 触屏手势 ----
 * jsdom 的 PointerEvent 可用性不稳定,直接派发带坐标属性的
 * 通用 Event(组件只读 pointerId/pointerType/clientX/clientY) */
function firePointer(
  el: Element,
  type: string,
  opts: { x: number; y: number; id?: number; pointerType?: string },
) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'pointerId', { value: opts.id ?? 1 });
  Object.defineProperty(ev, 'pointerType', { value: opts.pointerType ?? 'touch' });
  Object.defineProperty(ev, 'clientX', { value: opts.x });
  Object.defineProperty(ev, 'clientY', { value: opts.y });
  el.dispatchEvent(ev);
}

describe('Lightbox 触屏手势', () => {
  const lb = useLightbox();

  beforeEach(() => {
    lb.close();
  });

  it('左滑 → 下一张,右滑 → 上一张', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    const stage = wrapper.find('.lb-stage').element;

    firePointer(stage, 'pointerdown', { x: 200, y: 150 });
    firePointer(stage, 'pointermove', { x: 150, y: 150 });
    firePointer(stage, 'pointerup', { x: 130, y: 150 });
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/2.jpg');

    firePointer(stage, 'pointerdown', { x: 100, y: 150 });
    firePointer(stage, 'pointermove', { x: 150, y: 150 });
    firePointer(stage, 'pointerup', { x: 180, y: 150 });
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/1.jpg');
    wrapper.unmount();
  });

  it('小位移慢滑不切图', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    const stage = wrapper.find('.lb-stage').element;

    firePointer(stage, 'pointerdown', { x: 200, y: 150 });
    firePointer(stage, 'pointermove', { x: 190, y: 150 });
    firePointer(stage, 'pointerup', { x: 185, y: 150 });
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/1.jpg');
    wrapper.unmount();
  });

  it('纵向滑动不切图', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    const stage = wrapper.find('.lb-stage').element;

    firePointer(stage, 'pointerdown', { x: 150, y: 100 });
    firePointer(stage, 'pointermove', { x: 150, y: 180 });
    firePointer(stage, 'pointerup', { x: 150, y: 220 });
    await nextTick();
    expect(wrapper.find('.lb-img').attributes('src')).toBe('https://a/1.jpg');
    wrapper.unmount();
  });

  it('双指 pinch 拉开 → 放大,双指中心平移跟随', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    const stage = wrapper.find('.lb-stage').element;

    firePointer(stage, 'pointerdown', { id: 1, x: 100, y: 100 });
    firePointer(stage, 'pointerdown', { id: 2, x: 140, y: 100 }); // 基准距离 40
    firePointer(stage, 'pointermove', { id: 2, x: 180, y: 100 }); // 距离 80 → 2x
    expect(lb.scale.value).toBe(2);
    expect(lb.tx.value).toBe(20); // 双指中点 120 → 140
    wrapper.unmount();
  });

  it('放大后单指平移仍可用', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    lb.zoomBy(1); // 2x
    const stage = wrapper.find('.lb-stage').element;

    firePointer(stage, 'pointerdown', { x: 100, y: 100 });
    firePointer(stage, 'pointermove', { x: 130, y: 120 });
    expect(lb.tx.value).toBe(30);
    expect(lb.ty.value).toBe(20);
    firePointer(stage, 'pointerup', { x: 130, y: 120 });
    expect(lb.scale.value).toBe(2); // 平移不改缩放
    wrapper.unmount();
  });

  it('双击(两次快点点按)放大 1 → 2.5', async () => {
    const wrapper = mount(Lightbox);
    lb.open(items, 0);
    await nextTick();
    const stage = wrapper.find('.lb-stage').element;

    firePointer(stage, 'pointerdown', { x: 100, y: 100 });
    firePointer(stage, 'pointerup', { x: 100, y: 100 });
    firePointer(stage, 'pointerdown', { x: 102, y: 101 });
    firePointer(stage, 'pointerup', { x: 102, y: 101 });
    await nextTick();
    expect(lb.scale.value).toBe(2.5);
    wrapper.unmount();
  });
});
