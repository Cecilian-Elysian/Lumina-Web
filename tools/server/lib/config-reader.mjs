#!/usr/bin/env node
/* ============================================================
 * Lumina Tools — 共享 viewer 配置读取器
 * ------------------------------------------------------------
 * 供 server/ 和 ai/ 共享使用,从 ../js/config.js 解析 CONFIG 对象。
 *
 * 注意:config.js 是浏览器侧脚本格式(全局 const),
 *      这里用 eval 而非 import。
 * ============================================================ */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 定位 viewer 目录(本文件位于 tools/server/lib/,viewer 在 ../..)
 */
export function getViewerDir() {
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * 读取并解析 ../js/config.js,返回完整的 CONFIG 对象。
 * @returns {Promise<Object>}
 */
export async function readViewerConfig() {
  const viewerDir = getViewerDir();
  const raw = await fs.readFile(path.join(viewerDir, 'js', 'config.js'), 'utf8');
  const m = raw.match(/const\s+CONFIG\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('config.js 中未找到 CONFIG 对象');
  return (0, eval)('(' + m[1] + ')');
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

/**
 * 读取并解析 ../js/focal-points.js,返回 FOCAL_POINTS 对象。
 * 文件不存在时返回空对象。
 * @returns {Promise<Object>}
 */
export async function readFocalPoints() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'js', 'focal-points.js'), 'utf8');
    const m = raw.match(/(?:window\.)?FOCAL_POINTS\s*=\s*(\{[\s\S]*?\n\});/);
    if (!m) return {};
    return (0, eval)('(' + m[1] + ')');
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
    // 跳过 /* ... */ 注释,匹配第一个真正的赋值
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const m = stripped.match(/(?:^|\n)\s*(?:window\.)?ALBUMS\s*=\s*(\{[\s\S]*?\n\});/);
    if (!m) return { _meta: [] };
    return (0, eval)('(' + m[1] + ')');
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