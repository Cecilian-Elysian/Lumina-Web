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
 * 加载策略(优化版):
 *   - 全量预创建占位卡片(立即插入轨道,轨道宽度立刻固定 → 滚动基准稳定,不再挤压)
 *   - 首批优先:每行最左侧 FIRST_BATCH_PER_ROW 张图并发加载,加载完 + 最小等待时间到 → 启动滚动
 *   - 后续图片后台并发加载(CONCURRENCY),加载完一张显示一张(不影响轨道宽度)
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

  // ─── 加载策略参数 ───
  // 每行首批优先加载的张数(控制首屏可见区)
  const FIRST_BATCH_PER_ROW = 4;
  // 首批加载完后,再多等这些毫秒才启动滚动(让 fade-in-up 有过渡时间,视觉更自然)
  const FIRST_BATCH_MIN_MS = 600;
  // 后续图片后台并发数(避免一次性并发过多挤占浏览器连接/CPU)
  const CONCURRENCY = 6;
  // 单图加载超时(超时后强制 is-loaded,避免某张卡死整队)
  const PER_IMAGE_TIMEOUT = 3000;

  // 1x1 透明 GIF,作 <img> 占位 src 避免空 src 触发对当前页 URL 的请求
  const PLACEHOLDER_IMG =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  /**
   * 渲染图片墙:按 CONFIG.rows 生成 N 行轨道
   * 行为:全量预创建占位卡(轨道宽度立即固定) → 每行前 N 张首批并发加载 →
   *      首批就绪 + 最小等待 → 克隆副本做无缝循环 + 启动滚动 →
   *      剩余图片后台并发加载,谁先到谁先 fade-in-up。
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

    /* ---- 4. 全量预创建占位卡片(关键:轨道宽度立刻固定,后续加载不再挤压)---- */
    const allEntries = [];
    for (let r = 0; r < rowCount; r++) {
      slices[r].forEach((img, rowIdx) => {
        const globalIndex = shuffled.indexOf(img);
        const card = createPlaceholderCard(img, globalIndex);
        rows[r].track.appendChild(card);
        allEntries.push({ row: r, rowIdx, data: img, globalIndex, card });
      });
    }

    /* ---- 5. 启动滚动(首批图加载完 + 最小等待)---- */
    let scrollStarted = false;
    const startScroll = () => {
      if (scrollStarted || wall.classList.contains('ready')) return;
      scrollStarted = true;
      rows.forEach(({ track }) => {
        const realCards = track.querySelectorAll('.card:not(.copy)');
        realCards.forEach((card) => {
          const copy = card.cloneNode(true);
          copy.classList.add('copy');
          copy.setAttribute('aria-hidden', 'true');
          copy.setAttribute('tabindex', '-1');
          track.appendChild(copy);
        });
      });
      wall.classList.add('ready');
      console.info('[Lumina] 首批就绪,启动无缝循环滚动');
    };

    /* ---- 6. 拆分为"首批"和"后续"两份 ---- */
    const firstBatch = allEntries.filter((e) => e.rowIdx < FIRST_BATCH_PER_ROW);
    const restBatch = allEntries.filter((e) => e.rowIdx >= FIRST_BATCH_PER_ROW);

    /* ---- 7. 并发加载首批,完成后启动滚动 ---- */
    const minTimer = new Promise((r) => setTimeout(r, FIRST_BATCH_MIN_MS));
    await Promise.all([
      Promise.all(firstBatch.map(loadImageInto)),
      minTimer,
    ]);
    startScroll();

    /* ---- 8. 后续图片后台并发加载(不阻塞,不 await)---- */
    runWithConcurrency(restBatch, CONCURRENCY, loadImageInto).then(() => {
      console.info('[Lumina] 全部图片加载完成');
    });
  }

  /**
   * 创建占位卡片:<img> 用 1x1 透明 GIF 占位,不可见(is-loading)
   * 真实 src/srcset 由 loadImageInto 在加载时替换。
   * 这样卡片一开始就占好位置,轨道宽度立即固定,避免后续插入造成挤压。
   */
  function createPlaceholderCard(item, globalIndex) {
    const figure = document.createElement('figure');
    figure.className = 'card';
    figure.dataset.index = globalIndex;

    const img = document.createElement('img');
    img.src = PLACEHOLDER_IMG;
    img.alt = item.name || '图片';
    img.loading = 'eager';
    img.decoding = 'async';
    img.classList.add('is-loading');

    // 加载失败时:
    //   1. 打日志排查(记录 name / thumb / url / 实际失败的 src)
    //   2. 自动回退:若失败的是 2x 原图(url) → 改用 1x 缩略图(thumb)
    //      避免 Retina 屏因原图 404 显示破碎图
    img.addEventListener('error', function onImgError() {
      const failedSrc = img.currentSrc || img.src;
      // 占位 src 失败(理论不会发生)直接跳过
      if (failedSrc === PLACEHOLDER_IMG) return;

      console.warn('[Lumina] 图片加载失败', {
        name: item.name,
        thumb: item.thumb,
        url: item.url,
        failedSrc,
      });

      // 已回退过,不再尝试(防止无限循环)
      if (img.dataset.fallbackDone === 'true') return;

      // 失败的是 2x 原图 → 回退到 thumb
      if (item.thumb && failedSrc === item.url) {
        console.warn('[Lumina] 2x 原图 404,回退到 thumb');
        img.dataset.fallbackDone = 'true';
        img.srcset = ''; // 关掉 srcset,避免再次选 2x
        img.src = item.thumb;
      }
    });

    figure.appendChild(img);
    return figure;
  }

  /**
   * 加载一张图片到其占位卡片。
   * 把占位 src 换成真实 src/srcset,等 load/error/timeout 后切到 is-loaded 触发 fade-in-up。
   */
  function loadImageInto(entry) {
    return new Promise((resolve) => {
      const img = entry.card.querySelector('img');
      if (!img) { resolve(); return; }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        img.classList.remove('is-loading');
        img.classList.add('is-loaded'); // 错误也加,至少让图显示(破碎也看得见)
        resolve();
      };

      // 真实 src/srcset 替换占位(浏览器立即开始请求)
      img.srcset = entry.data.srcset;
      img.src = entry.data.thumb;

      // 焦点注入(无数据时 focal-runtime.js 不做任何操作)
      if (window.FocalRuntime && typeof window.FocalRuntime.applyTo === 'function') {
        window.FocalRuntime.applyTo(img, img.getAttribute('src'));
      }

      if (img.complete && img.naturalWidth > 0) {
        finish();
      } else {
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
        setTimeout(finish, PER_IMAGE_TIMEOUT);
      }
    });
  }

  /**
   * 并发执行任务队列:同时最多 limit 个在跑,完成后取下一个。
   * 返回 Promise,在全部完成时 resolve。
   */
  function runWithConcurrency(items, limit, fn) {
    return new Promise((resolve) => {
      if (items.length === 0) { resolve(); return; }
      let idx = 0;
      let active = 0;
      let remaining = items.length;

      const next = () => {
        while (active < limit && idx < items.length) {
          const item = items[idx++];
          active++;
          Promise.resolve(fn(item)).finally(() => {
            active--;
            remaining--;
            if (remaining === 0) resolve();
            else next();
          });
        }
      };
      next();
    });
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
