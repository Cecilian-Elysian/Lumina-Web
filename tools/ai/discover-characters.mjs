#!/usr/bin/env node
/* ============================================================
 * Lumina — AI 角色发现工具(无 allowlist 阶段)
 * ------------------------------------------------------------
 * 用 MiniMax VLM (open 模式) 扫描你图床里的所有图,
 * 不依赖 CONFIG.characters,自由识别图中角色,
 * 聚合 + 别名归一化后,生成:
 *   1. tools/.cache/discovered-names.json  原始聚合(已 ignore)
 *   2. js/character-allowlist-suggested.js  review 草稿(已 ignore)
 *
 * 用法:
 *   node ai/discover-characters.mjs
 *   node ai/discover-characters.mjs --source=fallback      (默认,从 config.js 的 fallbackImages)
 *   node ai/discover-characters.mjs --source=upstream      (从图床 API 拉)
 *   node ai/discover-characters.mjs --limit=10             (只跑前 N 张)
 *   node ai/discover-characters.mjs --concurrency=4        (并发数,默认 3)
 *   node ai/discover-characters.mjs --dry-run              (只下载 + 解析,不调 VLM、不写文件)
 *   node ai/discover-characters.mjs --force                (忽略缓存,重新跑)
 *   node ai/discover-characters.mjs --no-canonicalize      (关闭 prts.wiki 别名归一化)
 *
 * 工作流:
 *   1. 跑一次本脚本 → 生成 suggested.js
 *   2. 打开 suggested.js,review / 编辑 / 删除噪音
 *   3. 把确认后的数组粘到 js/config.js 的 CONFIG.characters
 *   4. 跑 npm run char 走标准 production 打标
 *
 * 密钥:
 *   读取顺序: process.env.MINIMAX_API_KEY → ../.dev.vars
 * ============================================================ */
import path from 'node:path';
import fs from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  readViewerConfig,
  readLocalSecret,
} from '../server/lib/config-reader.mjs';
import { recognizeCharacter } from './lib/vlm.mjs';
import {
  loadCanonicalNames,
  loadOverrides,
  canonicalize,
  normalize,
} from './lib/aliases.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..');
const VIEWER = path.resolve(TOOLS, '..');
const CACHE = path.join(TOOLS, '.cache');
const RAW_JSON = path.join(CACHE, 'discovered-names.json');
const FAILED_JSON = path.join(CACHE, 'discovered-failed.json');
const SUGGESTED_JS = path.join(VIEWER, 'js', 'character-allowlist-suggested.js');

// ── CLI 参数 ─────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [];
  })
);
const SOURCE = args.source === 'upstream' ? 'upstream' : 'fallback';
const LIMIT = Number(args.limit) > 0 ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Math.min(8, Number(args.concurrency) || 3));
const DRY_RUN = !!args['dry-run'];
const FORCE = !!args.force;
const NO_CANONICALIZE = !!args['no-canonicalize'];

function log(emoji, msg) { console.log(`${emoji} ${msg}`); }

