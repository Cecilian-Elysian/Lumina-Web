/* ============================================================
 * Lumina — 图片标签数据(纯字面量)
 * ------------------------------------------------------------
 * ★ 与 focalPoints.ts / albums.ts 相同的「纯字面量」约束:
 *   - 禁止 import / 类型注解 / as const / 模板字符串
 *   - 只允许 Object / Array / string / number / boolean / null
 *   - tools 服务端用 acorn 静态解析,绝不能出现表达式
 *
 * 格式:{ [图片原图 url]: string[] 标签数组 }
 * ★ 键约定:键永远是 Image.url(原图直链),不是 thumb
 *   (历史教训:焦点曾因用 thumb 查表 100% 失效)。
 *
 * 浏览器侧临时覆盖(DevTools,刷新生效):
 *   localStorage.setItem('lumina.tags.local', JSON.stringify({
 *     'https://.../a.jpg': ['德克萨斯', '立绘'],
 *     'https://.../b.jpg': null,   // null = 清空该图全部标签
 *   }))
 * ============================================================ */
export const TAGS = {
};
