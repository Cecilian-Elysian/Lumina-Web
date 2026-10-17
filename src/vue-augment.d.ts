export {};

/* ============================================================
 * Vue 类型补丁:放行模板里的 data-* 属性
 * ------------------------------------------------------------
 * Vue 3.5 的 HTMLAttributes 没有 data-* 的索引签名,但运行时与模板
 * 编译器都允许(AlbumTab 的 :data-url 拖拽用、HomeView 的 :data-index)。
 *
 * 不补这段,tsconfig 的 strictTemplates:true 会把这两处合法的
 * data-* 报成 TS2353。该文件必须有 export(成为模块),
 * 否则 declare module 'vue' 会变成「整体覆盖」而非「合并增强」,
 * 结果是全站 import { ref } from 'vue' 全部报 TS2305。
 * ============================================================ */
declare module 'vue' {
  interface HTMLAttributes {
    [key: `data-${string}`]: unknown;
  }
}
