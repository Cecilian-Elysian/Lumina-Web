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

  // 1. 去掉 /* ... */ 注释(数据文件顶部都是块注释)
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. 用 acorn 解析(sourceType: module 以支持 export const 声明)
  let ast;
  try {
    ast = parse(stripped, { ecmaVersion: 2022, sourceType: 'module' });
  } catch (e) {
    throw new Error('acorn 解析失败: ' + e.message);
  }

  // 3. 拒绝顶层函数声明(含 export function),函数声明本身就是 RCE 风险
  for (const stmt of ast.body) {
    const s = stmt.type === 'ExportNamedDeclaration' && stmt.declaration
      ? stmt.declaration
      : stmt;
    if (s.type === 'FunctionDeclaration' || s.type === 'FunctionExpression') {
      throw new Error('不允许顶层函数声明(纯字面量模式)');
    }
  }

  // 4. 找到我们要的赋值语句
  //    - 若提供了 varName:必须形如 `[export] const NAME = <obj>;` 或 `window.NAME = <obj>;`
  //    - 若没提供:接受裸 `({...})` 表达式(单语句)
  let targetNode = null;

  if (varName) {
    for (const stmt of ast.body) {
      // 解开 export 包装(export const NAME = ... → VariableDeclaration)
      const s = stmt.type === 'ExportNamedDeclaration' && stmt.declaration
        ? stmt.declaration
        : stmt;

      // 形式 1: const|let|var NAME = <obj>;
      if (s.type === 'VariableDeclaration' &&
          (s.kind === 'const' || s.kind === 'let' || s.kind === 'var')) {
        for (const decl of s.declarations) {
          if (decl.id.type === 'Identifier' && decl.id.name === varName && decl.init) {
            targetNode = decl.init;
            break;
          }
        }
        if (targetNode) break;
        continue;
      }
      // 形式 2: NAME = <obj>; 或 window.NAME = <obj>;(赋值表达式)
      if (s.type === 'ExpressionStatement') {
        const expr = s.expression;
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
 * viewer src/site/config.ts (CONFIG)
 * ============================================================ */

/**
 * 读取并解析 src/site/config.ts,返回完整的 CONFIG 对象。
 * @returns {Promise<Object>}
 */
export async function readViewerConfig() {
  const viewerDir = getViewerDir();
  const raw = await fs.readFile(path.join(viewerDir, 'src', 'site', 'config.ts'), 'utf8');
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
 * focal-points (FOCAL_POINTS) — src/site/focalPoints.ts
 * ============================================================ */

/**
 * 读取并解析 src/site/focalPoints.ts,返回 FOCAL_POINTS 对象。
 * 文件不存在时返回空对象。
 * @returns {Promise<Object>}
 */
export async function readFocalPoints() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'src', 'site', 'focalPoints.ts'), 'utf8');
    return safeParseObject(raw, 'FOCAL_POINTS');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * 把 focal JSON 写回 src/site/focalPoints.ts(覆盖)。
 * 注意:保持纯字面量(无 import/类型注解),acorn 才能解析。
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
 * - 纯字面量文件(禁 import/类型注解),由 tools 服务端 acorn 解析
 * ============================================================ */\n`;
  const body = `export const FOCAL_POINTS = ${JSON.stringify(json, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'focalPoints.ts'), header + body, 'utf8');
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
 * 文件:src/site/albums.ts
 * 格式:
 *   export const ALBUMS = {
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
 *   export const ALBUMS = {
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
 * 注意:纯字面量文件(禁 import/类型注解),由 tools 服务端 acorn 解析
 *
 * 浏览器侧(可在 DevTools 临时覆盖):
 *   localStorage.setItem('lumina.album.local', JSON.stringify({
 *     'https://...jpg': 'abc123'
 *   }))
 * ============================================================ */\n`;

/**
 * 读取 src/site/albums.ts。文件不存在返回空结构。
 * @returns {Promise<{_meta:Array<{id:string,name:string}>, [url:string]:string}>}
 */
export async function readAlbums() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'src', 'site', 'albums.ts'), 'utf8');
    return safeParseObject(raw, 'ALBUMS');
  } catch (e) {
    if (e.code === 'ENOENT') return { _meta: [] };
    throw e;
  }
}

/**
 * 把完整 albums 对象写回 src/site/albums.ts(覆盖)。
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
  const body = `export const ALBUMS = ${JSON.stringify(out, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'albums.ts'), ALBUMS_HEADER + body, 'utf8');
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

/* ============================================================
 * 标签(tags)读写
 * ------------------------------------------------------------
 * 文件:src/site/tags.ts
 * 格式:{ "https://.../a.jpg": ["德克萨斯", "立绘"], ... }
 *
 * 规则:
 *   - 键 = Image.url(原图直链),值 = string[](写回时去空/去重)
 *   - 写回时 url 按字典序排序(diff 稳定)
 *   - 浏览器侧 localStorage(lumina.tags.local)可临时覆盖,
 *     null = 清空该图全部标签
 * ============================================================ */

const TAGS_HEADER = `/* ============================================================
 * Lumina — 图片标签数据(纯字面量)
 * ------------------------------------------------------------
 * 由本地 manager 可视化编辑器(标签 Tab)离线产出。
 * 格式:{ [图片原图 url]: string[] 标签数组 }
 *
 * ★ 键约定:键永远是 Image.url(原图直链),不是 thumb
 *   (历史教训:焦点曾因用 thumb 查表 100% 失效)。
 *
 * 注意:纯字面量文件(禁 import/类型注解),由 tools 服务端 acorn 解析
 *
 * 浏览器侧(可在 DevTools 临时覆盖,null = 清空该图标签):
 *   localStorage.setItem('lumina.tags.local', JSON.stringify({
 *     'https://...jpg': ['德克萨斯', '立绘']
 *   }))
 * ============================================================ */\n`;

/**
 * 清洗 tags 文档(纯函数):剔除空 tag、去重、url 字典序排序。
 * @param {Record<string, string[]>} doc
 * @returns {{ doc: Record<string, string[]>, tagCount: number }}
 */
export function sanitizeTagsDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('tags 文档必须是普通对象');
  }
  const out = {};
  let tagCount = 0;
  for (const [url, tags] of Object.entries(doc)) {
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error(`标签键必须是非空字符串(url),实际: ${JSON.stringify(url)}`);
    }
    if (!Array.isArray(tags)) {
      throw new Error(`url "${url}" 的标签必须是数组,实际 ${typeof tags}`);
    }
    const cleaned = [];
    for (const t of tags) {
      if (typeof t !== 'string') {
        throw new Error(`url "${url}" 存在非字符串标签: ${JSON.stringify(t)}`);
      }
      const v = t.trim();
      if (!v) continue;
      if (v.length > 32) {
        throw new Error(`url "${url}" 标签过长(>32 字符): "${v}"`);
      }
      if (!cleaned.includes(v)) cleaned.push(v);
    }
    out[url] = cleaned;
    tagCount += cleaned.length;
  }
  // url 字典序排序
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return { doc: sorted, tagCount };
}

/**
 * 校验 Manager 发来的 tags 文档,失败抛错(含具体原因)。
 * sanitizeTagsDoc 之外的额外规则:不允许空文档直接覆盖清库(防误操作)。
 * @throws 若不合法
 */
export function validateTagsDoc(doc) {
  const { doc: cleaned } = sanitizeTagsDoc(doc); // 复用清洗(含类型/长度校验)
  if (Object.keys(cleaned).length === 0) {
    throw new Error('tags 文档为空 — 如需清空全部标签请手动编辑文件(防误操作)');
  }
}

/**
 * 读取 src/site/tags.ts。文件不存在返回空对象。
 * @returns {Promise<Record<string, string[]>>}
 */
export async function readTags() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'src', 'site', 'tags.ts'), 'utf8');
    return safeParseObject(raw, 'TAGS');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * 把完整 tags 对象写回 src/site/tags.ts(覆盖)。
 * @param {Record<string, string[]>} doc
 */
