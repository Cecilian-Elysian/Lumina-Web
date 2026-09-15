/* ============================================================
 * 图集数据(纯字面量数据)
 * ------------------------------------------------------------
 * 由本地 Manager(拖拽)离线产出。
 *   _meta: [{id, name}] — 图集元数据,数组顺序决定显示顺序
 *   其余键: url → albumId
 *   未出现的 url = 未分组
 *
 * 【本文件保持纯字面量:禁 import / 类型注解,tools/server 用 acorn 解析】
 * ============================================================ */
export const ALBUMS = {
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
