/* ============================================================
 * 光影画廊 (gallery.html) — 主逻辑
 * ------------------------------------------------------------
 * 图集模式:
 *   1. loadImages()      拉取图片列表(图床 API → 兜底图)
 *   2. buildAlbums()     按 ALBUMS._meta + url 映射聚合图集
 *                        未分配 url 归入末尾"未分组"
 *   3. renderGalleries() 渲染网格
 *   4. initSearch()      启用搜索框(图集名大小写不敏感匹配)
 *   5. initLightbox()    复用灯箱(点击卡片打开相册内图片)
 *
 * 依赖:js/album-runtime.js 需先于本文件加载(暴露 AlbumRuntime)
 *      js/albums.js 提供 window.ALBUMS
 * ============================================================ */

(function () {
  'use strict';

  // ───────────────────────────────────────────────
  // 工具
  // ───────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getByPath(obj, path) {
    return path
      .split('.')
      .reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  // ───────────────────────────────────────────────
  // 数据加载:同 main.js 的 loadImages 子集,只取 url/name
  // ───────────────────────────────────────────────

  async function loadImages() {
    let url, headers;

    if (CONFIG.mode === 'proxy') {
      url = '/api/images?per_page=' + CONFIG.perPage + '&_t=' + Date.now();
      headers = { Accept: 'application/json' };
    } else {
      if (!CONFIG.apiBase || !CONFIG.token) {
        return CONFIG.fallbackImages.map((u) => ({ url: u, name: '' }));
      }
      url = CONFIG.apiBase + CONFIG.listPath +
            '?order=newest&per_page=' + CONFIG.perPage;
      const h = { Accept: 'application/json' };
      if (CONFIG.authType === 'bearer') h.Authorization = 'Bearer ' + CONFIG.token;
      else if (CONFIG.authType === 'header') h[CONFIG.authKey] = CONFIG.tokenPrefix + CONFIG.token;
      headers = h;
    }

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const arr = getByPath(json, CONFIG.imgField);
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error('imgField 未命中数组');
      }
      return arr
        .map((item) => ({
          url: getByPath(item, CONFIG.imgUrlField),
          name: (CONFIG.imgNameField && getByPath(item, CONFIG.imgNameField)) || '',
        }))
        .filter((it) => it.url)
        .slice(0, CONFIG.perPage);
    } catch (e) {
      console.warn('[Lumina gallery] 图片列表拉取失败,使用兜底图:', e.message);
      return CONFIG.fallbackImages.map((u) => ({ url: u, name: '' }));
    }
  }

  // ───────────────────────────────────────────────
  // 图集聚合
  // ───────────────────────────────────────────────

  function buildAlbums(images) {
    const runtime = window.AlbumRuntime;
    if (!runtime) return [];

    const meta = runtime.getMeta();
    const albums = [];

    for (const a of meta) {
      const urls = runtime.getImagesOf(a.id);
      // 仅保留本次拉取到的 url(过滤掉图床已下架的旧记录)
      const imgs = images.filter((it) => urls.indexOf(it.url) >= 0);
      if (imgs.length === 0) continue;
      albums.push({
        id: a.id,
        name: a.name,
        cover: imgs[0].url,
        images: imgs.map((it) => it.url),
        count: imgs.length,
      });
    }

    // 未分组:本批拉到的图,但 ALBUMS 没分配的
    const allUrls = images.map((it) => it.url);
    const assigned = new Set();
    for (const a of albums) for (const u of a.images) assigned.add(u);
    const unassigned = images.filter((it) => !assigned.has(it.url));
    if (unassigned.length > 0) {
      albums.push({
        id: '',
        name: '未分组',
        cover: unassigned[0].url,
        images: unassigned.map((it) => it.url),
        count: unassigned.length,
        unassigned: true,
      });
    }

    return albums;
  }

  function buildLegacyAlbums() {
    if (!Array.isArray(CONFIG.galleries) || CONFIG.galleries.length === 0) return [];
    return CONFIG.galleries.map((g) => ({
      id: '',
      name: g.title,
      cover: g.cover,
      images: (g.images && g.images.length > 0) ? g.images : [g.cover],
      count: (g.images && g.images.length > 0) ? g.images.length : 1,
      date: g.date || '',
      description: g.description || '',
      legacy: true,
    }));
  }

  function albumSearchText(album) {
    return (album.name || '').toLowerCase();
  }

  // ───────────────────────────────────────────────
  // 渲染
  // ───────────────────────────────────────────────

  // 当前渲染的相册列表(供点击灯箱时反查 data-index)
  let currentAlbums = [];

  function renderGalleries(albums) {
    currentAlbums = albums;
    const grid = document.getElementById('gallery-grid');
    const empty = document.getElementById('gallery-empty');
    if (!grid) return;

    if (!albums || albums.length === 0) {
      grid.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');

    grid.innerHTML = albums.map((album, i) => (
      '<article class="gallery-card' + (album.unassigned ? ' is-uncategorized' : '') +
        '" data-index="' + i + '" tabindex="0">' +
        '<img src="' + escapeHtml(album.cover) + '"' +
          ' alt="' + escapeHtml(album.name) + '"' +
          ' loading="lazy" decoding="async">' +
        '<div class="gallery-card-meta">' +
          '<span class="gallery-card-title">' + escapeHtml(album.name) + '</span>' +
          '<span class="gallery-card-count">' + album.count + '</span>' +
        '</div>' +
      '</article>'
    )).join('');
  }

  function updateResultCount(shown, total, query) {
    const el = document.getElementById('result-count');
    if (!el) return;
    if (!query || !query.trim()) {
      el.textContent = total > 0 ? '共 ' + total + ' 个图集' : '';
    } else {
      el.textContent = '匹配 ' + shown + ' / ' + total;
    }
  }

  // ───────────────────────────────────────────────
  // 搜索
  // ───────────────────────────────────────────────

  let allAlbums = [];

  function filterAlbums(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return allAlbums;
    return allAlbums.filter((album) => albumSearchText(album).includes(q));
  }

  function initSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;

    const onInput = debounce(() => {
      const q = input.value;
      const filtered = filterAlbums(q);
      renderGalleries(filtered);
      updateResultCount(filtered.length, allAlbums.length, q);
    }, 80);

    input.addEventListener('input', onInput);

    // ESC 清空
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        onInput();
      }
    });
  }

  // ───────────────────────────────────────────────
  // 灯箱
  // ───────────────────────────────────────────────

  let gallery = [];
  let current = 0;
  let lbEl, lbImg, lbCaption;

  function initLightbox() {
    lbEl      = document.getElementById('lightbox');
    lbImg     = document.getElementById('lb-img');
    lbCaption = document.getElementById('lb-caption');

    document.getElementById('gallery-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.gallery-card');
      if (!card) return;
      const idx = Number(card.dataset.index);
      const album = currentAlbums[idx];
      if (!album) return;
      const imgs = (album.images && album.images.length > 0) ? album.images : [album.cover];
      gallery = imgs.map((url) => ({ url, name: album.name }));
      openLightbox(0);
    });

    // 键盘回车 / 空格
    document.getElementById('gallery-grid').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.gallery-card');
      if (!card) return;
      e.preventDefault();
      card.click();
    });

    document.getElementById('lb-close').addEventListener('click', closeLightbox);
    document.getElementById('lb-prev').addEventListener('click', () => show(current - 1));
    document.getElementById('lb-next').addEventListener('click', () => show(current + 1));

    lbEl.addEventListener('click', (e) => {
      if (e.target === lbEl) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (lbEl.classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
      if (e.key === 'Escape') closeLightbox();
    });
  }

  function openLightbox(idx) {
    show(idx);
    lbEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function show(idx) {
    const total = gallery.length;
    if (total === 0) return;
    current = ((idx % total) + total) % total;
    const img = gallery[current];
    lbImg.classList.add('lb-loading');
    lbImg.onload = lbImg.onerror = () => lbImg.classList.remove('lb-loading');
    lbImg.src = img.url;
    if (lbImg.complete) lbImg.classList.remove('lb-loading');
    lbImg.alt = img.name || '图片 ' + (current + 1);
    lbCaption.textContent = (current + 1) + ' / ' + total +
      (img.name ? ' · ' + img.name : '');
  }

  function closeLightbox() {
    lbEl.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ───────────────────────────────────────────────
  // 入口
  // ───────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    const images = await loadImages();
    let albums = buildAlbums(images);

    // 兜底:若图集模式一条都没聚合出,且 CONFIG.galleries 有数据 → 用旧版相册
    if (albums.length === 0) {
      albums = buildLegacyAlbums();
    }

    allAlbums = albums;
    renderGalleries(albums);
    initSearch();
    initLightbox();

    const input = document.getElementById('search-input');
    if (input) input.disabled = false;

    updateResultCount(albums.length, albums.length, '');
  });
})();