/* ============================================================
 * 光影画廊 (gallery.html) — 主逻辑
 * ------------------------------------------------------------
 * 图集模式:
 *   1. LuminaAPI.loadImages()   拉取图片列表(图床 API → 兜底图)
 *   2. buildAlbums()            按 ALBUMS._meta + url 映射聚合图集
 *                               未分配 url 归入末尾"未分组"
 *   3. renderGalleries()        渲染网格
 *   4. initSearch()             启用搜索框(图集名大小写不敏感匹配)
 *   5. LuminaLightbox.create()  复用灯箱(点击卡片打开相册内图片)
 *
 * 依赖(由 gallery.html 按顺序加载):
 *   js/shared/utils.js     → window.LuminaShared
 *   js/shared/api.js       → window.LuminaAPI
 *   js/shared/lightbox.js  → window.LuminaLightbox
 *   js/albums.js          → window.ALBUMS
 *   js/album-runtime.js   → window.AlbumRuntime
 *   js/config.js          → window.CONFIG
 * ============================================================ */

(function () {
  'use strict';

  const { escapeHtml, debounce } = window.LuminaShared;

  // 当前渲染的相册列表(供点击灯箱时反查 data-index)
  let currentAlbums = [];
  let allAlbums = [];
  // 灯箱实例
  let lb = null;

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
  // 灯箱触发
  // ───────────────────────────────────────────────

  function initLightbox() {
    lb = window.LuminaLightbox.create({
      lbEl: document.getElementById('lightbox'),
      lbImg: document.getElementById('lb-img'),
      lbCaption: document.getElementById('lb-caption'),
      lbClose: document.getElementById('lb-close'),
      lbPrev: document.getElementById('lb-prev'),
      lbNext: document.getElementById('lb-next'),
    });

    // 点击卡片 → 用该图集的图片作为画廊,从头开始
    document.getElementById('gallery-grid').addEventListener('click', (e) => {
      const card = e.target.closest('.gallery-card');
      if (!card) return;
      const idx = Number(card.dataset.index);
      const album = currentAlbums[idx];
      if (!album) return;
      const imgs = (album.images && album.images.length > 0) ? album.images : [album.cover];
      lb.open(imgs.map((url) => ({ url, name: album.name })), 0);
    });

    // 键盘 Enter / Space 触发卡片
    document.getElementById('gallery-grid').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.gallery-card');
      if (!card) return;
      e.preventDefault();
      card.click();
    });
  }

  // ───────────────────────────────────────────────
  // 入口
  // ───────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    initLightbox(); // 先建,后用

    const images = await window.LuminaAPI.loadImages();
    let albums = buildAlbums(images);

    // 兜底:若图集模式一条都没聚合出,且 CONFIG.galleries 有数据 → 用旧版相册
    if (albums.length === 0) {
      albums = buildLegacyAlbums();
    }

    allAlbums = albums;
    renderGalleries(albums);
    initSearch();

    const input = document.getElementById('search-input');
    if (input) input.disabled = false;

    updateResultCount(albums.length, albums.length, '');
  });
})();