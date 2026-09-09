#!/usr/bin/env node
/* ============================================================
 * Lumina 焦点管理器 — 启动器 + HTTP 服务器
 * ------------------------------------------------------------
 * 双击 tools/start.bat 即调用本文件,职责:
 *   1. 检查 Node.js 版本(≥18)
 *   2. 首次运行自动 npm install
 *   3. 分配端口(默认 8002,冲突顺延)
 *   4. 启动 HTTP 服务器
 *   5. 自动打开浏览器到 /manager/
 *   6. Ctrl+C 优雅关闭
 *
 * 路由:
 *   GET  /                              → 302 → /manager/
 *   GET  /manager/*                     → 本地 manager/ 内静态文件
 *   GET  /api/viewer-config             → 读 ../js/config.js
 *   GET  /api/focal-points              → 读 ../js/focal-points.js
 *   POST /api/focal-points              → 写 ../js/focal-points.js
 *   GET  /api/proxy-images              → 尝试拉取 viewer 上游图床
 *   POST /api/sync-deploy               → 仅提交并推送 js/focal-points.js
 *   POST /api/run-ai                    → spawn AI 工具,SSE 流式输出
 *   GET  /api/albums                    → 读 ../js/albums.js
 *   POST /api/albums                    → 整体覆盖写回
 *   POST /api/albums/add                → 创建新图集,返回 id
 *   POST /api/albums/rename             → 重命名图集
 *   POST /api/albums/delete             → 删除图集(旗下 url 自动降级为未分组)
 *
 * 用法:
 *   node server/serve.mjs               (默认:检查+装依赖+开浏览器)
 *   node server/serve.mjs --no-launch   (不自动开浏览器)
 *   node server/serve.mjs --port=9000   (自定义端口)
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import https from 'node:https';
import net from 'node:net';
import { platform } from 'node:os';

import {
  getViewerDir,
  readViewerConfig,
  readFocalPoints,
  writeFocalPoints,
  readLocalSecret,
  readAlbums,
  writeAlbums,
  addAlbum,
  renameAlbum,
  deleteAlbum,
  getByPath,
} from './lib/config-reader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..');         // tools/
const VIEWER = getViewerDir();
const PROJECT_ROOT = path.resolve(TOOLS, '..');     // Lumina/
const MANAGER = path.resolve(PROJECT_ROOT, 'manager'); // 本地忽略的 manager/

// ── CLI 参数 ─────────────────────────────────────
const cliArgs = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [];
  })
);
const PREFERRED_PORT = Number(cliArgs.port) || 8002;
const NO_LAUNCH = !!cliArgs['no-launch'];
const NO_INSTALL = !!cliArgs['no-install'];
const MAX_PORT_TRIES = 5;

// ── 启动器辅助 ───────────────────────────────────
function log(emoji, msg) {
  console.log(`${emoji} [serve] ${msg}`);
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    log('❌', `Node.js 版本过低(${process.versions.node}),需要 ≥18。请升级 https://nodejs.org`);
    process.exit(1);
  }
  log('✅', `Node.js ${process.versions.node}`);
}

async function ensureDeps() {
  if (NO_INSTALL) {
    log('⏭️', '跳过依赖检查(--no-install)');
    return;
  }
  // 检查 @vladmandic/face-api 是否已就位
  try {
    await fs.access(path.join(TOOLS, 'node_modules', '@vladmandic', 'face-api', 'package.json'));
    log('✅', '依赖已就绪');
  } catch {
    log('📦', '首次运行,正在安装依赖(约 30~60 秒)...');
    const install = spawn('npm', ['install'], {
      cwd: TOOLS,
      stdio: 'inherit',
      shell: true,
    });
    await new Promise((resolve, reject) => {
      install.on('exit', (code) => {
        if (code !== 0) { log('❌', '依赖安装失败'); reject(new Error('install failed')); }
        else { log('✅', '依赖安装完成'); resolve(); }
      });
    });
  }
}

async function ensureManager() {
  try {
    await fs.access(path.join(MANAGER, 'index.html'));
  } catch {
    throw new Error('未找到本地 manager/index.html。该目录被 Git 忽略，请从本机备份恢复。');
  }
}

function tryListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const port = PREFERRED_PORT + i;
    if (await tryListen(port)) return port;
    log('⚠️', `端口 ${port} 被占用,尝试 ${port + 1}`);
  }
  log('❌', `连续 ${MAX_PORT_TRIES} 个端口都被占用,请手动指定 --port`);
  process.exit(1);
}

function openBrowser(url) {
  const cmd = platform() === 'win32'  ? `start "" "${url}"` :
              platform() === 'darwin' ? `open "${url}"` :
                                        `xdg-open "${url}"`;
  spawn(cmd, { shell: true, detached: true, stdio: 'ignore' }).unref();
}

// ── MIME 表 ───────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// ── 静态文件服务(限于本地 manager/ 目录) ─────────
async function serveStatic(req, res, relPath) {
  // relPath 形如 "/manager/index.html"；统一在 manager/ 下查找。
  let rel = relPath.replace(/^\/+/, '');
  if (rel.startsWith('manager/')) rel = rel.slice('manager/'.length);
  if (rel === '' || rel === '/') rel = 'index.html';

  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(MANAGER, safe);
  if (!full.startsWith(MANAGER)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const data = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); res.end('Not Found'); }
    else { res.writeHead(500); res.end(e.message); }
  }
}

// ── 代理 viewer 上游图床 ─────────────────────────
// 单页 GET,带鉴权头,超时 10s。返回原始 JSON。
function getUpstreamPage(url, headers, page, perPage) {
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  u.searchParams.set('per_page', String(perPage));
  return new Promise((resolve, reject) => {
    const req = https.get(u.toString(), { headers, timeout: 10000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        res.resume(); return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('JSON 解析失败(page=' + page + '): ' + e.message)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout(page=' + page + ')')));
  });
}

// 7bu.top 等图床单页最多 40 张。本函数自动并发拉全部页,合并 data.data[],
// 一次性返回所有图。失败时降级返回已拿到的页(可能不完整,但不抛错)。
async function fetchUpstreamImages(perPage) {
  try {
    const CONFIG = await readViewerConfig();
    if (!CONFIG.apiBase || !CONFIG.listPath) return null;

    const token = CONFIG.token || await readLocalSecret('QUBU_TOKEN');
    if (CONFIG.authType !== 'none' && !token) return null;

    const headers = { Accept: 'application/json' };
    if (token && CONFIG.authType === 'bearer') {
      headers.Authorization = 'Bearer ' + token;
    } else if (token && CONFIG.authType === 'header') {
      headers[CONFIG.authKey] = CONFIG.tokenPrefix + token;
    }

    const baseUrl = CONFIG.apiBase + CONFIG.listPath + '?order=newest';
    const requestPerPage = Math.min(40, perPage || CONFIG.perPage || 60);

    // 第 1 页:必拉,用来探测 last_page / total
    const first = await getUpstreamPage(baseUrl, headers, 1, requestPerPage);
    const innerData = (first && first.data) || {};
    const items = Array.isArray(innerData.data) ? innerData.data.slice() : [];
    const total = Number(innerData.total) || items.length;
    const lastPage = Number(innerData.last_page) || 1;

    // 单页就能装下 → 包装成图床原始三段式返回
    if (lastPage <= 1) {
      return wrapUpstream(items, innerData);
    }

    // 多页:并发拉剩余页 (page=2..lastPage)
    const pages = [];
    for (let p = 2; p <= lastPage; p++) pages.push(p);
    const settled = await Promise.allSettled(
      pages.map((p) => getUpstreamPage(baseUrl, headers, p, requestPerPage))
    );

    let okCount = 0;
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        const moreItems = r.value && r.value.data && r.value.data.data;
        if (Array.isArray(moreItems)) {
          items.push(...moreItems);
          okCount++;
        }
      } else {
        log('⚠️ ', `分页 page=${pages[i]} 拉取失败: ${r.reason && r.reason.message || r.reason}`);
      }
    });

    log('📄', `图床分页合并:共 ${total} 张 / ${lastPage} 页,成功 ${okCount + 1}/${lastPage},返回 ${items.length} 张`);
    return wrapUpstream(items, innerData);
  } catch (e) {
    log('❌', `fetchUpstreamImages 失败: ${e.message}`);
    return null;
  }
}

// 包装成图床原始三段式: {status, message, data: {data: items, current_page, last_page, total}}
// 保留 innerData 中的其他字段(如有),仅覆盖 data 数组相关字段。
function wrapUpstream(items, innerData) {
  return {
    status: true,
    message: 'success',
    data: Object.assign({}, innerData, {
      data: items,
      current_page: 1,
      last_page: 1,
      total: items.length,
      per_page: items.length,
    }),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const detail = (stderr || stdout).trim() || `命令退出码 ${code}`;
        reject(new Error(detail));
      }
    });
  });
}

async function syncFocalPoints() {
  const focalPath = 'js/focal-points.js';
  const branch = (await runCommand('git', ['branch', '--show-current'])).stdout;
  if (branch !== 'main') {
    throw new Error(`当前分支为 ${branch || '(detached HEAD)'}，只能从 main 同步`);
  }

  const remote = (await runCommand('git', ['remote', 'get-url', 'origin'])).stdout;
  if (!remote) throw new Error('未配置 Git 远程 origin');

  const status = await runCommand('git', ['status', '--porcelain', '--', focalPath]);
  if (!status.stdout) {
    return { changed: false, message: '焦点文件没有新改动，无需同步' };
  }

  await runCommand('git', ['add', '--', focalPath]);
  const staged = await runCommand('git', ['diff', '--cached', '--quiet', '--', focalPath])
    .then(() => false)
    .catch(() => true);
  if (!staged) {
    return { changed: false, message: '焦点文件没有可提交的改动' };
  }

  try {
    await runCommand('git', ['commit', '-m', 'chore: update image focal points', '--', focalPath]);
  } catch (err) {
    throw new Error('提交失败：' + err.message);
  }

  try {
    await runCommand('git', ['push', 'origin', 'main']);
  } catch (err) {
    throw new Error('已在本地提交焦点文件，但推送失败：' + err.message);
  }

  return {
    changed: true,
    message: '已同步到 GitHub，Cloudflare Pages 将自动部署',
  };
}

// ── 路由处理 ─────────────────────────────────────
async function handle(req, res, url) {
  const pathname = url.pathname;

  // 根路径 → 302 到 Manager
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { Location: '/manager/' });
    res.end();
    return;
  }

  // ── API ──
  if (pathname === '/api/viewer-config' && req.method === 'GET') {
    try {
      const cfg = await readViewerConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          mode: cfg.mode,
          apiBase: cfg.apiBase,
          rows: cfg.rows,
          cardWidth: cfg.cardWidth,
          perPage: cfg.perPage,
          imgField: cfg.imgField,
          imgUrlField: cfg.imgUrlField,
          imgThumbField: cfg.imgThumbField,
          imgNameField: cfg.imgNameField,
          fallbackImages: cfg.fallbackImages || [],
        },
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/focal-points' && req.method === 'GET') {
    try {
      const data = await readFocalPoints();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/focal-points' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const json = JSON.parse(body);
      if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        throw new Error('body 必须是对象');
      }
      const r = await writeFocalPoints(json);
      log('💾', `写入 focal-points.js(${r.count} 项)${r.ok ? '' : ' — ' + r.error}`);
      res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'JSON 解析失败:' + e.message }));
    }
    return;
  }

  if (pathname === '/api/proxy-images' && req.method === 'GET') {
    const perPage = Number(url.searchParams.get('per_page')) || 60;
    const data = await fetchUpstreamImages(perPage);
    if (!data) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '上游不可达,使用兜底图' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data }));
    return;
  }

  if (pathname === '/api/sync-deploy' && req.method === 'POST') {
    try {
      const result = await syncFocalPoints();
      log('↥', result.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (e) {
      log('❌', '同步失败: ' + e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/run-ai' && req.method === 'POST') {
    const body = await readBody(req);
    let strategy = 'max';
    try {
      const j = JSON.parse(body);
      if (j.strategy === 'center' || j.strategy === 'max') strategy = j.strategy;
    } catch {}

    log('🧠', `启动 AI 批量分析(strategy=${strategy})...`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const aiScript = path.resolve(TOOLS, 'ai', 'build-focal-points.mjs');
    const child = spawn(process.execPath, [aiScript, `--strategy=${strategy}`], {
      cwd: TOOLS,
      env: process.env,
    });

    child.stdout.on('data', (chunk) => {
      res.write(`event: log\ndata: ${JSON.stringify(chunk.toString())}\n\n`);
    });
    child.stderr.on('data', (chunk) => {
      res.write(`event: log\ndata: ${JSON.stringify('[stderr] ' + chunk.toString())}\n\n`);
    });
    child.on('exit', (code) => {
      res.write(`event: done\ndata: ${JSON.stringify({ code, ok: code === 0 })}\n\n`);
      res.end();
    });
    res.on('close', () => {
      if (!res.writableEnded && !child.killed) child.kill('SIGTERM');
    });
    return;
  }

  // ── 图集(albums)────────────────────────────
  if (pathname === '/api/albums' && req.method === 'GET') {
    try {
      const data = await readAlbums();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/albums' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const doc = JSON.parse(body);
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc._meta)) {
        throw new Error('body 必须是 { _meta: [...], ... }');
      }
      const r = await writeAlbums(doc);
      log('💾', `写入 albums.js (meta=${r.metaCount}, images=${r.imageCount})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...r }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'JSON 解析失败:' + e.message }));
    }
    return;
  }

  if (pathname === '/api/albums/add' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { name } = JSON.parse(body);
      const r = await addAlbum(name);
      log('➕', `新建图集: ${r.name} (id=${r.id})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/albums/rename' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { id, name } = JSON.parse(body);
      if (!id) throw new Error('id 必填');
      if (!name) throw new Error('name 必填');
      const r = await renameAlbum(id, name);
      log('✏️ ', `重命名图集: ${id} → ${name}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (pathname === '/api/albums/delete' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { id } = JSON.parse(body);
      if (!id) throw new Error('id 必填');
      const r = await deleteAlbum(id);
      log('🗑️ ', `删除图集: ${id} (旗下 ${r.removedCount} 张图降级为未分组)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── 静态文件 ──
  await serveStatic(req, res, pathname);
}

// ── 创建服务器 ───────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PREFERRED_PORT}`);
  try {
    await handle(req, res, url);
  } catch (e) {
    console.error('❌', e);
    res.writeHead(500); res.end(e.message);
  }
});

// ── 启动入口 ─────────────────────────────────────
async function bootstrap() {
  log('✨', 'Lumina 焦点管理器启动中...');
  checkNode();
  await ensureManager();
  await ensureDeps();

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/manager/`;

  // 服务器端口(用实际分配到的)
  const actualServer = server.listen(port, '127.0.0.1', () => {
    log('✨', `Lumina 焦点管理器已启动`);
    log('🌐', `编辑器: ${url}`);
    log('📂', `tools/    = ${TOOLS}`);
    log('📂', `manager/  = ${MANAGER}`);
    log('📂', `viewer/   = ${VIEWER}`);
    log('⏹ ', `按 Ctrl+C 停止服务`);
  });

  if (!NO_LAUNCH) {
    setTimeout(() => {
      log('🌐', `打开浏览器: ${url}`);
      openBrowser(url);
    }, 1500);
  }

  // Ctrl+C 优雅关闭
  const shutdown = () => {
    log('\n🛑', '正在关闭服务...');
    actualServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((e) => {
  console.error('❌ 启动失败:', e);
  process.exit(1);
});
