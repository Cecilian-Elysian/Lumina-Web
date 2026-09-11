/* ============================================================
 * 统一导航栏 — 所有页面共用同一份 HTML，避免多处复制
 * ------------------------------------------------------------
 * 用法：在每个页面 <body> 末尾引入：
 *   <script src="js/navbar.js" defer></script>
 * 会在页面顶部注入 .navbar，并按当前文件名自动高亮对应链接。
 * ============================================================ */
(function () {
  'use strict';

  const LINKS = [
    { href: 'index.html',   text: '主页' },
    { href: 'gallery.html', text: '图集' },
    { href: '#settings',    text: '设置' }
  ];

  /* 当前文件名 → 应高亮的链接下标（404 等页面无高亮） */
  const ACTIVE_MAP = {
    'index.html':   0,
    'gallery.html': 1
  };

  function currentPage() {
    const name = location.pathname.split('/').pop();
    return name || 'index.html';
  }

  function inject() {
    if (document.querySelector('.navbar')) return; /* 已有导航则不重复 */

    const active = ACTIVE_MAP[currentPage()];
    const navLinks = LINKS.map(function (link, i) {
      return '<a href="' + link.href + '" class="navbar-link' +
             (i === active ? ' active' : '') + '">' + link.text + '</a>';
    }).join('');

    const header = document.createElement('header');
    header.className = 'navbar';
    header.innerHTML =
      '<div><h1 class="navbar-title">Lumina-Web</h1></div>' +
      '<nav class="navbar-nav" aria-label="主导航">' + navLinks + '</nav>';

    document.body.insertBefore(header, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();