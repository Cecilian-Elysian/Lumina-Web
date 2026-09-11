/* ============================================================
 * 测试 safeParseObject 的安全性
 * ------------------------------------------------------------
 * 关键点:任何含非字面量的输入必须抛错且绝不执行副作用。
 * ============================================================ */
import { describe, it, expect } from 'vitest';

// 我们需要导入 safeParseObject,但它没导出。
// 为了测试它,临时暴露的方式:读 config-reader.mjs 后用 acorn eval?
// 不行,测试本身不能用 eval。
//
// 方案:在 config-reader.mjs 中单独导出 safeParseObject 仅供测试。
// 这里通过一个"暴露导出文件"导入。
import { safeParseObject } from '../server/lib/config-reader.mjs';

describe('safeParseObject', () => {
  it('解析普通对象字面量', () => {
    const out = safeParseObject('const CONFIG = { a: 1, b: "x", c: true, d: null };', 'CONFIG');
    expect(out).toEqual({ a: 1, b: 'x', c: true, d: null });
  });

  it('解析 window.NAME 赋值', () => {
    const out = safeParseObject('window.ALBUMS = { _meta: [], "url1": "id1" };', 'ALBUMS');
    expect(out).toEqual({ _meta: [], url1: 'id1' });
  });

  it('解析裸 ObjectExpression(无 varName)', () => {
    // 注意:JS 里 `{` 在语句开头会被当成 block,需包成表达式 `({...})`
    const out = safeParseObject('({ foo: 1, bar: [1,2,3] });');
    expect(out).toEqual({ foo: 1, bar: [1, 2, 3] });
  });

  it('支持块注释 + 多行格式', () => {
    const src = `
/* comment */
const FOO = {
  a: 1,
  b: {
    nested: "yes",
  },
  c: [1, 2, 3],
};
`;
    const out = safeParseObject(src, 'FOO');
    expect(out).toEqual({ a: 1, b: { nested: 'yes' }, c: [1, 2, 3] });
  });

  it('拒绝 CallExpression(process.exit)', () => {
    expect(() => safeParseObject('process.exit(1)', undefined))
      .toThrow();
  });

  it('拒绝 Function 表达式', () => {
    // 用同一 varName,确保我们的赋值语句被找到 → 进入 evalLiteral → 遇到 Function 节点 → 拒绝
    expect(() => safeParseObject('const FOO = function(){ process.exit(); }', 'FOO'))
      .toThrow(/拒绝|不允许/);
  });

  it('拒绝函数声明(顶层 FunctionDeclaration)', () => {
    // 即便 target 找到,源里有顶层 function 也是危险的 → 拒绝
    expect(() => safeParseObject('function hack(){ process.exit(); } const FOO = { a: 1 };', 'FOO'))
      .toThrow();
  });

  it('拒绝方法简写', () => {
    expect(() => safeParseObject('const FOO = { method() { process.exit(); } };', 'FOO'))
      .toThrow();
  });

  it('拒绝 getter/setter', () => {
    expect(() => safeParseObject('const FOO = { get x() { return 1; } };', 'FOO'))
      .toThrow();
  });

  it('拒绝 SpreadElement', () => {
    expect(() => safeParseObject('const FOO = { ...other };', 'FOO'))
      .toThrow();
  });

  it('拒绝计算属性名', () => {
    expect(() => safeParseObject('const FOO = { ["a" + "b"]: 1 };', 'FOO'))
      .toThrow();
  });

  it('拒绝模板字符串', () => {
    expect(() => safeParseObject('const FOO = { a: `danger` };', 'FOO'))
      .toThrow();
  });

  it('拒绝 undefined literal', () => {
    // `undefined` 在 JS 里是 Identifier,我们的代码会先在 evalLiteral 拒绝 Identifier。
    // 这个测试现在验证:无论报"拒绝 Identifier"还是"undefined"相关,都必须抛错。
    expect(() => safeParseObject('const FOO = { a: undefined };', 'FOO'))
      .toThrow();
  });

  it('拒绝 Identifier 作为值', () => {
    // {a: process}  -> process 是 Identifier 不是 Literal
    expect(() => safeParseObject('const FOO = { a: process };', 'FOO'))
      .toThrow();
  });

  it('找不到 varName 时抛错', () => {
    expect(() => safeParseObject('const OTHER = { a: 1 };', 'CONFIG'))
      .toThrow(/未找到 "CONFIG"/);
  });

  it('语法错误时抛错', () => {
    expect(() => safeParseObject('const FOO = { a: ; };', 'FOO'))
      .toThrow(/acorn 解析失败/);
  });

  it('解析当前 viewer 的 config.js', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.resolve(__dirname, '..', '..', 'js', 'config.js');
    const raw = await fs.readFile(configPath, 'utf8');
    const cfg = safeParseObject(raw, 'CONFIG');
    expect(cfg.mode).toBe('proxy');
    expect(cfg.apiBase).toBe('https://7bu.top/api/v1');
    expect(Array.isArray(cfg.fallbackImages)).toBe(true);
  });

  it('解析当前 viewer 的 albums.js', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const albumsPath = path.resolve(__dirname, '..', '..', 'js', 'albums.js');
    const raw = await fs.readFile(albumsPath, 'utf8');
    const albums = safeParseObject(raw, 'ALBUMS');
    expect(Array.isArray(albums._meta)).toBe(true);
  });

  it('解析当前 viewer 的 focal-points.js', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fpPath = path.resolve(__dirname, '..', '..', 'js', 'focal-points.js');
    const raw = await fs.readFile(fpPath, 'utf8');
    const fp = safeParseObject(raw, 'FOCAL_POINTS');
    expect(typeof fp).toBe('object');
  });
});