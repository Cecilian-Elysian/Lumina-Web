/* ============================================================
 * 流动图片墙 — 主逻辑
 * ------------------------------------------------------------
 * 执行流程（页面打开后自动运行）：
 *
 *   1. loadImages()  拉取图片数据（图床 API 或兜底图）
 *   2. renderWall()  把图片分发到 N 行轨道并渲染 DOM
 *                    （每行内容复制两份 → CSS 平移 -50% 实现无缝循环）
 *   3. 灯箱模块      点击卡片弹出大图，支持 ←/→ 切换、Esc 关闭
 *
 * 依赖：js/config.js 中定义的全局 CONFIG 对象（需先于本文件加载）
 * ============================================================ */

/* ============================================================
 * 模块一：工具函数
 * ============================================================ */

/**
 * 按点分路径从对象中取值
 * 例：getByPath({ a: { b: [1,2] } }, 'a.b') → [1, 2]
 * 任一层级不存在时返回 undefined（不抛错，方便兜底）
 *
 * @param {Object} obj  目标对象
 * @param {string} path 点分路径，如 'data.data'
 * @returns {*} 取到的值，取不到时为 undefined
 */
function getByPath(obj, path) {
  return path
    .split('.')                      // 'data.data' → ['data', 'data']
    .reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

/**
 * HTML 转义：图片名等来自接口的字符串插入页面前先转义，
 * 防止特殊字符（< > " ' &）破坏页面结构或注入脚本（XSS）
 *
 * @param {string} s 原始字符串
 * @returns {string} 转义后的安全字符串
 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 根据 CONFIG.authType 生成请求头对象
 * @returns {Object} fetch 用的 headers
 */
function buildHeaders() {
  const headers = { Accept: 'application/json' }; // 大多数 JSON API 要求

  // 未配置 token 或鉴权方式为 none → 不加鉴权头
  if (!CONFIG.token || CONFIG.authType === 'none') return headers;

  if (CONFIG.authType === 'bearer') {
    // Bearer 方式：Authorization: Bearer <token>
    headers.Authorization = 'Bearer ' + CONFIG.token;
  } else if (CONFIG.authType === 'header') {
    // 自定义头方式：用 authKey 指定的头名 + tokenPrefix 前缀
    headers[CONFIG.authKey] = CONFIG.tokenPrefix + CONFIG.token;
  }
  return headers;
}

/**
 * Fisher-Yates 原地洗牌，返回同一引用。
 * 不想修改原数组请传 arr.slice()。
 * 用于把图床按时间顺序返回的列表随机化后再分发到轨道，
 * 避免大图库下各行图片按上传时间机械排列、视觉单调。
 *
 * @param {Array} arr 待洗牌的数组
 * @returns {Array} 同一数组（已乱序）
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ============================================================
 * 模块二：数据加载（图床 API → 兜底图）
 * ============================================================ */

/**
 * 把图床接口数组元素映射为统一的 { url, name, thumb, srcset } 格式。
 * 支持嵌套字段：字段配置可用点分路径（如 'links.url'）。
 *
 * @param {Object} item 图床数组里的单个元素
 * @returns {{url:string, name:string, thumb:string, srcset:string}} 统一图片对象
 */
function mapImage(item) {
  // 原图直链（必填字段，取不到则该元素会被过滤）
  const url = getByPath(item, CONFIG.imgUrlField);

  // 缩略图地址（可选配置 imgThumbField；取不到时回退原图）
  const rawThumb = (CONFIG.imgThumbField && getByPath(item, CONFIG.imgThumbField)) || url;

  // 按 CONFIG.thumbRewrite 改写缩略图 URL（失败时回退原缩略图）
  const thumb = rewriteThumb(rawThumb);

  // 图片名称（可选配置 imgNameField；灯箱底部展示用）
  const name = (CONFIG.imgNameField && getByPath(item, CONFIG.imgNameField)) || '';

  // srcset:1x 用缩略图（省流量），2x 自动改用原图（Retina 屏清晰）
  const srcset = `${thumb} 1x, ${url} 2x`;

  return { url, name, thumb, srcset };
}

/**
 * 按 CONFIG.thumbRewrite 改写缩略图 URL
 * 规则：
 *   null/''      → 不改写，原样返回
 *   'query:<p>'  → 追加查询参数 ?<p>=thumbWidth（URL API 安全拼接）
 *   'replace:<a>::<b>' → 路径子串替换，'::' 是分隔符（避免与 URL 字符冲突）
 *   'append:<s>' → 字符串末尾追加
 * 任何一步异常都回退原 URL，并在 console 警告，便于排查。
 *
 * @param {string} thumb 原始缩略图 URL
 * @returns {string} 改写后的 URL（失败回退原值）
 */
function rewriteThumb(thumb) {
  const rule = CONFIG.thumbRewrite;
  if (!rule) return thumb;
  try {
    const separator = rule.indexOf(':');
    const mode = separator === -1 ? rule : rule.slice(0, separator);
    const arg = separator === -1 ? '' : rule.slice(separator + 1);
    if (mode === 'query') {
      const u = new URL(thumb);
      u.searchParams.set(arg, String(CONFIG.thumbWidth));
      return u.toString();
    }
    if (mode === 'replace') {
      const parts = arg.split('::');
      const from = parts[0];
      const to = parts.slice(1).join('::'); // 允许替换值里出现 '::'
      return from ? thumb.split(from).join(to) : thumb;
    }
    if (mode === 'append') {
      return thumb + arg;
    }
    console.warn('[Lumina] 未知的 thumbRewrite 模式:', mode);
  } catch (err) {
    console.warn('[Lumina] thumbRewrite 失败，回退原 thumb:', err.message);
  }
  return thumb;
}

/**
 * 加载图片列表：
 *   mode = 'proxy'  → 请求本站 /api/images 代理（token 在服务端，前端零暴露）
 *   mode = 'direct' → 前端直连图床（token 在 config.js，会暴露给访问者）
 *   任何一步失败 → 打印警告并回退兜底图，保证页面永远有图可看
 *
 * @returns {Promise<Array<{url: string, name: string, thumb: string}>>}
 *          统一格式的图片对象数组 { url, name, thumb }
 */
async function loadImages() {
  /* ---- 根据 mode 决定请求地址与鉴权头 ---- */
  let url, headers;

  if (CONFIG.mode === 'proxy') {
    // 代理模式：请求同源 Pages Function（functions/api/images.js）
    // 本地需用 `npx wrangler pages dev .` 运行才有该接口；
    // 普通 http.server 下 /api/images 不存在 → 自动回退兜底图（预期行为）
    // &_t= 时间戳做缓存死角：每次刷新生成新 URL，绕开浏览器/CDN 对列表的缓存
    url = '/api/images?per_page=' + CONFIG.perPage + '&_t=' + Date.now();
    headers = { Accept: 'application/json' }; // 代理注入 token，前端不带
  } else {
    // 直连模式：apiBase/token 任一为空 → 直接使用兜底演示图
    if (!CONFIG.apiBase || !CONFIG.token) {
      console.info('[Lumina] 未配置图床接口，使用兜底演示图。请在 js/config.js 中填写。');
      return CONFIG.fallbackImages.map(url => ({
        url,
        name: '',
        thumb: url,
        srcset: `${url} 1x, ${url} 2x`,
      }));
    }
    url = CONFIG.apiBase + CONFIG.listPath +
          '?order=newest&per_page=' + CONFIG.perPage;
    headers = buildHeaders(); // 带 Authorization 鉴权头
  }

  try {
    const res = await fetch(url, { headers });

    // HTTP 状态异常（401 鉴权失败 / 404 路径错误 / 429 限流等）
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    }

    const json = await res.json();

    // 按 imgField 点分路径取出图片数组，如 'data.data'
    const arr = getByPath(json, CONFIG.imgField);
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('imgField 路径 "' + CONFIG.imgField + '" 未命中数组，请检查 config.js 字段配置');
    }

    // 映射为统一格式 → 过滤缺 URL 的脏数据 → 只保留前 perPage 张
    const images = arr
      .map(mapImage)
      .filter(it => it.url)
      .slice(0, CONFIG.perPage);

    if (images.length === 0) throw new Error('图片 URL 字段 "' + CONFIG.imgUrlField + '" 未命中');

    console.info('[Lumina] 图床加载成功，共 ' + images.length + ' 张图片。');
    return images;

  } catch (err) {
    // —— 情况三：请求失败，回退兜底图（页面不白屏） ——
    console.warn('[Lumina] 图床加载失败：', err.message, '→ 已回退兜底图。');
    return CONFIG.fallbackImages.map(url => ({
      url,
      name: '',
      thumb: url,
      srcset: `${url} 1x, ${url} 2x`,
    }));
  }
}

