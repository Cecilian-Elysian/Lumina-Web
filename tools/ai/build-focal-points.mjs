#!/usr/bin/env node
/* ============================================================
 * Lumina — AI 批量焦点分析工具
 * ------------------------------------------------------------
 * 用 @vladmandic/face-api 检测每张图的人脸,
 * 自动生成 viewer 根目录的 js/focal-points.js。
 *
 * 用法:
 *   node ai/build-focal-points.mjs
 *   node ai/build-focal-points.mjs --strategy=max        (默认,最大脸)
 *   node ai/build-focal-points.mjs --strategy=center     (所有人脸包围盒中心)
 *   node ai/build-focal-points.mjs --source=fallback     (默认,从 config.js 的兜底图)
 *   node ai/build-focal-points.mjs --source=upstream     (从 config.js 的图床拉)
 *   node ai/build-focal-points.mjs --concurrency=4       (并发下载数,默认 4)
 *   node ai/build-focal-points.mjs --download-only       (只下载模型,不分析)
 *
 * 首次运行:自动下载 face-api 模型到 ../weights/(约 6MB)
 * ============================================================ */
import faceapi from '@vladmandic/face-api';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  readViewerConfig,
  writeFocalPoints,
  readFocalPoints,
  mergeFocalPoints,
  readLocalSecret,
  getByPath,
} from '../server/lib/config-reader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..');
const VIEWER = path.resolve(TOOLS, '..');
const WEIGHTS = path.join(TOOLS, 'weights');

// ── CLI 参数 ─────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [];
  })
);
const STRATEGY     = (args.strategy === 'center' ? 'center' : 'max');
const SOURCE       = (args.source === 'upstream' ? 'upstream' : 'fallback');
const CONCURRENCY  = Math.max(1, Math.min(16, Number(args.concurrency) || 4));
const DOWNLOAD_ONLY = !!args['download-only'];

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}
function progress(cur, total, msg) {
  process.stdout.write(`\r🧠 [${cur}/${total}] ${msg.padEnd(40, ' ')}`);
  if (cur === total) process.stdout.write('\n');
}

// ── 模型权重下载(原 download-weights.mjs) ──────────
const WEIGHT_FILES = [
  {
    name: 'ssd_mobilenetv1_model-weights_manifest.json',
    url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/ssd_mobilenetv1_model-weights_manifest.json',
  },
  {
    name: 'ssd_mobilenetv1_model-shard1',
    url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/ssd_mobilenetv1_model-shard1',
  },
  {
    name: 'ssd_mobilenetv1_model-shard2',
    url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/ssd_mobilenetv1_model-shard2',
  },
  {
    name: 'face_landmark_68_model-weights_manifest.json',
    url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/face_landmark_68_model-weights_manifest.json',
  },
  {
    name: 'face_landmark_68_model-shard1',
    url: 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/face_landmark_68_model-shard1',
  },
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(downloadFile(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        reject(new Error(url + ' HTTP ' + res.statusCode));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const file = fsSync.createWriteStream(dest);
      let received = 0;
      res.pipe(file);
      res.on('data', (c) => {
        received += c.length;
        if (total) {
          const pct = (received / total * 100).toFixed(1);
          process.stdout.write(`\r📥 ${path.basename(dest)}: ${received}/${total} (${pct}%)`);
        }
      });
      file.on('finish', () => {
        process.stdout.write('\n');
        file.close(() => resolve());
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureWeights() {
  fsSync.mkdirSync(WEIGHTS, { recursive: true });
  log('📦', `准备 face-api 模型到 ${WEIGHTS}`);
  for (const f of WEIGHT_FILES) {
    const dest = path.join(WEIGHTS, f.name);
    if (fsSync.existsSync(dest) && fsSync.statSync(dest).size > 0) {
      log('✓', `已存在: ${f.name}`);
      continue;
    }
    log('⬇️ ', `下载: ${f.name}`);
    try {
      await downloadFile(f.url, dest);
      log('✅', `完成: ${f.name}`);
    } catch (e) {
      log('❌', `失败: ${f.name} - ${e.message}`);
      throw e;
    }
  }
}

// ── 收集图片 URL ─────────────────────────────────
async function collectUrls() {
  const cfg = await readViewerConfig();
  if (SOURCE === 'fallback') {
    log('📂', `数据源: viewer 的 fallbackImages(${cfg.fallbackImages.length} 张)`);
    return cfg.fallbackImages.map((u, i) => ({ url: u, name: `fallback-${i}` }));
  }

  if (!cfg.apiBase || !cfg.listPath) {
    log('⚠️', '未配置 apiBase/listPath,回退到 fallbackImages');
    return cfg.fallbackImages.map((u, i) => ({ url: u, name: `fallback-${i}` }));
  }
  const url = cfg.apiBase + cfg.listPath +
              `?order=newest&per_page=${cfg.perPage || 60}`;
  log('🌐', `请求上游: ${url}`);

  const token = cfg.token || await readLocalSecret('QUBU_TOKEN');
  if (cfg.authType !== 'none' && !token) {
    throw new Error('缺少 QUBU_TOKEN，请在 viewer 根目录 .dev.vars 中配置');
  }

  const headers = { Accept: 'application/json' };
  if (token && cfg.authType === 'bearer') {
    headers.Authorization = 'Bearer ' + token;
  } else if (token && cfg.authType === 'header') {
    headers[cfg.authKey] = (cfg.tokenPrefix || '') + token;
  }

  const data = await new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume(); return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });

  const arr = getByPath(data, cfg.imgField);
  if (!Array.isArray(arr)) throw new Error('imgField 路径未命中数组: ' + cfg.imgField);

  return arr
    .map((it) => ({
      url: getByPath(it, cfg.imgUrlField),
      name: getByPath(it, cfg.imgNameField) || '',
    }))
    .filter((it) => it.url);
}

// ── 下载单张图 ─────────────────────────────────
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirect = res.headers.location;
        if (redirect) {
          res.resume();
          return resolve(downloadImage(redirect));
        }
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume(); return;
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

// ── 并发控制 ─────────────────────────────────
async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let cur = 0;
  let done = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cur++;
      if (idx >= items.length) return;
      try {
        results[idx] = await mapper(items[idx], idx);
      } catch (e) {
        results[idx] = { _error: e.message };
      }
      done++;
    }
  });
  await Promise.all(workers);
  return results;
}

