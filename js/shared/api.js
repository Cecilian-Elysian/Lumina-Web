/* ============================================================
 * Lumina 共享 API — 主页与图集页共用
 * ------------------------------------------------------------
 * 用法:在 utils.js 之后、main.js / gallery.js 之前引入
 *   <script src="js/shared/api.js" defer></script>
 *
 * 暴露 window.LuminaAPI:
 *   - loadImages()   Promise<Array<{url,name,thumb,srcset}>>
 *                    统一格式:{url 原图,name 名,thumb 缩略图,srcset 1x/2x}
 *   - mapImage(item) 单图映射(供高级用法)
 *
 * 依赖:CONFIG(由 js/config.js 以 const 声明,跨 script 可见)
 *      window.LuminaShared.getByPath / showErrorBanner(必须先加载 utils.js)
 * ============================================================ */

(function () {
  'use strict';

  const getByPath = () => window.LuminaShared && window.LuminaShared.getByPath;
  const showBanner = (msg) =>
    window.LuminaShared && window.LuminaShared.showErrorBanner(msg);

  /**
   * 根据 CONFIG.authType 生成请求头对象
   * @returns {Object} fetch 用的 headers
   */
  function buildHeaders() {
    const cfg = CONFIG;
    const headers = { Accept: 'application/json' };

    if (!cfg || !cfg.token || cfg.authType === 'none') return headers;

    if (cfg.authType === 'bearer') {
      headers.Authorization = 'Bearer ' + cfg.token;
    } else if (cfg.authType === 'header') {
      headers[cfg.authKey] = cfg.tokenPrefix + cfg.token;
    }
    return headers;
  }

  /**
   * 按 CONFIG.thumbRewrite 改写缩略图 URL
   * 规则:
   *   null/''          → 不改写,原样返回
   *   'query:<p>'      → 追加查询参数 ?<p>=thumbWidth(URL API 安全拼接)
   *   'replace:<a>::<b>' → 路径子串替换,'::' 是分隔符(避免与 URL 字符冲突)
   *   'append:<s>'     → 字符串末尾追加
   * 任何一步异常都回退原 URL,并在 console 警告,便于排查。
   *
   * @param {string} thumb 原始缩略图 URL
   * @returns {string} 改写后的 URL(失败回退原值)
   */
  function rewriteThumb(thumb) {
    const cfg = CONFIG;
    const rule = cfg && cfg.thumbRewrite;
    if (!rule) return thumb;
    try {
      const separator = rule.indexOf(':');
      const mode = separator === -1 ? rule : rule.slice(0, separator);
      const arg = separator === -1 ? '' : rule.slice(separator + 1);
      if (mode === 'query') {
        const u = new URL(thumb);
        u.searchParams.set(arg, String(cfg.thumbWidth));
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
      console.warn('[Lumina] thumbRewrite 失败,回退原 thumb:', err.message);
    }
    return thumb;
  }

  /**
   * 把图床接口数组元素映射为统一的 { url, name, thumb, srcset } 格式。
   * 支持嵌套字段:字段配置可用点分路径(如 'links.url')。
   *
   * @param {Object} item 图床数组里的单个元素
   * @returns {{url:string, name:string, thumb:string, srcset:string}}
   */
  function mapImage(item) {
    const cfg = CONFIG;
    const _getByPath = getByPath();

    const url = _getByPath(item, cfg.imgUrlField);

    const rawThumb = (cfg.imgThumbField && _getByPath(item, cfg.imgThumbField)) || url;
    const thumb = rewriteThumb(rawThumb);

    const name = (cfg.imgNameField && _getByPath(item, cfg.imgNameField)) || '';
    const srcset = `${thumb} 1x, ${url} 2x`;

    return { url, name, thumb, srcset };
  }

  /**
   * 加载图片列表:
   *   mode = 'proxy'  → 请求本站 /api/images 代理(token 在服务端,前端零暴露)
   *   mode = 'direct' → 前端直连图床(token 在 config.js,会暴露给访问者)
   *   任何一步失败 → 打印警告并回退兜底图,保证页面永远有图可看
   *
   * @returns {Promise<Array<{url:string, name:string, thumb:string, srcset:string}>>}
   */
  async function loadImages() {
    const cfg = CONFIG;
    if (!cfg) throw new Error('CONFIG 未加载,请确保 js/config.js 先于本脚本');

    const _getByPath = getByPath();
    let url, headers;

    if (cfg.mode === 'proxy') {
      // 代理模式:请求同源 Pages Function(functions/api/images.js)
      // 本地需用 `npx wrangler pages dev .` 运行才有该接口;
      // 普通 http.server 下 /api/images 不存在 → 自动回退兜底图(预期行为)
      // &_t= 时间戳做缓存死角:每次刷新生成新 URL,绕开浏览器/CDN 对列表的缓存
      url = '/api/images?per_page=' + cfg.perPage + '&_t=' + Date.now();
      headers = { Accept: 'application/json' }; // 代理注入 token,前端不带
    } else {
      // 直连模式:apiBase/token 任一为空 → 直接使用兜底演示图
      if (!cfg.apiBase || !cfg.token) {
        console.info('[Lumina] 未配置图床接口,使用兜底演示图。请在 js/config.js 中填写。');
        return cfg.fallbackImages.map((u) => ({
          url: u, name: '', thumb: u, srcset: `${u} 1x, ${u} 2x`,
        }));
      }
      url = cfg.apiBase + cfg.listPath +
            '?order=newest&per_page=' + cfg.perPage;
      headers = buildHeaders(); // 带 Authorization 鉴权头
    }

    try {
      const res = await fetch(url, { headers });

      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      }

      const json = await res.json();

      const arr = _getByPath(json, cfg.imgField);
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error('imgField 路径 "' + cfg.imgField + '" 未命中数组,请检查 config.js 字段配置');
      }

      const images = arr
        .map(mapImage)
        .filter((it) => it.url)
        .slice(0, cfg.perPage);

      if (images.length === 0) throw new Error('图片 URL 字段 "' + cfg.imgUrlField + '" 未命中');

      console.info('[Lumina] 图床加载成功,共 ' + images.length + ' 张图片。');
      return images;
    } catch (err) {
      console.warn('[Lumina] 图床加载失败:', err.message, '→ 已回退兜底图。');
      showBanner('图床暂时不可达,已展示兜底演示图 (' + err.message + ')');
      return cfg.fallbackImages.map((u) => ({
        url: u, name: '', thumb: u, srcset: `${u} 1x, ${u} 2x`,
      }));
    }
  }

  window.LuminaAPI = {
    loadImages,
    mapImage,
    buildHeaders,
    rewriteThumb,
  };
})();