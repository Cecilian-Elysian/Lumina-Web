/* ============================================================
 * Lumina 首访 splash 屏 — 控制模块
 * ------------------------------------------------------------
 * 行为:
 *   1. 读 sessionStorage.lumina_splash_seen
 *      - 若已标记,说明 <head> 内联脚本已加 splash-seen 类 → 直接清理 DOM 走人
 *      - 若未标记 → 启动 1.5s 进度条 + 0.6s 退出动画
 *   2. 倒计时结束:加 splash-exit 类 → 600ms 后从 DOM 移除
 *   3. 写入 sessionStorage + 给 <html> 加 splash-seen 类(解封 #wall 等)
 *
 * 协作方:
 *   - <head> 内联脚本在更早时机抢先加 splash-seen(已访客跳过)
 *   - CSS 由 css/style.css 提供 .splash / .splash-bar-fill / .splash-exit
 *   - reduced-motion 偏好:跳过 splash,直接解封
 * ============================================================ */

(function () {
  'use strict';

  var KEY = 'lumina_splash_seen';
  var DURATION = 1500;  // 进度条时长(ms)
  var EXIT_MS = 600;   // 退出动画时长(ms)

  function unlock() {
    try { sessionStorage.setItem(KEY, 'true'); } catch (e) {}
    document.documentElement.classList.add('splash-seen');
  }

  function run() {
    var splash = document.getElementById('splash');
    var html = document.documentElement;
    var force = /[?&]splash=force/.test(location.search);

    // 调试辅助:URL 带 ?splash=force 强制重置 + 重显
    if (force) {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      console.info('[Lumina] ?splash=force 强制显示 splash');
    }

    var alreadySeen = false;
    try { alreadySeen = sessionStorage.getItem(KEY) === 'true'; } catch (e) {}

    // 减少动画偏好:跳过所有动效,直接解封
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      console.info('[Lumina] prefers-reduced-motion:跳过 splash');
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
      unlock();
      return;
    }

    // 已看过(head 内联脚本加了 splash-seen):仅做容错清理
    if (alreadySeen && !force) {
      console.info('[Lumina] 已看过 splash(URL 加 ?splash=force 强制重显)');
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
      return;
    }

    if (!splash) { unlock(); return; }

    console.info('[Lumina] 首访 splash 开始,1.5s 进度条 + 0.6s 退出');

    // 倒计时结束后:加退出类 → 600ms 后从 DOM 移除 → 解封
    setTimeout(function () {
      splash.classList.add('splash-exit');
      setTimeout(function () {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
        unlock();
      }, EXIT_MS);
    }, DURATION);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();