/* ============================================================
 * 图集(手动分类)— 图片-图集映射数据桥
 * ------------------------------------------------------------
 * 由本地 manager/ 可视化编辑器(拖拽)离线产出。
 * 格式:
 *   window.ALBUMS = {
 *     _meta: [ { id: "abc123", name: "德克萨斯" }, ... ],
 *     "https://.../a.jpg": "abc123",   // url → album id
 *     "https://.../b.jpg": "def456"
 *   };
 *
 * 规则:
 *   - 一个 url 至多一个 album id;未出现的 url = 未分组
 *   - _meta 数组顺序决定图集显示顺序
 *   - 删除图集时该 id 的所有 url 映射自动移除(降级为未分组)
 *
 * 浏览器侧(可在 DevTools 临时覆盖):
 *   localStorage.setItem('lumina.album.local', JSON.stringify({
 *     'https://...jpg': 'abc123'
 *   }))
 * ============================================================ */
window.ALBUMS = {
  "_meta": [
    {
      "id": "00000001",
      "name": "德克萨斯"
    }
  ],
  "https://bu.dusays.com/2026/08/04/6a71cd89ebd59.jpg": "00000001",
  "https://bu.dusays.com/2026/08/04/6a71e67ca957f.jpg": "00000001",
  "https://bu.dusays.com/2026/08/04/6a71e68e7c675.jpg": "00000001",
  "https://bu.dusays.com/2026/08/04/6a71ed5d3acdd.jpg": "00000001",
  "https://bu.dusays.com/2026/08/05/6a72df8a995d2.jpg": "00000001",
  "https://bu.dusays.com/2026/08/05/6a72e1e316838.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543aec18c9.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543aec93d3.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543b142698.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543b4e47a6.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543be8af5f.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543c080d97.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543c13d1ba.jpg": "00000001",
  "https://bu.dusays.com/2026/08/07/6a7543c1b449f.jpg": "00000001",
  "https://bu.dusays.com/2026/08/25/6a8da73da2991.jpg": "00000001",
  "https://bu.dusays.com/2026/08/26/6a8e4886824f2.png": "00000001"
};
