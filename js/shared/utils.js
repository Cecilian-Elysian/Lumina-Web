/* ============================================================
 * Lumina 共享工具 — 主页与图集页共用
 * ------------------------------------------------------------
 * 用法:在页面 <head> 或 <body> 中先于 main.js / gallery.js 引入
 *   <script src="js/shared/utils.js" defer></script>
 *
 * 暴露 window.LuminaShared:
 *   - escapeHtml(s)              HTML 转义(防 XSS)
 *   - getByPath(obj, path)       点分路径取值
 *   - shuffle(arr)               Fisher-Yates 原地洗牌
 *   - debounce(fn, wait)         防抖
 *   - showErrorBanner(msg)       顶部红色错误提示条(3s 自动消失)
 * ============================================================ */

(function () {
  'use strict';

  /**
   * HTML 转义:图片名等来自接口的字符串插入页面前先转义,
   * 防止特殊字符(< > " ' &)破坏页面结构或注入脚本(XSS)
   *
   * @param {*} s 原始字符串(null/undefined 自动转空串)
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
   * 按点分路径从对象中取值
   * 例:getByPath({ a: { b: [1,2] } }, 'a.b') → [1, 2]
   * 任一层级不存在时返回 undefined(不抛错,方便兜底)
   *
   * @param {Object} obj 目标对象
   * @param {string} path 点分路径,如 'data.data'
   * @returns {*} 取到的值,取不到时为 undefined
   */
  function getByPath(obj, path) {
    return path
      .split('.')
      .reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
  }

  /**
   * Fisher-Yates 原地洗牌,返回同一引用。
   * 不想修改原数组请传 arr.slice()。
   *
   * @param {Array} arr 待洗牌的数组
   * @returns {Array} 同一数组(已乱序)
   */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 防抖:连续触发只在最后一次 wait 毫秒后执行
   *
   * @param {Function} fn 待包装函数
   * @param {number} wait 等待毫秒
   * @returns {Function}
   */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  /**
   * 在 navbar 下方显示一条错误横条(自动 3s 后淡出)
   * 让上游不可达 / 字段错误等情况对用户可见(不再静默兜底)
   *
   * @param {string} msg 错误提示文本
   */
  function showErrorBanner(msg) {
    // 先移除旧的(避免重复堆叠)
    const old = document.getElementById('error-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.className = 'error-banner';
    banner.textContent = msg;
    banner.setAttribute('role', 'alert');

    // 插在 navbar 后面(若没有则插到 body 顶部)
    const navbar = document.querySelector('.navbar');
    if (navbar && navbar.parentNode) {
      navbar.parentNode.insertBefore(banner, navbar.nextSibling);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    setTimeout(() => {
      banner.classList.add('error-banner-fade');
      setTimeout(() => banner.remove(), 400);
    }, 3000);
  }

  window.LuminaShared = {
    escapeHtml,
    getByPath,
    shuffle,
    debounce,
    showErrorBanner,
  };
})();