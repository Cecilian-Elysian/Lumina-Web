/* ============================================================
 * 图集 — 运行时消费者(纯消费者)
 * ------------------------------------------------------------
 * 职责:
 *   1. 读取 window.ALBUMS(由 albums.js 注入的静态数据)
 *   2. 读取 localStorage.lumina.album.local(浏览器级手动覆盖)
 *   3. 提供 AlbumRuntime API(gallery.html / 第三方消费者调用)
 *
 * 优先级: localStorage > 静态 ALBUMS > null(未分组)
 *
 * 不暴露任何 UI;管理打标请通过本地 manager/(拖拽)。
 * ============================================================ */
(function () {
  'use strict';

  const STATIC = (typeof window !== 'undefined' && window.ALBUMS) || { _meta: [] };
  const LS_KEY = 'lumina.album.local';

  // ── 解析静态 ──
  const meta = Array.isArray(STATIC._meta) ? STATIC._meta : [];
  const metaById = {};
  for (const a of meta) {
    if (a && a.id && a.name) metaById[a.id] = { id: a.id, name: a.name };
  }

  // ── 解析 LS ──
  let ls = {};
  try {
    ls = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch (e) {
    console.warn('[Lumina] localStorage.lumina.album.local 解析失败,已忽略。', e);
    ls = {};
  }

  // ── url → albumId 合并:LS 覆盖静态 ──
  const mapping = {};
  for (const url of Object.keys(STATIC)) {
    if (url === '_meta') continue;
    if (metaById[STATIC[url]]) mapping[url] = STATIC[url];
  }
  for (const url of Object.keys(ls)) {
    if (ls[url] == null) delete mapping[url];
    else if (metaById[ls[url]]) mapping[url] = ls[url];
  }

  function getMeta() {
    return meta.slice();
  }

  function getAlbumOf(url) {
    if (!url) return null;
    const id = mapping[url];
    if (!id) return null;
    return metaById[id] || null;
  }

  function getImagesOf(albumId) {
    if (!albumId || !metaById[albumId]) return [];
    return Object.keys(mapping).filter((u) => mapping[u] === albumId);
  }

  function getUnassigned(urls) {
    if (!Array.isArray(urls)) return [];
    return urls.filter((u) => !mapping[u]);
  }

  function setLocalOverride(url, albumId) {
    if (!url) return;
    try {
      const cur = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (albumId == null || albumId === '') {
        delete cur[url];
        delete mapping[url];
      } else if (metaById[albumId]) {
        cur[url] = albumId;
        mapping[url] = albumId;
      }
      localStorage.setItem(LS_KEY, JSON.stringify(cur));
    } catch (e) {
      console.warn('[Lumina] LS album 写入失败:', e);
    }
  }

  function clearLocalOverride(url) {
    setLocalOverride(url, null);
  }

  // 暴露 API
  window.AlbumRuntime = {
    getMeta,
    getAlbumOf,
    getImagesOf,
    getUnassigned,
    setLocalOverride,
    clearLocalOverride,
    allMappings() { return Object.assign({}, mapping); },
    _metaCount: meta.length,
    _mappingCount: Object.keys(mapping).length,
  };
})();