export async function writeTags(doc) {
  const { doc: cleaned, tagCount } = sanitizeTagsDoc(doc);
  const viewerDir = getViewerDir();
  const body = `export const TAGS = ${JSON.stringify(cleaned, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'tags.ts'), TAGS_HEADER + body, 'utf8');
  return { ok: true, imageCount: Object.keys(cleaned).length, tagCount };
}

/* ============================================================
 * 站点配置(config.ts)白名单写入
 * ------------------------------------------------------------
 * Manager 的「配置」Tab 只允许改版面/拉取相关字段;
 * mode / token / 字段映射等敏感或危险键一律拒改,
 * 且写回时保留原值(从现文件解析后合并,不会漂移)。
 *
 * ⚠ config.ts 由生成头 + JSON 字面量重写,手工注释会丢失
 *   (与 focalPoints/albums 的生成模式一致)。
 * ============================================================ */

/** 允许 Manager 修改的 CONFIG 字段 */
export const CONFIG_WRITE_WHITELIST = [
  'rows',           // 图片墙行数
  'cardWidth',      // 卡片宽度 px
  'perPage',        // 拉取数量上限
  'thumbWidth',     // 缩略图宽度(实测 7bu.top 不支持改写,保持 null)
  'lazyRootMargin', // 懒加载根边距
];

const CONFIG_HEADER = `/* ============================================================
 * Lumina — 全局配置(纯字面量数据)
 * ------------------------------------------------------------
 * ★ 本文件同时被两方读取:
 *   1. Vite(src/site/composables.ts 等) — 直接 import
 *   2. tools/server(本地 Manager) — 用 acorn 静态解析
 *
 * ★ 纯字面量约束:
 *   - 禁止 import / 类型注解 / as const / 模板字符串
 *   - 只允许 Object / Array / string / number / boolean / null
 *
 * ★ 本文件由 Manager「配置」Tab 或手工编辑维护:
 *   - 经 Manager 保存会重写本文件(手工注释会丢失,字段值保留)
 *   - token 仅 direct 调试模式填写;proxy 模式保持空串,
 *     真实 token 存于 Cloudflare 环境变量 QUBU_TOKEN
 * ============================================================ */
`;

/**
 * 校验 Manager 发来的 config patch,失败抛错(含具体原因)。
 * 规则:
 *   - 必须是普通对象且至少一个键
 *   - 只允许白名单键(mode/token 等一律拒绝)
 *   - rows: 1–10 整数;cardWidth: 150–600 整数;perPage: 1–200 整数
 *   - thumbWidth: 100–2000 整数或 null
 *   - lazyRootMargin: 形如 "200px"(1–16 字符)
 * @throws 若不合法
 */
export function validateConfigPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('config patch 必须是普通对象');
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new Error('config patch 至少包含一个字段');
  }
  for (const k of keys) {
    if (!CONFIG_WRITE_WHITELIST.includes(k)) {
      throw new Error(`不允许修改的字段: "${k}"(白名单: ${CONFIG_WRITE_WHITELIST.join(', ')})`);
    }
    const v = patch[k];
    if (k === 'rows' || k === 'cardWidth' || k === 'perPage') {
      if (!Number.isInteger(v)) throw new Error(`${k} 必须是整数,实际 ${JSON.stringify(v)}`);
      const range = { rows: [1, 10], cardWidth: [150, 600], perPage: [1, 200] }[k];
      if (v < range[0] || v > range[1]) {
        throw new Error(`${k} 超出范围 ${range[0]}–${range[1]},实际 ${v}`);
      }
    } else if (k === 'thumbWidth') {
      if (v !== null && (!Number.isInteger(v) || v < 100 || v > 2000)) {
        throw new Error('thumbWidth 必须是 100–2000 的整数或 null');
      }
    } else if (k === 'lazyRootMargin') {
      if (typeof v !== 'string' || !/^\d+px$/.test(v) || v.length > 16) {
        throw new Error('lazyRootMargin 必须是形如 "200px" 的字符串');
      }
    }
  }
}

/**
 * 白名单合并(纯函数):current 的全部字段保留,patch 覆盖白名单键。
 * @param {Object} current 从 config.ts 解析出的现值
 * @param {Object} patch    经过 validateConfigPatch 的增量
 */
export function mergeConfigPatch(current, patch) {
  return Object.assign({}, current, patch);
}

/**
 * 把 patch 合并进现 CONFIG 并重写 src/site/config.ts。
 * @param {Object} patch 白名单增量
 */
export async function writeConfig(patch) {
  validateConfigPatch(patch);
  const current = await readViewerConfig();
  const merged = mergeConfigPatch(current, patch);
  const viewerDir = getViewerDir();
  const body = `export const CONFIG = ${JSON.stringify(merged, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'config.ts'), CONFIG_HEADER + body, 'utf8');
  return { ok: true, updated: Object.keys(patch) };
}