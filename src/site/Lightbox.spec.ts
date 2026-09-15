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
