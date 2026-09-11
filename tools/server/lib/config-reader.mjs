#!/usr/bin/env node
/* ============================================================
 * Lumina Tools — 共享 viewer 配置读取器
 * ------------------------------------------------------------
 * 供 server/ 和 ai/ 共享使用,从 ../js/*.js 解析数据。
 *
 * 安全要点:
 *   - 历史版本用 (0, eval)('(' + m[1] + ')') 解析 viewer 文件,
 *     若 viewer 文件被编辑时混入了非字面量表达式(如 process.exit),
 *     会被真的执行。
 *   - 现版本改用 acorn 静态解析,只接受
 *     ObjectExpression / ArrayExpression / Literal,
 *     任何其它节点都抛错,绝不执行。
 * ============================================================ */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 定位 viewer 目录(本文件位于 tools/server/lib/,viewer 在 ../..)
 */
export function getViewerDir() {
  return path.resolve(__dirname, '..', '..', '..');
}

/* ============================================================
 * 安全解析
 * ------------------------------------------------------------
 * 给定一段形如 `const FOO = {...};` 或 `window.FOO = {...};` 或裸 `{...}` 的代码,
 * 返回该对象字面量的纯数据值。
 *
 * 只接受:
 *   - ObjectExpression (递归)
 *   - ArrayExpression  (递归)
 *   - Literal (string / number / boolean / null)
 *
 * 其它节点(Identifier / CallExpression / MemberExpression / Function / ...)一律抛错。
 * 任何路径下都不会执行代码,绝不调用 process.exit / fetch 等。
 * ============================================================ */
export function safeParseObject(raw, varName) {
  if (typeof raw !== 'string') throw new Error('safeParseObject: raw 必须是字符串');

  // 1. 去掉 /* ... */ 注释(本项目的 .js 顶部都是块注释)
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. 用 acorn 解析
  let ast;
  try {
    ast = parse(stripped, { ecmaVersion: 2022, sourceType: 'script' });
  } catch (e) {
    throw new Error('acorn 解析失败: ' + e.message);
  }

  // 3. 拒绝顶层 FunctionDeclaration(即便 targetNode 后面能找到,函数声明本身就是 RCE 风险)
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' || stmt.type === 'FunctionExpression') {
      throw new Error('不允许顶层函数声明(纯字面量模式)');
    }
  }

  // 4. 找到我们要的赋值语句
  //    - 若提供了 varName:必须形如 `const|var|let NAME = <obj>;` 或 `window.NAME = <obj>;`
  //    - 若没提供:接受裸 `({...})` 表达式(单语句)
  let targetNode = null;

  if (varName) {
    for (const stmt of ast.body) {
      // 形式 1: const|let|var NAME = <obj>;
      if (stmt.type === 'VariableDeclaration' &&
          (stmt.kind === 'const' || stmt.kind === 'let' || stmt.kind === 'var')) {
        for (const decl of stmt.declarations) {
          if (decl.id.type === 'Identifier' && decl.id.name === varName && decl.init) {
            targetNode = decl.init;
            break;
          }
        }
        if (targetNode) break;
        continue;
      }
      // 形式 2: NAME = <obj>;  (赋值表达式,可能不合法但项目里没用到)
      if (stmt.type === 'ExpressionStatement') {
        const expr = stmt.expression;
        if (expr.type === 'AssignmentExpression' && expr.operator === '=') {
          const lhs = expr.left;
          const okLhs =
            (lhs.type === 'Identifier' && lhs.name === varName) ||
            (lhs.type === 'MemberExpression' &&
              lhs.object.type === 'Identifier' && lhs.object.name === 'window' &&
              lhs.property.type === 'Identifier' && lhs.property.name === varName);
          if (okLhs) { targetNode = expr.right; break; }
        }
      }
    }
  } else {
    // 没指定 varName:接受 `({...})` 作为唯一语句(裸 `{...}` 在 JS 里是 block,会报错)
    if (ast.body.length === 1 &&
        ast.body[0].type === 'ExpressionStatement' &&
        ast.body[0].expression.type === 'ObjectExpression') {
      targetNode = ast.body[0].expression;
    }
  }

  if (!targetNode) {
    throw new Error(`未找到 ${varName ? '"' + varName + '"' : 'ObjectExpression'} 的赋值语句`);
  }

  // 5. 走 AST 求值(只允许字面量)
  return evalLiteral(targetNode);
}

