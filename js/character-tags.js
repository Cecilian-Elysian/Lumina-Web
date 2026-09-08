/* ============================================================
 * 角色图集 — 图片-角色映射数据桥
 * ------------------------------------------------------------
 * 由 tools/ai/build-character-tags.mjs (MiniMax VLM) 离线产出。
 * 格式:{ [imageUrl]: "角色名" | null }
 *   - 角色名必须在 CONFIG.characters.allowlist 中,否则会被前端视为"未分类"
 *   - null 表示 VLM 判定图中无 allowlist 中的角色
 *   - 缺失(URL 不在本表中)等价于 null
 *
 * 手动覆盖(浏览器级):
 *   localStorage.setItem('lumina.character.local', JSON.stringify({
 *     'https://...jpg': '德克萨斯'
 *   }))
 * 由 js/character-runtime.js 合并,优先级 localStorage > 本表 > null。
 * ============================================================ */
window.CHARACTER_TAGS = {
  // 初始为空;运行 `node tools/ai/build-character-tags.mjs` 后会自动填充
};