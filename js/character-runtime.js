/* ============================================================
 * 角色图集 — 标签运行时(纯消费者)
 * ------------------------------------------------------------
 * 职责:
 *   1. 读取 window.CHARACTER_TAGS(由 character-tags.js 注入的静态数据)
 *   2. 读取 localStorage.lumina.character.local(浏览器级手动覆盖)
 *   3. 提供 CharacterRuntime.tagOf(url) → 角色名或 null
 *   4. 提供 CharacterRuntime.setLocalOverride(url, name) → 写入 LS
 *
 * 优先级: localStorage > 静态 CHARACTER_TAGS > null
 *
 * 不暴露任何 UI;管理打标请通过 tools/ai/build-character-tags.mjs
 * 或浏览器 Console 操作 localStorage。
 * ============================================================ */
(function () {
  'use strict';

  const STATIC = (typeof window !== 'undefined' && window.CHARACTER_TAGS) || {};
  const LS_KEY = 'lumina.character.local';

  let ls = {};
  try {
    ls = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch (e) {
    console.warn('[Lumina] localStorage.lumina.character.local 解析失败,已忽略。', e);
    ls = {};
  }

  // 合并:LS 覆盖静态。Object.assign 后到的覆盖先到的。
  const store = Object.assign({}, STATIC, ls);

  /**
   * 取一张图的角色标签。
   * @param {string} url
   * @returns {string|null} 角色名,或 null(未识别/无)
   */
  function tagOf(url) {
    if (!url) return null;
    const v = store[url];
    return (typeof v === 'string' && v.length > 0) ? v : null;
  }

  /**
   * 写入浏览器级本地覆盖。
   * @param {string} url
   * @param {string|null} name 传 null 表示删除覆盖
   */
  function setLocalOverride(url, name) {
    if (!url) return;
    try {
      const cur = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (name == null || name === '') {
        delete cur[url];
        delete store[url];
      } else {
        cur[url] = name;
        store[url] = name;
      }
      localStorage.setItem(LS_KEY, JSON.stringify(cur));
    } catch (e) {
      console.warn('[Lumina] LS character 写入失败:', e);
    }
  }

  /**
   * 暴露 API(gallery.js 调用;不暴露管理 UI)。
   */
  window.CharacterRuntime = {
    tagOf,
    setLocalOverride,
    allTags() { return Object.assign({}, store); },
    _store: store,
    _STATIC_COUNT: Object.keys(STATIC).length,
    _LS_COUNT: Object.keys(ls).length,
  };
})();