function evalLiteral(node) {
  if (!node || typeof node !== 'object') {
    throw new Error('evalLiteral: 无效节点');
  }

  if (node.type === 'Literal') {
    // 注意:undefined / function / symbol 等不允许(项目里不会出现)
    const v = node.value;
    if (v === undefined) {
      // acorn 会把 { a: void 0 } 解析成 Literal value=undefined
      // 这种刻意写法不在白名单,直接拒
      throw new Error('不允许 Literal undefined (请显式写 null 或省略字段)');
    }
    return v;
  }

  if (node.type === 'ObjectExpression') {
    const out = {};
    for (const prop of node.properties) {
      if (prop.type !== 'Property') {
        // SpreadElement / MethodDefinition 等一律不允许
        throw new Error('对象中不允许 SpreadElement / Method(纯字面量模式)');
      }
      if (prop.computed) {
        // 计算属性名 [expr]: 也属于表达式,拒绝
        throw new Error('不允许计算属性名 [expr]');
      }
      if (prop.method || prop.kind === 'get' || prop.kind === 'set') {
        throw new Error('不允许方法/getter/setter');
      }
      const key = prop.key.type === 'Identifier' ? prop.key.name
                : prop.key.type === 'Literal'   ? String(prop.key.value)
                : (() => { throw new Error('不支持的属性键类型: ' + prop.key.type); })();
      out[key] = evalLiteral(prop.value);
    }
    return out;
  }

  if (node.type === 'ArrayExpression') {
    return node.elements.map((el) => el === null ? null : evalLiteral(el));
  }

  // 任何其它节点 = 一律拒绝
  throw new Error('拒绝非字面量节点: ' + node.type);
}

/* ============================================================
 * viewer config.js (CONFIG)
 * ============================================================ */

/**
 * 读取并解析 ../js/config.js,返回完整的 CONFIG 对象。
 * @returns {Promise<Object>}
 */
export async function readViewerConfig() {
  const viewerDir = getViewerDir();
  const raw = await fs.readFile(path.join(viewerDir, 'js', 'config.js'), 'utf8');
  return safeParseObject(raw, 'CONFIG');
}

/**
 * 从进程环境或 viewer 根目录的 .dev.vars 读取本地密钥。
 * 密钥只在 Node 进程内使用，不通过 Manager API 返回。
 */