// ── helpers(沿用 build-character-tags.mjs 的实现) ───
function getByPath(obj, p) {
  return p.split('.').reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirect = res.headers.location;
        if (redirect) {
          res.resume();
          return resolve(downloadImage(redirect));
        }
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function detectMime(buf) {
  if (!buf || buf.length < 4) return 'image/jpeg';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  return 'image/jpeg';
}

async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let cur = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cur++;
      if (idx >= items.length) return;
      try { results[idx] = await mapper(items[idx], idx); }
      catch (e) { results[idx] = { _error: e.message }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// ── 收集 URL(沿用 build-character-tags.mjs 逻辑) ───
async function collectUrls(cfg) {
  if (SOURCE === 'fallback') {
    log('📂', `数据源: viewer 的 fallbackImages (${cfg.fallbackImages.length} 张)`);
    return cfg.fallbackImages.map((u) => ({ url: u, thumb: u }));
  }
  if (!cfg.apiBase || !cfg.listPath) {
    log('⚠️', '未配置 apiBase/listPath,回退到 fallbackImages');
    return cfg.fallbackImages.map((u) => ({ url: u, thumb: u }));
  }
  const url = cfg.apiBase + cfg.listPath +
              `?order=newest&per_page=${cfg.perPage || 100}`;
  log('🌐', `请求上游: ${url}`);

  const token = cfg.token || await readLocalSecret('QUBU_TOKEN');
  if (cfg.authType !== 'none' && !token) {
    throw new Error('缺少 QUBU_TOKEN,请在 viewer 根目录 .dev.vars 中配置');
  }
  const headers = { Accept: 'application/json' };
  if (token && cfg.authType === 'bearer') headers.Authorization = 'Bearer ' + token;
  else if (token && cfg.authType === 'header') headers[cfg.authKey] = (cfg.tokenPrefix || '') + token;

  const data = await new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  const arr = getByPath(data, cfg.imgField);
  if (!Array.isArray(arr)) throw new Error('imgField 路径未命中数组: ' + cfg.imgField);
  return arr
    .map((it) => ({
      url: getByPath(it, cfg.imgUrlField),
      thumb: (cfg.imgThumbField && getByPath(it, cfg.imgThumbField)) || getByPath(it, cfg.imgUrlField),
    }))
    .filter((it) => it.url);
}

// ── VLM reply 解析(open 模式) ────────────────────
/**
 * 判断一个 VLM reply 是否"像角色名"。
 *  - null/空/NONE → false
 *  - 太长(>20)→ false (大概率是描述)
 *  - 含常见描述词 → false
 */
function isPlausibleName(reply) {
  if (!reply || typeof reply !== 'string') return false;
  const s = reply.trim();
  if (!s) return false;
  if (/^(NONE|null|n\/a|无|没|无角色|路人|风景)$/i.test(s)) return false;
  if (s.length > 20) return false; // 太长
  // 含空格 + 多个词 → 大概率是描述
  if (s.split(/\s+/).length > 3) return false;
  // 常见描述前缀
  if (/^(an?\s|a\s|一个|这位|该|长发|持剑|拿|穿着)/i.test(s)) return false;
  return true;
}

// ── 缓存 IO ─────────────────────────────────────
async function loadRaw() {
  try { return JSON.parse(await fs.readFile(RAW_JSON, 'utf8')); }
  catch { return null; }
}
async function saveRaw(map) {
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(RAW_JSON, JSON.stringify(map, null, 2), 'utf8');
}
async function loadFailed() {
  try { return JSON.parse(await fs.readFile(FAILED_JSON, 'utf8')); }
  catch { return []; }
}
async function saveFailed(arr) {
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(FAILED_JSON, JSON.stringify(arr, null, 2), 'utf8');
}

// ── 写 suggested.js 预览文件 ──────────────────────
async function writeSuggested(suggested) {
  // suggested: [{ name, aliases:[], count }]
  const header = `/* ============================================================
 * 角色图集 — allowlist 候选名单 (AUTO-GENERATED · 请 review)
 * ------------------------------------------------------------
 * 由 tools/ai/discover-characters.mjs (MiniMax VLM open 模式) 生成。
 * 这只是 review 草稿,粘到 js/config.js 的 CONFIG.characters 才生效。
 *
 * 编辑建议:
 *   - 删除"风景"/"长发女孩"之类的噪音(VLM 误识别的非角色)
 *   - 删除 count < 2 的(大概率是偶发误识)
 *   - 在 aliases 里加常用别称(便于搜索)
 *
 * count 字段:该角色出现在多少张图里(基于你本次扫描的范围)
 *
 * ⚠️ 此文件已被 .gitignore 忽略,不会进入版本库。
 * ============================================================ */\n`;
  const body = `window.CHARACTER_ALLOWLIST_SUGGESTED = ${JSON.stringify(suggested, null, 2)};\n`;
  await fs.writeFile(SUGGESTED_JS, header + body, 'utf8');
}

// ── 主流程 ─────────────────────────────────────
async function main() {
  log('🔍', 'Lumina 角色发现 (MiniMax VLM · open 模式)');

  const apiKey = process.env.MINIMAX_API_KEY || await readLocalSecret('MINIMAX_API_KEY');
  if (!apiKey && !DRY_RUN) {
    log('❌', 'MINIMAX_API_KEY 未配置;请在 viewer 根目录 .dev.vars 写入后重试');
    process.exit(1);
  }
  if (apiKey) log('🔑', 'MiniMax API key 已加载');

  const cfg = await readViewerConfig();
  const allItems = await collectUrls(cfg);
  log('📊', `收集到 ${allItems.length} 张图`);
  const limited = LIMIT === Infinity ? allItems : allItems.slice(0, LIMIT);
  log('🎯', `本次: source=${SOURCE}, limit=${LIMIT === Infinity ? 'all' : LIMIT}, concurrency=${CONCURRENCY}, canonicalize=${!NO_CANONICALIZE}${DRY_RUN ? ', DRY-RUN' : ''}`);

  // 加载 prts.wiki canonical 名单(异步,和主流程并发)
  let canonicalNames = [];
  let overrides = {};
  if (!NO_CANONICALIZE) {
    try {
      canonicalNames = await loadCanonicalNames();
      overrides = await loadOverrides();
      log('📚', `prts.wiki canonical 名单: ${canonicalNames.length} 个干员 (含异格/变体)`);
      if (Object.keys(overrides).length > 0) {
        log('✏️ ', `用户别名覆盖: ${Object.keys(overrides).length} 条`);
      }
    } catch (e) {
      log('⚠️', `加载 canonical 名单失败 (${e.message});关闭归一化继续`);
    }
  }

  // 加载已有结果(增量模式)
  const cache = (FORCE || DRY_RUN) ? {} : (await loadRaw()) || {};
  const cacheUrls = Object.keys(cache);
  const todo = limited.filter((it) => !(it.url in cache));
  const skipped = limited.length - todo.length;
  log('🔄', `增量模式: 已有 ${skipped} 张结果,本次新处理 ${todo.length} 张`);

  if (todo.length === 0 && !DRY_RUN) {
    log('✅', '无新图需要处理');
  } else {
    let okCount = 0;
    let noneCount = 0;
    let filteredCount = 0;
    let failCount = 0;
    const failed = await loadFailed();

    await pMap(todo, async (it, i) => {
      const idxLabel = `[${i + 1}/${todo.length}]`;
      try {
        const buf = await downloadImage(it.url);
        const mime = detectMime(buf);
        const b64 = buf.toString('base64');
        if (DRY_RUN) {
          log('🔍', `${idxLabel} (dry-run) ${it.url.slice(-60)} [${(buf.length/1024).toFixed(1)}KB ${mime}]`);
          return;
        }
        const reply = await recognizeCharacter({
          mode: 'open',
          imageBase64: b64,
          mimeType: mime,
          apiKey,
        });
        if (!reply) {
          cache[it.url] = { reply: null, canonical: null, status: 'none' };
          noneCount++;
          log('🚫', `${idxLabel} NONE ← ${it.url.slice(-60)}`);
          return;
        }
        if (!isPlausibleName(reply)) {
          cache[it.url] = { reply, canonical: null, status: 'filtered' };
          filteredCount++;
          log('🗑️ ', `${idxLabel} 过滤: "${reply.slice(0,30)}" ← ${it.url.slice(-60)}`);
          return;
        }
        const canonical = canonicalize(reply, canonicalNames, overrides);
        cache[it.url] = { reply, canonical, status: 'ok' };
        okCount++;
        log('🏷️ ', `${idxLabel} ${reply} → ${canonical} ← ${it.url.slice(-60)}`);
      } catch (e) {
        failCount++;
        const rec = { url: it.url, error: e.message, time: Date.now() };
        failed.push(rec);
        log('❌', `${idxLabel} ${e.message} ← ${it.url.slice(-60)}`);
      }
    }, CONCURRENCY);

    if (!DRY_RUN) {
      log('📈', `本批: ok=${okCount}, none=${noneCount}, filtered=${filteredCount}, failed=${failCount}`);
      await saveRaw(cache);
      await saveFailed(failed);
    }
  }

  if (DRY_RUN) {
    log('🎉', 'dry-run 完成,未写入任何文件');
    return;
  }

  // ── 聚合:按 canonical 名合并,统计 count + 收集 sample ───
  const aggregated = new Map(); // canonical → { canonical, count, rawNames:Set, samples:[] }
  for (const url of Object.keys(cache)) {
    const entry = cache[url];
    if (!entry || entry.status !== 'ok' || !entry.canonical) continue;
    let bucket = aggregated.get(entry.canonical);
    if (!bucket) {
      bucket = {
        canonical: entry.canonical,
        count: 0,
        rawNames: new Map(), // raw → count
        samples: [],
      };
      aggregated.set(entry.canonical, bucket);
    }
    bucket.count++;
    const rawCount = bucket.rawNames.get(entry.reply) || 0;
    bucket.rawNames.set(entry.reply, rawCount + 1);
    if (bucket.samples.length < 3) bucket.samples.push(url);
  }

  // ── 排序 + 转成 suggested.js 格式 ───
  const sorted = [...aggregated.values()].sort((a, b) => b.count - a.count);
  const suggested = sorted.map((b) => {
    // aliases: 把所有出现过的 raw 名作为候选别名(取计数 ≥ 1)
    const aliases = [...b.rawNames.keys()].filter((n) => n !== b.canonical);
    return {
      name: b.canonical,
      aliases,
      count: b.count,
    };
  });

  await writeSuggested(suggested);
  log('💾', `已写入 ${SUGGESTED_JS} (${suggested.length} 个角色候选)`);

  // 打印汇总表
  log('📋', '────────── 候选名单 (按出现频次) ──────────');
  for (const item of suggested) {
    const aliasStr = item.aliases.length ? ` (alias: ${item.aliases.join(', ')})` : '';
    log('  ', `· ${item.name} ×${item.count}${aliasStr}`);
  }
  log('📋', '─────────────────────────────────────────');

  // 统计
  const totalProcessed = Object.keys(cache).length;
  const allNone = Object.values(cache).filter((e) => e && e.status === 'none').length;
  const allFiltered = Object.values(cache).filter((e) => e && e.status === 'filtered').length;
  const allOk = Object.values(cache).filter((e) => e && e.status === 'ok').length;
  log('📊', `总计: 处理 ${totalProcessed} 张 → ok=${allOk}, none=${allNone}, filtered=${allFiltered}`);
  log('🎉', '下一步: 打开 js/character-allowlist-suggested.js review,然后粘到 CONFIG.characters');
}

main().catch((e) => {
  console.error('❌ 失败:', e);
  process.exit(1);
});