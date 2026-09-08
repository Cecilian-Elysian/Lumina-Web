#!/usr/bin/env node
/* ============================================================
 * Lumina — AI 批量角色打标工具
 * ------------------------------------------------------------
 * 用 MiniMax VLM 给每张图识别动漫角色,
 * 自动生成 viewer 根目录的 js/character-tags.js。
 *
 * 用法:
 *   node ai/build-character-tags.mjs
 *   node ai/build-character-tags.mjs --source=fallback   (默认,从 config.js 的兜底图)
 *   node ai/build-character-tags.mjs --source=upstream   (从图床 API 拉)
 *   node ai/build-character-tags.mjs --concurrency=4     (并发数,默认 3)
 *   node ai/build-character-tags.mjs --limit=10          (只处理前 N 张,用于测试)
 *   node ai/build-character-tags.mjs --dry-run           (只打印,不写文件)
 *   node ai/build-character-tags.mjs --force             (忽略已有缓存,重新跑全部)
 *
 * 缓存:
 *   tools/.cache/character-tags.json   → 已识别结果(增量模式)
 *   tools/.cache/character-failed.json → 失败记录
 * 再次运行会自动跳过已有结果,只处理新增 URL。
 *
 * 密钥:
 *   读取顺序: process.env.MINIMAX_API_KEY → ../.dev.vars
 * ============================================================ */
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  readViewerConfig,
  writeCharacterTags,
  readLocalSecret,
} from '../server/lib/config-reader.mjs';
import { recognizeCharacter, buildAllowlist } from './lib/vlm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..');
const VIEWER = path.resolve(TOOLS, '..');
const CACHE = path.join(TOOLS, '.cache');
const TAGS_JSON = path.join(CACHE, 'character-tags.json');
const FAILED_JSON = path.join(CACHE, 'character-failed.json');

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

function log(emoji, msg) { console.log(`${emoji} ${msg}`); }

// ── 工具 ─────────────────────────────────────
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

// ── 收集 URL ─────────────────────────────────
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

// ── 缓存 IO ─────────────────────────────────
async function loadCache() {
  try { return JSON.parse(await fs.readFile(TAGS_JSON, 'utf8')); }
  catch { return {}; }
}
async function saveCache(map) {
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(TAGS_JSON, JSON.stringify(map, null, 2), 'utf8');
}
async function loadFailed() {
  try { return JSON.parse(await fs.readFile(FAILED_JSON, 'utf8')); }
  catch { return []; }
}
async function saveFailed(arr) {
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(FAILED_JSON, JSON.stringify(arr, null, 2), 'utf8');
}

// ── 主流程 ─────────────────────────────────
async function main() {
  log('✨', 'Lumina 角色批量打标 (MiniMax VLM)');

  const apiKey = process.env.MINIMAX_API_KEY || await readLocalSecret('MINIMAX_API_KEY');
  if (!apiKey) {
    log('❌', 'MINIMAX_API_KEY 未配置;请在 viewer 根目录 .dev.vars 写入后重试');
    process.exit(1);
  }
  log('🔑', 'MiniMax API key 已加载');

  const cfg = await readViewerConfig();
  const allowlist = buildAllowlist(cfg.characters);
  if (allowlist.length === 0) {
    log('⚠️', 'CONFIG.characters 为空;VLM 将对所有图回复 NONE,tags 全为 null');
    log('⚠️', '请在 js/config.js 的 CONFIG.characters 中维护角色名单后再跑');
  } else {
    log('📋', `角色允许表 (${allowlist.length}): ${allowlist.map((c) => c.name).join(', ')}`);
  }

  const allItems = await collectUrls(cfg);
  log('📊', `收集到 ${allItems.length} 张图`);

  const limited = LIMIT === Infinity ? allItems : allItems.slice(0, LIMIT);
  log('🎯', `本次: source=${SOURCE}, limit=${LIMIT === Infinity ? 'all' : LIMIT}, concurrency=${CONCURRENCY}${DRY_RUN ? ', DRY-RUN' : ''}`);

  const cache = await loadCache();
  const failed = await loadFailed();

  const todo = FORCE ? limited : limited.filter((it) => !(it.url in cache));
  const skipped = limited.length - todo.length;
  log('🔄', `增量模式: 已有 ${skipped} 张结果,本次新处理 ${todo.length} 张`);

  if (todo.length === 0) {
    log('✅', '无新图需要处理');
  } else {
    let okCount = 0;
    let failCount = 0;
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
        const tag = await recognizeCharacter({
          imageBase64: b64,
          mimeType: mime,
          allowlist,
          apiKey,
        });
        cache[it.url] = tag;
        okCount++;
        log('🏷️ ', `${idxLabel} ${tag || '(NONE)'} ← ${it.url.slice(-60)}`);
      } catch (e) {
        failCount++;
        failed.push({ url: it.url, error: e.message, time: Date.now() });
        log('❌', `${idxLabel} ${e.message} ← ${it.url.slice(-60)}`);
      }
    }, CONCURRENCY);

    log('📈', `本批: 成功 ${okCount}, 失败 ${failCount}`);

    if (!DRY_RUN) {
      await saveCache(cache);
      await saveFailed(failed);
    }
  }

  if (DRY_RUN) {
    log('🎉', 'dry-run 完成,未写入任何文件');
    return;
  }

  await writeCharacterTags(cache);
  log('💾', `已写入 ${path.join(VIEWER, 'js', 'character-tags.js')} (${Object.keys(cache).length} 项)`);
  log('🎉', '完成');
}

main().catch((e) => {
  console.error('❌ 失败:', e);
  process.exit(1);
});