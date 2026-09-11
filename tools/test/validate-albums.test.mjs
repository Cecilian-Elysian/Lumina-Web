/* ============================================================
 * 测试 validateAlbumsDoc(纯函数)
 * ============================================================ */
import { describe, it, expect } from 'vitest';
import { validateAlbumsDoc } from '../server/lib/config-reader.mjs';

describe('validateAlbumsDoc', () => {
  const validDoc = {
    _meta: [
      { id: 'abc12345', name: '德克萨斯' },
      { id: 'def67890', name: '星海拾光' },
    ],
    'https://bu.dusays.com/a.jpg': 'abc12345',
    'https://bu.dusays.com/b.jpg': 'def67890',
  };

  it('接受正常文档', () => {
    expect(() => validateAlbumsDoc(validDoc)).not.toThrow();
  });

  it('接受空 _meta + 空映射', () => {
    expect(() => validateAlbumsDoc({ _meta: [] })).not.toThrow();
  });

  it('拒绝 null', () => {
    expect(() => validateAlbumsDoc(null)).toThrow(/普通对象/);
  });

  it('拒绝数组', () => {
    expect(() => validateAlbumsDoc([])).toThrow(/普通对象/);
  });

  it('拒绝缺失 _meta', () => {
    expect(() => validateAlbumsDoc({})).toThrow(/_meta/);
  });

  it('拒绝 _meta 非数组', () => {
    expect(() => validateAlbumsDoc({ _meta: 'foo' })).toThrow(/_meta 必须是数组/);
  });

  it('拒绝 _meta[i] 非对象', () => {
    expect(() => validateAlbumsDoc({ _meta: ['foo'] })).toThrow(/必须是对象/);
  });

  it('拒绝 id 缺失', () => {
    expect(() => validateAlbumsDoc({ _meta: [{ name: 'x' }] })).toThrow(/id 必须是/);
  });

  it('拒绝 id 过长', () => {
    expect(() => validateAlbumsDoc({ _meta: [{ id: 'a'.repeat(100), name: 'x' }] })).toThrow(/1-64/);
  });

  it('拒绝 name 空字符串', () => {
    expect(() => validateAlbumsDoc({ _meta: [{ id: 'x', name: '   ' }] })).toThrow(/非空字符串/);
  });

  it('拒绝 name 缺失', () => {
    expect(() => validateAlbumsDoc({ _meta: [{ id: 'x' }] })).toThrow(/非空字符串/);
  });

  it('拒绝重复 id', () => {
    expect(() => validateAlbumsDoc({
      _meta: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }],
    })).toThrow(/重复/);
  });

  it('拒绝 url 映射到不存在的图集 id', () => {
    expect(() => validateAlbumsDoc({
      _meta: [{ id: 'a', name: 'x' }],
      'https://x.jpg': 'not_exist',
    })).toThrow(/不存在的图集/);
  });

  it('接受合法 url 映射', () => {
    expect(() => validateAlbumsDoc({
      _meta: [{ id: 'a', name: 'x' }],
      'https://x.jpg': 'a',
    })).not.toThrow();
  });

  it('接受 _meta 顺序后追加新映射', () => {
    const doc = {
      _meta: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }],
      'https://a.jpg': 'a',
      'https://b.jpg': 'b',
    };
    expect(() => validateAlbumsDoc(doc)).not.toThrow();
  });
});