/* ============================================================
 * 模块三：图片墙渲染（多行叠层 + 无缝循环）
 * ============================================================
 * 无缝循环原理：
 *   每行轨道 (.row-track) 里的图片序列复制【两份】拼接，
 *   CSS 动画把轨道向左平移 -50%（正好一份内容的宽度），
 *   动画结束瞬间轨道 appearance 与起点完全一致 → 循环无缝。
 * ============================================================ */

// 灯箱用的全局图片数组：所有行的图片按顺序汇总到此（统一索引）
let gallery = [];

/**
 * 渲染图片墙：按 CONFIG.rows 生成 N 行轨道
 * 行为:跨行随机打乱成队列 → 一张一张串行加载 → 每张 fade-in-up →
 *      全部加载完 → 克隆副本做无缝循环 → .wall.ready 启动滚动动画
 *
 * @param {Array<{url:string,name:string,thumb:string,srcset:string}>} images 图片数组
 */
async function renderWall(images) {
  const wall = document.getElementById('wall');

  // 一次性洗牌：让各行拿到随机子集、行内顺序也是随机的
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

    // 方向交替：偶数行正向，奇数行反向
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

  /* ---- 6. 逐张加载:每张 decode 完才加载下一张,并触发 fade-in-up ---- */
  for (const item of queue) {
    await loadOneImage(item, rows[item.row]);
  }
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

  // 调试:失败时打印完整 URL 信息,排查哪些图 404
  img.addEventListener('error', () => {
    console.warn('[Lumina] 图片加载失败', {
      name: item.data.name,
      thumb: img.currentSrc || img.src,
      url: item.data.url,
    });
  });

  figure.appendChild(img);

  // 焦点注入(无数据时 focal-runtime.js 不做任何操作)
  if (window.FocalRuntime && typeof window.FocalRuntime.applyTo === 'function') {
    window.FocalRuntime.applyTo(img, img.getAttribute('src'));
  }

  return figure;
}

