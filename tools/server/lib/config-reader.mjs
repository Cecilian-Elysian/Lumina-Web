#!/usr/bin/env node
/* Lumina Tools — 共享数据文件读取器。
 * 安全要点:历史版本用 (0, eval) 解析 viewer 文件,混入表达式会被真的执行;
 * 现版本只用 acorn 静态解析,只接受 Object/Array/Literal,任何其它节点抛错,绝不执行。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** viewer 根目录(本文件位于 tools/server/lib/,viewer 在 ../..) */
export function getViewerDir() {
  return path.resolve(__dirname, '..', '..', '..');
}

/** 给定形如 `const FOO = {...};` / `window.FOO = {...};` / 裸 `{...}` 的代码,
 *  返回对象字面量的纯数据值。只接受 Object/Array/Literal(递归),
 *  Identifier/Call/Member/Function 等一律抛错;任何路径下都不执行代码。 */
export function safeParseObject(raw, varName) {
  if (typeof raw !== 'string') throw new Error('safeParseObject: raw 必须是字符串');

  // 注释不用预处理:acorn 解析时原生跳过。此前的 /* */ 剥除正则不区分
  // 字符串内外,字符串里含 "/*" 的正常数据会被误删(静默丢数据)。
  let ast;
  try {
    ast = parse(raw, { ecmaVersion: 2022, sourceType: 'module' });
  } catch (e) {
    throw new Error('acorn 解析失败: ' + e.message);
  }

  // 顶层函数声明本身就是 RCE 风险,直接拒
  for (const stmt of ast.body) {
    const s = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (s.type === 'FunctionDeclaration' || s.type === 'FunctionExpression') {
      throw new Error('不允许顶层函数声明(纯字面量模式)');
    }
  }

  // 定位赋值语句:varName 匹配 `const NAME =` / `NAME =` / `window.NAME =`;
  // 未提供 varName 时接受唯一的 `({...})` 表达式(裸 `{...}` 是 block,解析会报错)
  let targetNode = null;

  if (varName) {
    for (const stmt of ast.body) {
      const s = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;

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
    if (ast.body.length === 1 &&
        ast.body[0].type === 'ExpressionStatement' &&
        ast.body[0].expression.type === 'ObjectExpression') {
      targetNode = ast.body[0].expression;
    }
  }

  if (!targetNode) {
    throw new Error(`未找到 ${varName ? '"' + varName + '"' : 'ObjectExpression'} 的赋值语句`);
  }
  return evalLiteral(targetNode);
}

/** AST 求值:只接受 Literal / Object / Array,其余节点(含
 *  undefined 字面量、spread、计算属性名、方法)一律抛错。 */
function evalLiteral(node) {
  if (!node || typeof node !== 'object') {
    throw new Error('evalLiteral: 无效节点');
  }

  if (node.type === 'Literal') {
    const v = node.value;
    if (v === undefined) {
      throw new Error('不允许 Literal undefined (请显式写 null 或省略字段)');
    }
    return v;
  }

  if (node.type === 'ObjectExpression') {
    // 无原型对象:数据文件的键来自文件内容,形如 "__proto__" 的键
    // 在普通对象上会写到原型而不是自有属性(污染或静默丢失)
    const out = Object.create(null);
    for (const prop of node.properties) {
      if (prop.type !== 'Property') {
        throw new Error('对象中不允许 SpreadElement / Method(纯字面量模式)');
      }
      if (prop.computed) {
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

  throw new Error('拒绝非字面量节点: ' + node.type);
}

/* ---- src/site/config.ts (CONFIG) ---- */

/** 读取并解析 src/site/config.ts,返回完整 CONFIG 对象 */
export async function readViewerConfig() {
  const viewerDir = getViewerDir();
  const raw = await fs.readFile(path.join(viewerDir, 'src', 'site', 'config.ts'), 'utf8');
  return safeParseObject(raw, 'CONFIG');
}

/** 从进程环境或 viewer 根目录 .dev.vars 读本地密钥;密钥不经过 Manager API 返回 */
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

/* ---- focal-points (FOCAL_POINTS) — src/site/focalPoints.ts ---- */

/** 读取 src/site/focalPoints.ts;文件不存在返回空对象 */
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

/** 把 focal JSON 覆盖写回 src/site/focalPoints.ts(保持纯字面量,acorn 才能解析) */
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

/** 合并新旧焦点(AI 检测到的更新旧值,未检测到的保留人工标注)。
 *  返回 { merged, stats: { kept, updated, added } } */
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

/* ---- 图集(albums)读写:src/site/albums.ts(格式与规则见 ALBUMS_HEADER) ---- */

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

/** 读取 src/site/albums.ts;文件不存在返回空结构 */
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

/** 覆盖写回 albums;_meta 保持原序,url 映射按字典序排序(diff 稳定) */
export async function writeAlbums(doc) {
  const viewerDir = getViewerDir();
  const meta = Array.isArray(doc._meta) ? doc._meta.filter((a) => a && a.id && a.name) : [];
  const metaIds = new Set(meta.map((a) => a.id));

  // 无原型对象:键来自 Manager 发来的 url,"__proto__" 之类的键不能落到原型上
  const map = Object.create(null);
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_meta') continue;
    if (typeof v === 'string' && metaIds.has(v)) map[k] = v;
  }
  const sortedMap = Object.create(null);
  for (const k of Object.keys(map).sort()) sortedMap[k] = map[k];

  const out = { _meta: meta, ...sortedMap };
  const body = `export const ALBUMS = ${JSON.stringify(out, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'albums.ts'), ALBUMS_HEADER + body, 'utf8');
  return { ok: true, metaCount: meta.length, imageCount: Object.keys(sortedMap).length };
}

/** 校验 albums 文档:普通对象;_meta 数组且每条 id(1-64 字符)/name(非空)不重复;
 *  其余键必须是 url → 已存在 id 的映射。失败抛错。 */
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

/** 新建图集(name 必填,id 为随机 8 位 hex) */
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

/** 重命名图集 */
export async function renameAlbum(id, name) {
  if (!id || !name || !name.trim()) throw new Error('id 和 name 都必填');
  const doc = await readAlbums();
  const a = doc._meta.find((x) => x.id === id);
  if (!a) throw new Error('图集 id 不存在: ' + id);
  a.name = name.trim();
  await writeAlbums(doc);
  return { ok: true, name: a.name };
}

/** 删除图集;旗下 url 映射自动清除(降级未分组) */
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

/** 点分路径取值 */
export function getByPath(obj, p) {
  return p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), obj);
}

/* ---- 标签(tags)读写:src/site/tags.ts(格式与规则见 TAGS_HEADER) ---- */

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

/** 清洗 tags 文档:剔除空 tag、去重、url 字典序排序。
 *  返回 { doc, tagCount };类型/长度非法抛错。 */
export function sanitizeTagsDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('tags 文档必须是普通对象');
  }
  // 无原型对象:url 键来自 Manager 发来的请求体,防 "__proto__" 污染
  const out = Object.create(null);
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
  const sorted = Object.create(null);
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return { doc: sorted, tagCount };
}

/** 校验 Manager 发来的 tags 文档;额外规则:空文档不许直接覆盖清库(防误操作) */
export function validateTagsDoc(doc) {
  const { doc: cleaned } = sanitizeTagsDoc(doc);
  if (Object.keys(cleaned).length === 0) {
    throw new Error('tags 文档为空 — 如需清空全部标签请手动编辑文件(防误操作)');
  }
}

/** 读取 src/site/tags.ts;文件不存在返回空对象 */
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

/** 覆盖写回 src/site/tags.ts(先清洗) */
export async function writeTags(doc) {
  const { doc: cleaned, tagCount } = sanitizeTagsDoc(doc);
  const viewerDir = getViewerDir();
  const body = `export const TAGS = ${JSON.stringify(cleaned, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'tags.ts'), TAGS_HEADER + body, 'utf8');
  return { ok: true, imageCount: Object.keys(cleaned).length, tagCount };
}

/* ---- 站点配置(config.ts)白名单写入 ----
 * Manager 只允许改版面/拉取字段,mode/token 等敏感键拒改;
 * 写回时从现文件解析后合并,不会漂移。 */

/** 允许 Manager 修改的 CONFIG 字段 */
export const CONFIG_WRITE_WHITELIST = [
  'rows',           // 图片墙行数
  'cardWidth',      // 卡片宽度 px
  'perPage',        // 拉取数量上限
  'thumbWidth',     // 缩略图宽度(实测 7bu.top 不支持改写,保持 null)
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

/** 校验 Manager 发来的 config patch:白名单键 + 范围校验,失败抛错 */
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
      // ⚠ 必须与 src/site/settings.ts 的 ROWS_RANGE / WIDTH_RANGE 完全一致:
      //    站点 loadSettings() 会按自己的范围 clamp,管理端放宽只会写出
      //    "看似保存成功、实际被站点静默改掉" 的值。
      const range = { rows: [1, 6], cardWidth: [180, 560], perPage: [1, 500] }[k];
      if (v < range[0] || v > range[1]) {
        throw new Error(`${k} 超出范围 ${range[0]}–${range[1]},实际 ${v}`);
      }
    } else if (k === 'thumbWidth') {
      if (v !== null && (!Number.isInteger(v) || v < 100 || v > 2000)) {
        throw new Error('thumbWidth 必须是 100–2000 的整数或 null');
      }
    }
  }
}

/** 白名单合并:current 全字段保留,patch 覆盖白名单键 */
export function mergeConfigPatch(current, patch) {
  return Object.assign({}, current, patch);
}

/** 合并 patch 并重写 src/site/config.ts */
export async function writeConfig(patch) {
  validateConfigPatch(patch);
  const current = await readViewerConfig();
  const merged = mergeConfigPatch(current, patch);
  const viewerDir = getViewerDir();
  const body = `export const CONFIG = ${JSON.stringify(merged, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'src', 'site', 'config.ts'), CONFIG_HEADER + body, 'utf8');
  return { ok: true, updated: Object.keys(patch) };
}