// ── 主流程 ─────────────────────────────────
async function main() {
  log('✨', 'Lumina AI 批量焦点分析');
  log('⚙️', `strategy=${STRATEGY}, source=${SOURCE}, concurrency=${CONCURRENCY}`);

  // 1. 模型权重
  await ensureWeights();

  if (DOWNLOAD_ONLY) {
    log('🎉', '模型下载完成(--download-only,跳过分析)');
    return;
  }

  // 2. 收集 URL
  const items = await collectUrls();
  log('📊', `共 ${items.length} 张图待处理`);

  if (!items.length) {
    log('❌', '无可处理的图片,退出');
    process.exit(1);
  }

  // 3. 加载模型
  log('📦', `加载 face-api 模型从 ${WEIGHTS}`);
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(WEIGHTS);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(WEIGHTS);
  log('✅', '模型就绪');

  // 4. 读取已有的焦点数据(保留人工标注,不被 AI 覆盖)
  const existing = await readFocalPoints();
  const existingCount = Object.keys(existing).length;
  log('📂', `已读取 viewer/js/focal-points.js (${existingCount} 项,将被保留/合并)`);

  // 4. 逐张检测(并发) — 本轮新检出的存到 detected,最后再 merge
  const detected = {};
  let analyzed = 0;
  let failed = 0;

  await pMap(items, async (it, i) => {
    progress(analyzed + 1, items.length, `${(i+1)}/${items.length} 检测中...`);
    try {
      const buf = await downloadImage(it.url);
      const tf = faceapi.tf;
      const decoded = tf.node ? tf.node.decodeImage(buf, 3) : null;
      if (!decoded) {
        failed++;
        return;
      }
      const detections = await faceapi.detectAllFaces(decoded,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }));
      decoded.dispose();

      if (detections.length === 0) {
        analyzed++;
        return;
      }

      let box;
      if (STRATEGY === 'center') {
        const xs = detections.map((d) => d.box.x);
        const ys = detections.map((d) => d.box.y);
        const xe = detections.map((d) => d.box.x + d.box.width);
        const ye = detections.map((d) => d.box.y + d.box.height);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const w = Math.max(...xe) - x;
        const h = Math.max(...ye) - y;
        box = { x: x + w/2, y: y + h/2 };
      } else {
        const biggest = detections.reduce((a, b) =>
          (a.box.width * a.box.height) > (b.box.width * b.box.height) ? a : b);
        box = {
          x: biggest.box.x + biggest.box.width / 2,
          y: biggest.box.y + biggest.box.height / 2,
        };
      }

      const imgW = detections[0].imageWidth;
      const imgH = detections[0].imageHeight;
      detected[it.url] = {
        x: round(box.x / imgW, 3),
        y: round(box.y / imgH, 3),
      };
      analyzed++;
    } catch (e) {
      failed++;
    } finally {
      if ((analyzed + failed) % 5 === 0 || analyzed + failed === items.length) {
        progress(analyzed + failed, items.length,
          `完成 ${analyzed} 失败 ${failed}`);
      }
    }
  }, CONCURRENCY);

  log('📈', `检测结果: ${analyzed} 张有人脸,${failed} 张失败,${items.length - analyzed - failed} 张无人脸`);

  // 5. 合并:已有的人工标注 + 本轮新检测结果(mergeFocalPoints 在 config-reader.mjs)
  //    - AI 检测到且已有 → 用 AI 的(更新)
  //    - AI 未检测到但已有 → 保留旧值(绝不覆盖人工标注)
  //    - AI 新检出的 → 新增
  const { merged, stats } = mergeFocalPoints(existing, detected);

  log('🔀', `合并结果: 保留旧值 ${stats.kept} / 更新 ${stats.updated} / 新增 ${stats.added}`);

  // 6. 写文件
  await writeFocalPoints(merged);
  log('💾', `已写入 viewer/js/focal-points.js(${Object.keys(merged).length} 项)`);
  log('🎉', '完成');
}

function round(v, n) {
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

main().catch((e) => {
  console.error('❌ 失败:', e);
  process.exit(1);
});