/* ============================================================
 * 模块四：灯箱（大图预览）
 * ============================================================ */

// 灯箱相关 DOM 引用（initLightbox 时赋值）
let lbEl, lbImg, lbCaption;
// 当前查看的图片在 gallery 中的下标
let current = 0;

/**
 * 初始化灯箱：缓存 DOM、绑定各类关闭/切换事件
 */
function initLightbox() {
  lbEl      = document.getElementById('lightbox');
  lbImg     = document.getElementById('lb-img');
  lbCaption = document.getElementById('lb-caption');

  /* ---- 打开灯箱：事件委托 ----
   * 不给每张卡片单独绑定，而是监听整个图片墙的 click：
   * 通过 e.target.closest('.card') 找到被点的卡片，
   * 读取 data-index 得知是第几张。卡片多时性能更好。 */
  document.getElementById('wall').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openLightbox(Number(card.dataset.index));
  });

  // 上一张 / 下一张 / 关闭 按钮
  document.getElementById('lb-prev').addEventListener('click', () => show(current - 1));
  document.getElementById('lb-next').addEventListener('click', () => show(current + 1));
  document.getElementById('lb-close').addEventListener('click', closeLightbox);

  // 点击半透明遮罩空白处关闭（点图片本身不关闭）
  lbEl.addEventListener('click', (e) => {
    if (e.target === lbEl) closeLightbox();
  });

  // 键盘快捷键：← 上一张 / → 下一张 / Esc 关闭
  document.addEventListener('keydown', (e) => {
    if (lbEl.classList.contains('hidden')) return; // 灯箱未开时忽略
    if (e.key === 'ArrowLeft')  show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
    if (e.key === 'Escape')     closeLightbox();
  });
}

/**
 * 打开灯箱并显示指定图片
 * @param {number} index 图片在 gallery 中的下标
 */
function openLightbox(index) {
  show(index);
  lbEl.classList.remove('hidden'); // 移除 .hidden → CSS 显示灯箱
  document.body.style.overflow = 'hidden'; // 锁住背景滚动
}

/**
 * 切换显示的图片（支持循环：到最后一张再下一张回到第一张）
 * @param {number} index 目标下标
 */
function show(index) {
  const total = gallery.length;
  if (total === 0) return;

  // 循环取模：-1 → 最后一张；total → 0
  current = ((index % total) + total) % total;

  const img = gallery[current];
  lbImg.classList.add('lb-loading');   // 立即设为不可见，等 onload 后移除
  lbImg.onload = lbImg.onerror = () => lbImg.classList.remove('lb-loading');
  lbImg.src = img.url;        // 换大图地址
  if (lbImg.complete) lbImg.classList.remove('lb-loading');
  lbImg.alt = img.name || '图片 ' + (current + 1); // 无障碍描述
  // 底部说明：序号 / 总数 + 图片名
  lbCaption.textContent = (current + 1) + ' / ' + total + (img.name ? ' · ' + img.name : '');
}

/**
 * 关闭灯箱
 */
function closeLightbox() {
  lbEl.classList.add('hidden');       // 加回 .hidden → CSS 隐藏
  document.body.style.overflow = '';  // 恢复背景滚动
}

/* ============================================================
 * 入口：页面加载完成后启动
 * ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  initLightbox();              // 1. 先初始化灯箱（绑定事件）
  const images = await loadImages(); // 2. 拉取图片（异步）
  renderWall(images);          // 3. 渲染图片墙
});
