import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import type { Image } from '@/shared/types';

/* ── mock 图片列表 ── */
const imgs: Image[] = [
  { url: 'https://a/1.jpg', thumb: 'https://t/1.jpg', name: 'one', srcset: '' },
  { url: 'https://a/2.jpg', thumb: 'https://t/2.jpg', name: 'two', srcset: '' },
  { url: 'https://a/3.jpg', thumb: 'https://t/3.jpg', name: 'three', srcset: '' },
];

vi.mock('@/shared/apiClient', () => ({
  loadImages: vi.fn(async () => ({ images: imgs, error: null })),
}));

/* ── mock 静态数据:图集 + 标签 ── */
vi.mock('./albums', () => ({
  ALBUMS: {
    _meta: [{ id: 'al1', name: '德克萨斯' }],
    'https://a/1.jpg': 'al1',
    'https://a/2.jpg': 'al1',
  },
}));

vi.mock('./tags', () => ({
  TAGS: {
    'https://a/1.jpg': ['德克萨斯'],
    'https://a/2.jpg': ['风景'],
  },
}));

import GalleryView from './GalleryView.vue';
import { useLightbox } from './composables';

beforeEach(() => {
  localStorage.clear();
});

async function mountView() {
  const wrapper = mount(GalleryView);
  await flushPromises();
  return wrapper;
}

describe('GalleryView 图集模式', () => {
  it('按图集聚合:命名图集 + 未分组兜底', async () => {
    const wrapper = await mountView();
    const titles = wrapper.findAll('.gallery-card-title').map((w) => w.text());
    expect(titles).toEqual(['德克萨斯', '未分组']);
    expect(wrapper.text()).toContain('共 2 个图集');
    wrapper.unmount();
  });

  it('图集名命中搜索', async () => {
    const wrapper = await mountView();
    await wrapper.find('.search-input').setValue('德克萨斯');
    expect(wrapper.text()).toContain('匹配 1 / 2');
    wrapper.unmount();
  });

  it('标签命中搜索(图集名不含关键词)', async () => {
    const wrapper = await mountView();
    await wrapper.find('.search-input').setValue('风景');
    expect(wrapper.text()).toContain('匹配 1 / 2');
    wrapper.unmount();
  });

  it('卡片渲染标签 chips,点击填入搜索框', async () => {
    const wrapper = await mountView();
    const chips = wrapper.findAll('.tag-chip');
    const texts = chips.map((w) => w.text());
    expect(texts).toContain('德克萨斯');
    expect(texts).toContain('风景');

    await chips.find((w) => w.text() === '风景')!.trigger('click');
    expect((wrapper.find('.search-input').element as HTMLInputElement).value).toBe('风景');
    expect(wrapper.text()).toContain('匹配 1 / 2');
    wrapper.unmount();
  });

  it('无匹配时显示空态', async () => {
    const wrapper = await mountView();
    await wrapper.find('.search-input').setValue('不存在的词');
    expect(wrapper.text()).toContain('无匹配图集');
    wrapper.unmount();
  });
});

describe('GalleryView 全部模式(masonry)', () => {
  async function mountAll() {
    const wrapper = await mountView();
    await wrapper.findAll('.view-switch button')
      .find((w) => w.text() === '全部')!
      .trigger('click');
    return wrapper;
  }

  it('切换后渲染全部图片', async () => {
    const wrapper = await mountAll();
    expect(wrapper.findAll('.masonry-item')).toHaveLength(3);
    expect(wrapper.text()).toContain('共 3 张');
    wrapper.unmount();
  });

  it('标签搜索过滤瀑布流', async () => {
    const wrapper = await mountAll();
    await wrapper.find('.search-input').setValue('风景');
    expect(wrapper.findAll('.masonry-item')).toHaveLength(1);
    expect(wrapper.text()).toContain('匹配 1 / 3 张');
    wrapper.unmount();
  });

  it('点击图片打开灯箱(全量列表定位)', async () => {
    const wrapper = await mountAll();
    await wrapper.findAll('.masonry-item')[1].trigger('click');
    const lb = useLightbox();
    expect(lb.isOpen.value).toBe(true);
    expect(lb.items.value).toHaveLength(3);
    expect(lb.index.value).toBe(1);
    wrapper.unmount();
  });
});
