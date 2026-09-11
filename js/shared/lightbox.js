/* ============================================================
 * Lumina 共享灯箱 — 主页与图集页共用
 * ------------------------------------------------------------
 * 用法:
 *   const lb = LuminaLightbox.create({
 *     lbEl, lbImg, lbCaption, lbClose, lbPrev, lbNext
 *   });
 *   lb.open([{url, name}, ...], startIdx);  // 打开并显示 startIdx
 *   lb.close();
 *
 * 工厂模式:每个页面 create 一次,绑定一次事件,闭包保存 gallery/current。
 * 共享键盘快捷键(← → Esc)、遮罩点击关闭、按钮绑定。
 *
 * 依赖:仅 DOM API,无外部依赖。需在 utils.js 之后引入。
 * ============================================================ */

(function () {
  'use strict';

  /**
   * 创建灯箱实例。
   * @param {Object} els  灯箱 DOM 引用
   * @param {HTMLElement} els.lbEl        灯箱外层(#lightbox)
   * @param {HTMLImageElement} els.lbImg  大图本体(#lb-img)
   * @param {HTMLElement} els.lbCaption   底部说明(#lb-caption)
   * @param {HTMLElement} els.lbClose     关闭按钮(#lb-close)
   * @param {HTMLElement} els.lbPrev      上一张按钮(#lb-prev)
   * @param {HTMLElement} els.lbNext      下一张按钮(#lb-next)
   * @returns {{open:Function, close:Function, next:Function, prev:Function}}
   */
  function create(els) {
    const { lbEl, lbImg, lbCaption, lbClose, lbPrev, lbNext } = els;
    if (!lbEl || !lbImg || !lbCaption || !lbClose || !lbPrev || !lbNext) {
      throw new Error('[LuminaLightbox] 缺少必要的 DOM 引用');
    }

    let gallery = [];
    let current = 0;

    /**
     * 渲染第 idx 张(支持循环取模:-1 → 最后一张,total → 第 0 张)
     */
    function render(idx) {
      const total = gallery.length;
      if (total === 0) return;
      current = ((idx % total) + total) % total;

      const img = gallery[current];
      lbImg.classList.add('lb-loading'); // 立即设为不可见,等 onload 后移除
      lbImg.onload = lbImg.onerror = () => lbImg.classList.remove('lb-loading');
      lbImg.src = img.url;
      if (lbImg.complete) lbImg.classList.remove('lb-loading');
      lbImg.alt = img.name || '图片 ' + (current + 1);
      lbCaption.textContent = (current + 1) + ' / ' + total +
        (img.name ? ' · ' + img.name : '');
    }

    /**
     * 打开灯箱并显示指定图片
     * @param {Array<{url:string, name:string}>} images
     * @param {number} [startIdx=0]
     */
    function open(images, startIdx) {
      gallery = images || [];
      render(startIdx || 0);
      lbEl.classList.remove('hidden');
      document.body.style.overflow = 'hidden'; // 锁住背景滚动
    }

    /** 关闭灯箱 */
    function close() {
      lbEl.classList.add('hidden');
      document.body.style.overflow = '';
    }

    function next() { render(current + 1); }
    function prev() { render(current - 1); }

    /* ---- 事件绑定(只绑一次)---- */
    lbClose.addEventListener('click', close);
    lbPrev.addEventListener('click', prev);
    lbNext.addEventListener('click', next);

    // 点击半透明遮罩空白处关闭(点图片本身不关闭)
    lbEl.addEventListener('click', (e) => {
      if (e.target === lbEl) close();
    });

    // 键盘快捷键:← 上一张 / → 下一张 / Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (lbEl.classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft')      prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape')     close();
    });

    return { open, close, next, prev };
  }

  window.LuminaLightbox = { create };
})();