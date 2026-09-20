import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTags } from './composables';

/* mock 静态标签数据(composables 从 './tags' 导入 TAGS) */
vi.mock('./tags', () => ({
  TAGS: {
    'https://a/1.jpg': ['角色', '立绘'],
    'https://a/2.jpg': ['角色', '风景'],
    'https://a/3.jpg': ['立绘'],
  },
}));

const LS_KEY = 'lumina.tags.local';

beforeEach(() => {
  localStorage.clear();
});

describe('useTags.tagsOf', () => {
  it('无覆盖时读静态 TAGS', () => {
    const { tagsOf } = useTags();
    expect(tagsOf('https://a/1.jpg')).toEqual(['角色', '立绘']);
  });

  it('无数据的 url 返回空数组', () => {
    const { tagsOf } = useTags();
    expect(tagsOf('https://a/none.jpg')).toEqual([]);
  });

  it('LS 数组覆盖静态值', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ 'https://a/1.jpg': ['新标签'] }));
    const { tagsOf } = useTags();
    expect(tagsOf('https://a/1.jpg')).toEqual(['新标签']);
  });

  it('LS null = 显式清空该图标签', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ 'https://a/1.jpg': null }));
    const { tagsOf } = useTags();
    expect(tagsOf('https://a/1.jpg')).toEqual([]);
  });

  it('非法 LS JSON → 静默回退静态数据', () => {
    localStorage.setItem(LS_KEY, '{broken');
    const { tagsOf } = useTags();
    expect(tagsOf('https://a/1.jpg')).toEqual(['角色', '立绘']);
  });
});

describe('useTags.albumTags', () => {
  it('并集按频次降序,同频次保持首次出现顺序', () => {
    const { albumTags } = useTags();
    // 角色 ×2, 立绘 ×2, 风景 ×1;角色比立绘先出现
    expect(albumTags(['https://a/1.jpg', 'https://a/2.jpg', 'https://a/3.jpg']))
      .toEqual(['角色', '立绘', '风景']);
  });

  it('空输入返回空数组', () => {
    const { albumTags } = useTags();
    expect(albumTags([])).toEqual([]);
  });
});

describe('useTags.allTags', () => {
  it('合并静态 + LS 独有键,去重降频', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      'https://a/9.jpg': ['新标签'],
      'https://a/1.jpg': null, // 清空不计
    }));
    const { allTags } = useTags();
    const tags = allTags();
    expect(tags).toContain('新标签');
    expect(tags).toContain('角色');
    expect(tags).toContain('立绘');
    expect(tags).toContain('风景');
  });
});