export async function readLocalSecret(name) {
  if (process.env[name]) return process.env[name];
  try {
    const raw = await fs.readFile(path.join(getViewerDir(), '.dev.vars'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || match[1] !== name) continue;
      return match[2].replace(/^(['"])(.*)\1$/, '$2') || null;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return null;
}

/* ============================================================
 * focal-points.js (FOCAL_POINTS)
 * ============================================================ */

/**
 * 读取并解析 ../js/focal-points.js,返回 FOCAL_POINTS 对象。
 * 文件不存在时返回空对象。
 * @returns {Promise<Object>}
 */
export async function readFocalPoints() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'js', 'focal-points.js'), 'utf8');
    return safeParseObject(raw, 'FOCAL_POINTS');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * 把 focal JSON 写回 ../js/focal-points.js(覆盖)。
 * @param {Object} json
 */
export async function writeFocalPoints(json) {
  const viewerDir = getViewerDir();
  const header = `/* ============================================================
 * 流动图片墙 — 图片焦点数据桥
 * ------------------------------------------------------------
 * 由 tools/ 下的可视化编辑器或 AI 批量工具 (build-focal-points.mjs) 产出。
 * 格式:{ [imageUrl]: { x: 0~1, y: 0~1 } }
 *
 * - x/y 是归一化坐标(0=左/上,1=右/下)
 * - 缺失时 viewer 自动回退 CSS 默认值(50% / 25%)
 * - 手动微调:本文件改完提交即可;或用本地 manager/ 可视化编辑
 * ============================================================ */\n`;
  const body = `window.FOCAL_POINTS = ${JSON.stringify(json, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'js', 'focal-points.js'), header + body, 'utf8');
  return { ok: true, count: Object.keys(json).length };
}

/**
 * 合并新旧焦点数据(纯函数,不读写文件)
 *   - existing 中存在、AI 也检测到 → 用 AI 的(更新)
 *   - existing 中存在、AI 未检测到 → 保留旧值(不覆盖人工标注)
 *   - AI 检测到、existing 没有 → 新增
 *
 * 返回 { merged, stats: { kept, updated, added } }
 */
export function mergeFocalPoints(existing, detected) {
  const merged = Object.assign({}, existing);
  let updated = 0;
  let added = 0;
  for (const url of Object.keys(detected || {})) {
    const newVal = detected[url];
    if (!newVal) continue;
    if (url in merged) updated++;
    else added++;
    merged[url] = newVal;
  }
  const kept = Object.keys(merged).length - updated - added;
  return { merged, stats: { kept, updated, added } };
}

/* ============================================================
 * 图集(albums)读写
 * ------------------------------------------------------------
 * 文件:../js/albums.js
 * 格式:
 *   window.ALBUMS = {
 *     _meta: [ { id: "abc123", name: "德克萨斯" }, ... ],
 *     "https://.../a.jpg": "abc123",  // url → album id
 *     "https://.../b.jpg": "def456"
 *   };
 *
 * 规则:
 *   - 一个 url 至多一个 album id;无 id = 未分组
 *   - _meta 数组顺序 = 图集显示/渲染顺序
 *   - 删除图集时,旗下 url 自动降级为未分组(仅清掉映射)
 * ============================================================ */

const ALBUMS_HEADER = `/* ============================================================
 * 图集(手动分类)— 图片-图集映射数据桥
 * ------------------------------------------------------------
 * 由本地 manager/ 可视化编辑器(拖拽)离线产出。
 * 格式:
 *   window.ALBUMS = {
 *     _meta: [ { id: "abc123", name: "德克萨斯" }, ... ],
 *     "https://.../a.jpg": "abc123",   // url → album id
 *     "https://.../b.jpg": "def456"
 *   };
 *
 * 规则:
 *   - 一个 url 至多一个 album id;未出现的 url = 未分组
 *   - _meta 数组顺序决定图集显示顺序
 *   - 删除图集时该 id 的所有 url 映射自动移除(降级为未分组)
 *
 * 浏览器侧(可在 DevTools 临时覆盖):
 *   localStorage.setItem('lumina.album.local', JSON.stringify({
 *     'https://...jpg': 'abc123'
 *   }))
 * ============================================================ */\n`;

/**
 * 读取 ../js/albums.js。文件不存在返回空结构。
 * @returns {Promise<{_meta:Array<{id:string,name:string}>, [url:string]:string}>}
 */
export async function readAlbums() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'js', 'albums.js'), 'utf8');
    return safeParseObject(raw, 'ALBUMS');
  } catch (e) {
    if (e.code === 'ENOENT') return { _meta: [] };
    throw e;
  }
}

/**
 * 把完整 albums 对象写回 ../js/albums.js(覆盖)。
 * 写入顺序:_meta 数组保持;url 映射按 url 字典序排序(diff 稳定)。
 * @param {{_meta:Array,_images?:Object}} doc
 */
export async function writeAlbums(doc) {
  const viewerDir = getViewerDir();
  const meta = Array.isArray(doc._meta) ? doc._meta.filter((a) => a && a.id && a.name) : [];
  const metaIds = new Set(meta.map((a) => a.id));

  // 收集映射;剔除指向不存在图集的 id
  const map = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_meta') continue;
    if (typeof v === 'string' && metaIds.has(v)) map[k] = v;
  }
  // url 字典序排序
  const sortedMap = {};
  for (const k of Object.keys(map).sort()) sortedMap[k] = map[k];

  const out = { _meta: meta, ...sortedMap };
  const body = `window.ALBUMS = ${JSON.stringify(out, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'js', 'albums.js'), ALBUMS_HEADER + body, 'utf8');
  return { ok: true, metaCount: meta.length, imageCount: Object.keys(sortedMap).length };
}

/**
 * 校验 albums 文档结构,失败抛错(含具体原因)
 * 规则:
 *   - 必须是普通对象
 *   - _meta 必须是数组
 *   - 每条 meta: id (1-64 字符串)、name (非空 trim 字符串)
 *   - 其它顶层 key 必须是 string(url)→ string(metaIds 里的 id)
 * @throws 若不合法
 */
export function validateAlbumsDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('body 必须是普通对象');
  }
  if (!Array.isArray(doc._meta)) {
    throw new Error('_meta 必须是数组');
  }
  const metaIds = new Set();
  doc._meta.forEach((a, i) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      throw new Error(`_meta[${i}] 必须是对象`);
    }
    if (typeof a.id !== 'string' || a.id.length < 1 || a.id.length > 64) {
      throw new Error(`_meta[${i}].id 必须是 1-64 字符的字符串`);
    }
    if (typeof a.name !== 'string' || a.name.trim().length === 0) {
      throw new Error(`_meta[${i}].name 必须是非空字符串`);
    }
    if (metaIds.has(a.id)) {
      throw new Error(`_meta[${i}].id 重复: ${a.id}`);
    }
    metaIds.add(a.id);
  });

  for (const [k, v] of Object.entries(doc)) {
    if (k === '_meta') continue;
    if (typeof k !== 'string' || k.length === 0) {
      throw new Error(`顶层 key "${k}" 必须是 string`);
    }
    if (typeof v !== 'string') {
      throw new Error(`url "${k}" 的映射值必须是 string(id),实际 ${typeof v}`);
    }
    if (!metaIds.has(v)) {
      throw new Error(`url "${k}" 映射到不存在的图集 id: ${v}`);
    }
  }
}

