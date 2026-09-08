#!/usr/bin/env node
/* ============================================================
 * Lumina AI — 干员别名归一化工具
 * ------------------------------------------------------------
 * 数据源:prts.wiki(MediaWiki)Category:干员
 *
 * 解决的问题:
 *   VLM 在 open 模式下可能返回混杂的中文/英文/别称,如:
 *     - "阿米娅" / "Amiya" / "Amy" / "阿米亚"
 *     - "德克萨斯" / "Texas" / "德狗"
 *   这些应该是同一个角色。我们用 prts.wiki 的官方干员清单作为
 *   canonical 表,对 VLM 的 reply 做归一化(Unicode NFKC + 大小写
 *   + 去标点),把 "阿米亚" → "阿米娅"。
 *
 * 缓存:
 *   tools/.cache/canonical-names.json   拉取自 prts.wiki 的官方干员清单
 *   tools/.cache/alias-map.json         别名覆盖(用户可手填,见 ALIAS_OVERRIDES)
 *
 * 用法:
 *   import { canonicalize, loadCanonicalNames } from './lib/aliases.mjs';
 *   const names = await loadCanonicalNames();
 *   const canon = canonicalize('阿米亚', names);  // → '阿米娅'
 * ============================================================ */
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..', '..');
const CACHE = path.join(TOOLS, '.cache');
const CANONICAL_JSON = path.join(CACHE, 'canonical-names.json');
const OVERRIDES_JSON = path.join(CACHE, 'alias-overrides.json');

const PRTS_API = 'https://prts.wiki/api.php';
const CATEGORY_NAME = '干员';

/**
 * Unicode NFKC + 大小写折叠 + 去空白/标点/符号。
 * 用于把 "阿米亚"、"amiya"、"Texas " 之类的归一到同一 key。
 */
export function normalize(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 从 prts.wiki MediaWiki API 分页拉取 Category:干员 成员。
 * 返回所有干员页面标题数组(含变体,如 "阿米娅(近卫)")。
 */
function fetchCategoryMembers(category) {
  return new Promise((resolve, reject) => {
    const all = [];
    const lib = https;
    const headers = {
      'User-Agent': 'Lumina-Discover/1.0 (https://github.com/anomalyco/opencode)',
      'Accept': 'application/json',
    };

    const fetchPage = (cmcontinue) => {
      const params = new URLSearchParams({
        action: 'query',
        list: 'categorymembers',
        cmtitle: 'Category:' + category,
        cmlimit: '500',
        cmnamespace: '0',
        format: 'json',
      });
      if (cmcontinue) params.set('cmcontinue', cmcontinue);

      const url = PRTS_API + '?' + params.toString();
      lib.get(url, { headers, timeout: 15000 }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('prts.wiki HTTP ' + res.statusCode));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const members = (json.query && json.query.categorymembers) || [];
            members.forEach((m) => all.push(m.title));
            if (json.continue && json.continue.cmcontinue) {
              fetchPage(json.continue.cmcontinue);
            } else {
              resolve(all);
            }
          } catch (e) {
            reject(new Error('prts.wiki JSON 解析失败: ' + e.message));
          }
        });
      }).on('error', reject);
    };

    fetchPage(null);
  });
}

/**
 * 加载 prts.wiki 官方干员清单(带缓存)。
 * @param {Object} [opts]
 * @param {boolean} [opts.force=false] 强制重新拉取
 * @returns {Promise<string[]>}
 */
export async function loadCanonicalNames({ force = false } = {}) {
  if (!force) {
    try {
      const raw = JSON.parse(await fs.readFile(CANONICAL_JSON, 'utf8'));
      if (Array.isArray(raw.names) && raw.fetchedAt) {
        return raw.names;
      }
    } catch {}
  }

  const names = await fetchCategoryMembers(CATEGORY_NAME);
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(CANONICAL_JSON, JSON.stringify({
    source: PRTS_API,
    category: CATEGORY_NAME,
    fetchedAt: Date.now(),
    count: names.length,
    names,
  }, null, 2), 'utf8');
  return names;
}

/**
 * 加载用户手填的别名覆盖文件(可选)。
 * 格式: { "别名": "canonical名" }
 * 例:   { "德狗": "德克萨斯", "星熊": "星熊" }
 * 文件不存在时返回 {}。
 */
export async function loadOverrides() {
  try {
    const raw = JSON.parse(await fs.readFile(OVERRIDES_JSON, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

/**
 * 用 canonical 列表 + 用户覆盖,构造归一化查找表。
 * 返回:Map<normalizedKey, canonicalName>
 */
export function buildAliasIndex(canonicalNames, overrides = {}) {
  const idx = new Map();
  for (const name of canonicalNames) {
    const k = normalize(name);
    if (!idx.has(k)) idx.set(k, name);
  }
  for (const [alias, canon] of Object.entries(overrides)) {
    const k = normalize(alias);
    if (!idx.has(k)) idx.set(k, canon);
  }
  return idx;
}

/**
 * 把任意字符串归一到 canonical 名(查表命中则返回 canonical,
 * 未命中返回原字符串 —— 由调用方决定如何兜底)。
 *
 * @param {string} name           VLM 返回的角色名
 * @param {string[]} canonicals   canonical 列表(传 loadCanonicalNames 的结果)
 * @param {Object} [overrides]    用户手填别名覆盖
 * @returns {string} canonical 名,或原 name
 */
export function canonicalize(name, canonicals, overrides = {}) {
  if (!name || typeof name !== 'string') return name;
  // 精确匹配(包含原始名和 normalize 后名两种 key)
  if (canonicals.includes(name)) return name;
  const idx = buildAliasIndex(canonicals, overrides);
  const k = normalize(name);
  if (idx.has(k)) return idx.get(k);
  return name;
}