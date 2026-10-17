/* ============================================================
 * 站点组合式函数 — barrel
 * ------------------------------------------------------------
 * 实现按职责拆在同目录:
 *   useFocal.ts        焦点 → CSS 变量样式(纯绑定,根治旧版查表键错误)
 *   useAlbums.ts       图集聚合(ALBUMS + localStorage 覆盖 + 未分组兜底)
 *   useTags.ts         图片标签(TAGS + localStorage 覆盖)
 *   useLightbox.ts     灯箱单例(App.vue 挂载组件,各视图调用 open)
 *   useErrorBanner.ts  顶部错误横条单例
 * 这里只做转出口,历史引用点('./composables')无需改动。
 * ============================================================ */
export { useFocal } from './useFocal';
export { useAlbums } from './useAlbums';
export { useTags } from './useTags';
export { useLightbox, lightboxIsOpen, LIGHTBOX_ZOOM } from './useLightbox';
export { useErrorBanner } from './useErrorBanner';
