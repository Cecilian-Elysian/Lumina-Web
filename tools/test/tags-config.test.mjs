/* ============================================================
 * 测试 tags 文档清洗/校验 与 config 白名单合并(全部纯函数)
 * ============================================================ */
import { describe, it, expect } from 'vitest';

import {
  sanitizeTagsDoc,
  validateTagsDoc,
  validateConfigPatch,
  mergeConfigPatch,
  CONFIG_WRITE_WHITELIST,
  safeParseObject,
} from '../server/lib/config-reader.mjs';

describe('sanitizeTagsDoc', () => {
  it('清洗:去空白、去空 tag、去重,url 字典序排序', () => {
    const { doc, tagCount } = sanitizeTagsDoc({
      'https://b/2.jpg': [' 立绘 ', '立绘', '', '角色'],
      'https://a/1.jpg': ['德克萨斯'],
    });
    expect(Object.keys(doc)).toEqual(['https://a/1.jpg', 'https://b/2.jpg']);
    expect(doc['https://a/1.jpg']).toEqual(['德克萨斯']);
    expect(doc['https://b/2.jpg']).toEqual(['立绘', '角色']);
    expect(tagCount).toBe(3);
  });

  it('拒绝非对象文档', () => {
    expect(() => sanitizeTagsDoc([['a']])).toThrow(/普通对象/);
    expect(() => sanitizeTagsDoc(null)).toThrow(/普通对象/);
  });

  it('拒绝非数组标签值', () => {
    expect(() => sanitizeTagsDoc({ 'https://a/1.jpg': '角色' })).toThrow(/必须是数组/);
  });

  it('拒绝非字符串标签', () => {
    expect(() => sanitizeTagsDoc({ 'https://a/1.jpg': [42] })).toThrow(/非字符串标签/);
  });

  it('拒绝超长标签(>32 字符)', () => {
    expect(() => sanitizeTagsDoc({ 'https://a/1.jpg': ['x'.repeat(33)] })).toThrow(/过长/);
  });

  it('拒绝非字符串键', () => {
    expect(() => sanitizeTagsDoc({ '': ['a'] })).toThrow(/非空字符串/);
  });
});

describe('validateTagsDoc', () => {
  it('合法文档通过', () => {
    expect(() => validateTagsDoc({ 'https://a/1.jpg': ['角色'] })).not.toThrow();
  });

  it('空文档拒绝(防误操作清库)', () => {
    expect(() => validateTagsDoc({})).toThrow(/为空/);
  });
});

describe('validateConfigPatch', () => {
  it('合法 patch 通过', () => {
    expect(() => validateConfigPatch({ rows: 3, cardWidth: 300, perPage: 100, thumbWidth: null, lazyRootMargin: '200px' })).not.toThrow();
    expect(() => validateConfigPatch({ rows: 5 })).not.toThrow();
  });

  it('拒绝空 patch / 非对象', () => {
    expect(() => validateConfigPatch({})).toThrow(/至少包含一个字段/);
    expect(() => validateConfigPatch(null)).toThrow(/普通对象/);
    expect(() => validateConfigPatch([1])).toThrow(/普通对象/);
  });

  it('拒绝白名单外字段(含 mode/token 等敏感键)', () => {
    for (const key of ['mode', 'token', 'apiBase', 'imgField', 'fallbackImages', '__proto__']) {
      expect(() => validateConfigPatch({ [key]: 'x' })).toThrow(/不允许修改的字段/);
    }
  });

  it('数值字段必须整数且在范围内', () => {
    expect(() => validateConfigPatch({ rows: 2.5 })).toThrow(/整数/);
    expect(() => validateConfigPatch({ rows: 0 })).toThrow(/范围/);
    expect(() => validateConfigPatch({ rows: 11 })).toThrow(/范围/);
    expect(() => validateConfigPatch({ cardWidth: 100 })).toThrow(/范围/);
    expect(() => validateConfigPatch({ cardWidth: 601 })).toThrow(/范围/);
    expect(() => validateConfigPatch({ perPage: 201 })).toThrow(/范围/);
  });

  it('thumbWidth 接受 100–2000 整数或 null', () => {
    expect(() => validateConfigPatch({ thumbWidth: 600 })).not.toThrow();
    expect(() => validateConfigPatch({ thumbWidth: null })).not.toThrow();
    expect(() => validateConfigPatch({ thumbWidth: 50 })).toThrow(/thumbWidth/);
    expect(() => validateConfigPatch({ thumbWidth: 'abc' })).toThrow(/thumbWidth/);
  });

  it('lazyRootMargin 必须形如 "200px"', () => {
    expect(() => validateConfigPatch({ lazyRootMargin: '200px' })).not.toThrow();
    expect(() => validateConfigPatch({ lazyRootMargin: '200' })).toThrow(/lazyRootMargin/);
    expect(() => validateConfigPatch({ lazyRootMargin: 200 })).toThrow(/lazyRootMargin/);
  });

  it('白名单完整(与设计一致)', () => {
    expect(CONFIG_WRITE_WHITELIST).toEqual([
      'rows', 'cardWidth', 'perPage', 'thumbWidth', 'lazyRootMargin',
    ]);
  });
});

describe('mergeConfigPatch', () => {
  it('保留白名单外字段(敏感键不漂移),patch 覆盖白名单键', () => {
    const current = {
      mode: 'proxy', token: 'secret', apiDisabled: false,
      rows: 3, cardWidth: 300, perPage: 100,
      imgField: 'data.data', fallbackImages: ['https://a/1.jpg'],
    };
    const merged = mergeConfigPatch(current, { rows: 5, cardWidth: 420 });
    expect(merged.rows).toBe(5);
    expect(merged.cardWidth).toBe(420);
    expect(merged.mode).toBe('proxy');
    expect(merged.token).toBe('secret');
    expect(merged.apiDisabled).toBe(false);
    expect(merged.imgField).toBe('data.data');
    expect(merged.fallbackImages).toEqual(['https://a/1.jpg']);
    // 不改原对象
    expect(current.rows).toBe(3);
  });
});

describe('真实数据文件可解析', () => {
  it('解析当前 viewer 的 tags.ts(TAGS)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const tagsPath = path.resolve(__dirname, '..', '..', 'src', 'site', 'tags.ts');
    const raw = await fs.readFile(tagsPath, 'utf8');
    const tags = safeParseObject(raw, 'TAGS');
    expect(typeof tags).toBe('object');
    expect(tags).not.toBeNull();
    // 值必须是 string[](若已有数据)
    for (const [url, arr] of Object.entries(tags)) {
      expect(typeof url).toBe('string');
      expect(Array.isArray(arr)).toBe(true);
    }
  });
});