/**
 * 创建一个新图集。name 必填,id 自动生成(随机 8 字符 hex)。
 * @returns {Promise<{id:string,name:string,ok:boolean}>}
 */
export async function addAlbum(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('name 必填');
  }
  const doc = await readAlbums();
  const id = (() => {
    let s;
    do {
      s = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0').slice(0, 8);
    } while (doc._meta.some((a) => a.id === s));
    return s;
  })();
  doc._meta.push({ id, name: name.trim() });
  await writeAlbums(doc);
  return { id, name: name.trim(), ok: true };
}

/**
 * 重命名一个图集。
 * @returns {Promise<{ok:boolean,name:string}>}
 */
export async function renameAlbum(id, name) {
  if (!id || !name || !name.trim()) throw new Error('id 和 name 都必填');
  const doc = await readAlbums();
  const a = doc._meta.find((x) => x.id === id);
  if (!a) throw new Error('图集 id 不存在: ' + id);
  a.name = name.trim();
  await writeAlbums(doc);
  return { ok: true, name: a.name };
}

/**
 * 删除一个图集。其下所有 url 映射自动清除(降级为未分组)。
 * @returns {Promise<{ok:boolean,removedCount:number}>}
 */
export async function deleteAlbum(id) {
  if (!id) throw new Error('id 必填');
  const doc = await readAlbums();
  const before = doc._meta.length;
  doc._meta = doc._meta.filter((a) => a.id !== id);
  if (doc._meta.length === before) throw new Error('图集 id 不存在: ' + id);
  let removedCount = 0;
  for (const k of Object.keys(doc)) {
    if (k === '_meta') continue;
    if (doc[k] === id) { delete doc[k]; removedCount++; }
  }
  await writeAlbums(doc);
  return { ok: true, removedCount };
}

/**
 * 点分路径取值
 */
export function getByPath(obj, p) {
  return p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), obj);
}