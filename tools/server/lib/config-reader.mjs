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

/**
 * 把角色标签 JSON 写回 ../js/character-tags.js(覆盖)。
 * 写入顺序:对 URL 字典序排序,保证 diff 稳定。
 * @param {Object} json {[imageUrl]: string|null}
 */
export async function writeCharacterTags(json) {
  const viewerDir = getViewerDir();
  const header = `/* ============================================================
 * 角色图集 — 图片-角色映射数据桥
 * ------------------------------------------------------------
 * 由 tools/ai/build-character-tags.mjs (MiniMax VLM) 离线产出。
 * 格式:{ [imageUrl]: "角色名" | null }
 *   - 角色名必须在 CONFIG.characters.allowlist 中,否则会被前端视为"未分类"
 *   - null 表示 VLM 判定图中无 allowlist 中的角色
 *   - 缺失(URL 不在本表中)等价于 null
 *
 * 手动覆盖(浏览器级):
 *   localStorage.setItem('lumina.character.local', JSON.stringify({
 *     'https://...jpg': '德克萨斯'
 *   }))
 * 由 js/character-runtime.js 合并,优先级 localStorage > 本表 > null。
 * ============================================================ */\n`;
  const sorted = {};
  for (const k of Object.keys(json).sort()) sorted[k] = json[k];
  const body = `window.CHARACTER_TAGS = ${JSON.stringify(sorted, null, 2)};\n`;
  await fs.writeFile(path.join(viewerDir, 'js', 'character-tags.js'), header + body, 'utf8');
  return { ok: true, count: Object.keys(sorted).length };
}

/**
 * 读取并解析 ../js/character-tags.js,返回 CHARACTER_TAGS 对象。
 * 文件不存在或解析失败时返回空对象。
 */
export async function readCharacterTags() {
  const viewerDir = getViewerDir();
  try {
    const raw = await fs.readFile(path.join(viewerDir, 'js', 'character-tags.js'), 'utf8');
    const m = raw.match(/(?:window\.)?CHARACTER_TAGS\s*=\s*(\{[\s\S]*?\n\});/);
    if (!m) return {};
    return (0, eval)('(' + m[1] + ')');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * 点分路径取值
 */
export function getByPath(obj, p) {
  return p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), obj);
}
