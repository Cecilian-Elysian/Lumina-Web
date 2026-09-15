/* ============================================================
 * 共享类型 — site 与 manager 通用的数据契约
 * ------------------------------------------------------------
 * ★ 关键约定:
 *   FOCAL_POINTS / ALBUMS 的键永远是 Image.url(原图直链),
 *   不是 thumb。历史上曾用 thumb 查表导致焦点全部失效,
 *   迁移 TS 后由类型系统约束此约定。
 * ============================================================ */

/** 单张图片(apiClient 产出的统一格式) */
export interface Image {
  /** 原图直链(bu.dusays.com 域) — 焦点/图集数据的查表键 */
  url: string;
  /** 缩略图(7bu.top 域),加载快;失败时回退 url */
  thumb: string;
  /** 原始文件名,可为空串 */
  name: string;
  /** `${thumb} 1x, ${url} 2x`,供 Retina 屏 */
  srcset: string;
}

/** 焦点归一化坐标(0=左/上, 1=右/下) */
export interface FocalPoint {
  x: number;
  y: number;
}

/** 图集元数据 */
export interface AlbumMeta {
  id: string;
  name: string;
}

/** albums 数据文件整体: _meta + url→albumId 映射 */
export interface AlbumsDoc {
  _meta: AlbumMeta[];
  [url: string]: AlbumMeta[] | string;
}

/** 聚合后的图集(图集页渲染用) */
export interface Album {
  id: string;
  name: string;
  /** 封面(第一张图的 url) */
  cover: string;
  /** 图集内全部图片 url(按拉取顺序) */
  images: string[];
  count: number;
  /** 未分组兜底图集 */
  unassigned?: boolean;
}

/** 灯箱内展示的单项(只需 url + name) */
export interface LightboxItem {
  url: string;
  name: string;
}
