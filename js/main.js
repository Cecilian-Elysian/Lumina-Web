/* ============================================================
 * 流动图片墙 — 主逻辑
 * ------------------------------------------------------------
 * 执行流程(页面打开后自动运行):
 *
 *   1. LuminaAPI.loadImages()  拉取图片数据(图床 API 或兜底图)
 *   2. renderWall()            把图片分发到 N 行轨道并渲染 DOM
 *                             (每行内容复制两份 → CSS 平移 -50% 实现无缝循环)
 *   3. LuminaLightbox.create() 灯箱模块,点击卡片弹出大图,支持 ←/→ 切换、Esc 关闭
 *
 * 依赖(由 index.html 按顺序加载):
 *   js/config.js          → window.CONFIG(渲染行数 / 卡片宽度等)
 *   js/shared/utils.js     → window.LuminaShared(shuffle / showErrorBanner / 等)
 *   js/shared/api.js       → window.LuminaAPI(loadImages)
 *   js/shared/lightbox.js  → window.LuminaLightbox.create()
 *   js/focal-points.js     → window.FOCAL_POINTS(焦点数据)
 *   js/focal-runtime.js    → window.FocalRuntime(应用焦点到 <img>)
 * ============================================================ */

(function () {
  'use strict';

  // 灯箱实例(由 initLightbox 赋值)
  let lb = null;
  // 当前墙上图片序列(供灯箱 ←/→ 切换,跨行随机后)
  let gallery = [];

  /**
   * 渲染图片墙:按 CONFIG.rows 生成 N 行轨道
   * 行为:跨行随机打乱成队列 → 一张一张串行加载 → 每张 fade-in-up →
   *      全部加载完 → 克隆副本做无缝循环 → .wall.ready 启动滚动动画
   *
   * @param {Array<{url:string,name:string,thumb:string,srcset:string}>} images
   */
  async function renderWall(images) {
    const wall = document.getElementById('wall');
    const shuffle = window.LuminaShared.shuffle;

    // 一次性洗牌:让各行拿到随机子集、行内顺序也是随机的
    const shuffled = shuffle(images.slice());
    // 灯箱 ←/→ 跟墙上顺序保持一致
    gallery = shuffled;
    console.info('[Lumina] 共加载', images.length, '张图,跨', CONFIG.rows, '行');

    const rowCount = CONFIG.rows;

    /* ---- 1. 预创建空行容器(没有 <img>)---- */
    const rows = [];
    for (let r = 0; r < rowCount; r++) {
      const row = document.createElement('div');
      row.className = 'row';

      const track = document.createElement('div');
      track.className = 'row-track';

      // 方向交替:偶数行正向,奇数行反向
      track.style.animationDirection = (r % 2 === 1) ? 'reverse' : 'normal';
      // 各行速度错开(基准 40s,每行 +6s),流动更自然
      track.style.animationDuration = (40 + r * 6) + 's';
      track.style.setProperty('--card-w', CONFIG.cardWidth + 'px');

      row.appendChild(track);
      wall.appendChild(row);
      rows.push({ track });
    }

    /* ---- 2. 按行分组图片 ---- */
    const slices = [];
    for (let r = 0; r < rowCount; r++) {
      slices.push(shuffled.filter((_, i) => i % rowCount === r));
    }

    /* ---- 3. 每行独立打乱(让行内出现顺序也是随机的)---- */
    for (let r = 0; r < rowCount; r++) {
      shuffle(slices[r]);
    }

    /* ---- 4. 跨行打乱成加载队列(随机行顺序)---- */
    const queue = [];
    for (let r = 0; r < rowCount; r++) {
      slices[r].forEach((img) => {
        queue.push({
          row: r,
          data: img,
          // shuffled.indexOf = 在 shuffled 中的位置 = gallery 索引
          // 灯箱点击用此值定位 gallery[] 中的图
          globalIndex: shuffled.indexOf(img),
        });
      });
    }
    shuffle(queue);

    /* ---- 5. 兜底:30 秒后无论加载进度如何,强制进入滚动 ---- */
    const finalize = () => finalizeWall(wall, rows, rowCount);
    const safetyTimer = setTimeout(() => {
      if (!wall.classList.contains('ready')) {
        console.warn('[Lumina] 加载超时,强制启动滚动动画');
        finalize();
      }
    }, 30000);

    /* ---- 6. 并行加载:所有 thumb 同时发起 fetch,浏览器自带 HTTP 并发,
     *       各卡独立淡入(loadOneImage 内部按 globalIndex 设错峰 delay)---- */
    await Promise.all(queue.map((item) => loadOneImage(item, rows[item.row])));
    clearTimeout(safetyTimer);
    finalize();
  }

  /**
   * 最终化:克隆副本做无缝循环 + 加 .ready 启动滚动
   */
  function finalizeWall(wall, rows, rowCount) {
    if (wall.classList.contains('ready')) return;
    for (let r = 0; r < rowCount; r++) {
      const track = rows[r].track;
      const realCards = track.querySelectorAll('.card:not(.copy)');
      realCards.forEach((card) => {
        const copy = card.cloneNode(true);
        copy.classList.add('copy');
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('tabindex', '-1');
        track.appendChild(copy);
      });
    }
    wall.classList.add('ready');
    console.info('[Lumina] 全部图片加载完,启动无缝循环滚动');
  }

  /**
   * 顺序加载一张图片到指定行,完成后 resolve。
   * 等图真的解码完成(img.complete + naturalWidth)才继续,
   * 失败/超时也 resolve 以免阻塞整个队列。
   */
  function loadOneImage(item, rowEl) {
    return new Promise((resolve) => {
      const card = createCard(item);
      const img = card.querySelector('img');
      if (img) img.classList.add('is-loading');
      rowEl.track.appendChild(card);

      if (!img) { resolve(); return; }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        img.classList.remove('is-loading');
        img.classList.add('is-loaded'); // 错误也加,至少让图显示(破碎也看得见)
        resolve();
      };

      if (img.complete && img.naturalWidth > 0) {
        finish();
      } else {
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', () => {
          console.warn('[Lumina] loadOneImage error:', img.currentSrc || img.src);
          finish();
        }, { once: true });
        setTimeout(finish, 5000); // 超时兜底
      }
    });
  }

  /**
   * 创建一张卡片(DOM 方式,无需 HTML 转义)。
   * loading="eager" 由我们控制顺序,lazy 反而坏事。
   */
  function createCard(item) {
    const figure = document.createElement('figure');
    figure.className = 'card';
    figure.dataset.index = item.globalIndex;

    const img = document.createElement('img');
    img.src = item.data.thumb;
    img.srcset = item.data.srcset;
    img.alt = item.data.name || '图片';
    img.loading = 'eager';
    img.decoding = 'async';

    // 加载失败时:
    //   1. 打日志排查(记录 name / thumb / url / 实际失败的 src)
    //   2. 自动回退:若失败的是 2x 原图(url) → 改用 1x 缩略图(thumb)
    //      避免 Retina 屏因原图 404 显示破碎图
    img.addEventListener('error', function onImgError() {
      const failedSrc = img.currentSrc || img.src;
      console.warn('[Lumina] 图片加载失败', {
        name: item.data.name,
        thumb: item.data.thumb,
        url: item.data.url,
        failedSrc,
      });

      // 已回退过,不再尝试(防止无限循环)
      if (img.dataset.fallbackDone === 'true') return;

      // 失败的是 2x 原图 → 回退到 thumb
      if (item.data.thumb && failedSrc === item.data.url) {
        console.warn('[Lumina] 2x 原图 404,回退到 thumb');
        img.dataset.fallbackDone = 'true';
        img.srcset = ''; // 关掉 srcset,避免再次选 2x
        img.src = item.data.thumb;
      }
    });

    figure.appendChild(img);

    // 焦点注入(无数据时 focal-runtime.js 不做任何操作)
    if (window.FocalRuntime && typeof window.FocalRuntime.applyTo === 'function') {
      window.FocalRuntime.applyTo(img, img.getAttribute('src'));
    }

    return figure;
  }

  /**
   * 初始化灯箱:由 LuminaLightbox.create 工厂封装所有状态与事件。
   * 这里只需绑定"点击墙上卡片 → 打开对应图"的触发器。
   */
  function initLightbox() {
    lb = window.LuminaLightbox.create({
      lbEl: document.getElementById('lightbox'),
      lbImg: document.getElementById('lb-img'),
      lbCaption: document.getElementById('lb-caption'),
      lbClose: document.getElementById('lb-close'),
      lbPrev: document.getElementById('lb-prev'),
      lbNext: document.getElementById('lb-next'),
    });

    // 事件委托:整墙一个监听,通过 data-index 定位
    document.getElementById('wall').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) lb.open(gallery, Number(card.dataset.index));
    });
  }

  /* ============================================================
   * 入口:页面加载完成后启动
   * ============================================================ */
  document.addEventListener('DOMContentLoaded', async () => {
    initLightbox();                                  // 1. 灯箱
    const images = await window.LuminaAPI.loadImages(); // 2. 拉图
    renderWall(images);                              // 3. 渲染
  });
})();