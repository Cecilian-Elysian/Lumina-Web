import { describe, it, expect } from 'vitest';
import { escapeHtml, getByPath, shuffle, debounce, clamp01, fileName, formatInt } from './utils';

describe('escapeHtml', () => {
  it('转义五个危险字符', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('null/undefined 转空串', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('getByPath', () => {
  it('取嵌套值', () => {
    expect(getByPath({ a: { b: [1, 2] } }, 'a.b')).toEqual([1, 2]);
  });
  it('中途不存在返回 undefined', () => {
    expect(getByPath({}, 'a.b.c')).toBeUndefined();
  });
});

describe('shuffle', () => {
  it('保持元素集合不变', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = src.slice();
    shuffle(copy);
    expect(copy.slice().sort((a, b) => a - b)).toEqual(src);
  });
  it('单元素/空数组不抛错', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([1])).toEqual([1]);
  });
});

describe('debounce', () => {
  it('连续触发只执行最后一次', async () => {
    let n = 0;
    const fn = debounce(() => { n++; }, 10);
    fn(); fn(); fn();
    expect(n).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(n).toBe(1);
  });
});

describe('clamp01', () => {
  it('越界夹紧', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });
});

describe('fileName', () => {
  it('提取并解码文件名', () => {
    expect(fileName('https://a.b/c/%E4%B8%AD.jpg')).toBe('中.jpg');
  });
  it('decode 失败原样返回', () => {
    expect(fileName('https://a.b/c/%E0%A4%A.jpg')).toBe('%E0%A4%A.jpg');
  });
});

describe('formatInt — 千位逗号分隔', () => {
  it('基本分组', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1234)).toBe('1,234');
    expect(formatInt(1234567)).toBe('1,234,567');
  });
  it('小数向下取整,负数/非法回退 0', () => {
    expect(formatInt(12.9)).toBe('12');
    expect(formatInt(-5)).toBe('0');
    expect(formatInt('abc')).toBe('0');
    expect(formatInt(null)).toBe('0');
  });
});
