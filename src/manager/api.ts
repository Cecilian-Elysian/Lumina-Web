/* ============================================================
 * Manager API 层 — 全部本地 tools/server 端点封装
 * ------------------------------------------------------------
 *   /api/viewer-config   读/白名单写 src/site/config.ts
 *   /api/focal-points    读/写 src/site/focalPoints.ts
 *   /api/albums(+crud)   读/写 src/site/albums.ts
 *   /api/tags            读/写 src/site/tags.ts
 *   /api/proxy-images    本地代理拉图床列表
 *   /api/sync-deploy     git 提交并推送指定数据文件
 *   /api/run-ai          AI 批量分析(SSE 流)
 * ============================================================ */
import { ref, inject, provide } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import { getByPath } from '@/shared/utils';
import type { FocalPoint, AlbumsDoc, TagsDoc } from '@/shared/types';

/* ── 通用请求 ────────────────────────────── */

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const opt: RequestInit = {
    method,
    headers: {},
    // 本地端点都是毫秒级;服务挂起时不能让 UI 永远等
    signal: AbortSignal.timeout(10_000),
  };
  if (body !== undefined) {
    (opt.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let r: Response;
  try {
    r = await fetch(path, opt);
  } catch {
    // 网络层失败:fetch 抛的 TypeError 毫无信息量,归一成可读错误
    throw new Error('无法连接本地服务(请确认 serve.mjs 正在运行)');
  }
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // 代理/网关返回了 HTML 错误页之类,原样 r.json() 会抛 SyntaxError
    throw new Error(`本地服务返回非 JSON(HTTP ${r.status})`);
  }
}

/* ── Toast 单例(App 渲染,任意组件调用) ── */

const toastState = {
  msg: ref(''),
  type: ref<'' | 'success' | 'error' | 'warn'>(''),
  visible: ref(false),
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(msg: string, type: '' | 'success' | 'error' | 'warn' = '') {
  toastState.msg.value = msg;
  toastState.type.value = type;
  toastState.visible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastState.visible.value = false; }, 2200);
}

export function useToast() {
  return toastState;
}

/* ── 共享状态(图片列表,App 注入各 Tab) ── */

export interface MImage {
  /** 原图直链:焦点/图集/标签的查表键,也是"打开大图"的目标 */
  url: string;
  /** 缩略图(约 600w):网格里只加载它,上游没给时回落为 url */
  thumb: string;
  name: string;
}

export interface ManagerState {
  images: Ref<MImage[]>;
  imagesLoaded: Ref<boolean>;
}

export const ManagerStateKey: InjectionKey<ManagerState> = Symbol('manager-state');

export function provideManagerState(): ManagerState {
  const state: ManagerState = { images: ref([]), imagesLoaded: ref(false) };
  provide(ManagerStateKey, state);
  return state;
}

export function useManagerState(): ManagerState {
  const s = inject(ManagerStateKey);
  if (!s) throw new Error('ManagerState 未注入');
  return s;
}

/* ── viewer 配置 / 焦点 / 图集 ───────────── */

export interface ViewerConfig {
  mode: string;
  apiBase: string;
  rows?: number;
  cardWidth?: number;
  perPage: number;
  thumbWidth?: number | null;
  imgField: string;
  imgUrlField: string;
  /** 缩略图字段路径(服务端 /api/viewer-config 已返回,历史版本客户端漏声明) */
  imgThumbField?: string;
  imgNameField: string;
  fallbackImages: string[];
}

/** 允许写入 config.ts 的白名单字段(与服务端 CONFIG_WRITE_WHITELIST 一致) */
export const CONFIG_WHITELIST = [
  'rows', 'cardWidth', 'perPage', 'thumbWidth',
] as const;

export type ConfigPatch = Partial<Pick<ViewerConfig, (typeof CONFIG_WHITELIST)[number]>>;

export async function loadViewerConfig(): Promise<ViewerConfig | null> {
  const r = await api<{ ok: boolean; data?: ViewerConfig; error?: string }>('GET', '/api/viewer-config');
  if (!r.ok || !r.data) {
    toast('读取 viewer 配置失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.data;
}

/** 白名单合并写回 config.ts(服务端二次校验) */
export async function saveConfig(patch: ConfigPatch): Promise<string[] | null> {
  const r = await api<{ ok: boolean; updated?: string[]; error?: string }>('POST', '/api/viewer-config', patch);
  if (!r.ok) {
    toast('保存配置失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.updated ?? [];
}

export async function loadFocalPoints(): Promise<Record<string, FocalPoint>> {
  const r = await api<{ ok: boolean; data?: Record<string, FocalPoint>; error?: string }>('GET', '/api/focal-points');
  if (!r.ok) {
    toast('读取 focalPoints.ts 失败: ' + (r.error ?? ''), 'error');
    return {};
  }
  return r.data ?? {};
}

export async function saveFocalPoints(json: Record<string, FocalPoint>): Promise<number | null> {
  const r = await api<{ ok: boolean; count?: number; error?: string }>('POST', '/api/focal-points', json);
  if (!r.ok) {
    toast('保存失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.count ?? 0;
}

export async function loadAlbums(): Promise<AlbumsDoc | null> {
  const r = await api<{ ok: boolean; data?: AlbumsDoc; error?: string }>('GET', '/api/albums');
  if (!r.ok) {
    toast('读取 albums.ts 失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.data ?? { _meta: [] };
}

export async function saveAlbums(doc: AlbumsDoc): Promise<{ metaCount: number; imageCount: number } | null> {
  const r = await api<{ ok: boolean; metaCount?: number; imageCount?: number; error?: string }>('POST', '/api/albums', doc);
  if (!r.ok) {
    toast('保存失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return { metaCount: r.metaCount ?? 0, imageCount: r.imageCount ?? 0 };
}

export async function addAlbum(name: string): Promise<string | null> {
  const r = await api<{ ok: boolean; name?: string; error?: string }>('POST', '/api/albums/add', { name });
  if (!r.ok) {
    toast('创建失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.name ?? name;
}

export async function renameAlbum(id: string, name: string): Promise<string | null> {
  const r = await api<{ ok: boolean; name?: string; error?: string }>('POST', '/api/albums/rename', { id, name });
  if (!r.ok) {
    toast('重命名失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.name ?? name;
}

export async function deleteAlbum(id: string): Promise<number | null> {
  const r = await api<{ ok: boolean; removedCount?: number; error?: string }>('POST', '/api/albums/delete', { id });
  if (!r.ok) {
    toast('删除失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.removedCount ?? 0;
}

/* ── 标签(tags) ──────────────────────────── */

export async function loadTags(): Promise<TagsDoc | null> {
  const r = await api<{ ok: boolean; data?: TagsDoc; error?: string }>('GET', '/api/tags');
  if (!r.ok) {
    toast('读取 tags.ts 失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.data ?? {};
}

/** 返回写入的图片数(打标签的图) */
export async function saveTags(doc: TagsDoc): Promise<number | null> {
  const r = await api<{ ok: boolean; imageCount?: number; error?: string }>('POST', '/api/tags', doc);
  if (!r.ok) {
    toast('保存失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.imageCount ?? 0;
}

/* ── 图片列表(代理 + 兜底) ───────────────── */

export async function loadImages(): Promise<{ list: MImage[]; usedFallback: boolean }> {
  const cfg = await loadViewerConfig();
  if (!cfg) return { list: [], usedFallback: false };

  let rows: MImage[] = [];
  try {
    const r = await fetch(`/api/proxy-images?per_page=${cfg.perPage || 60}`, { cache: 'no-store' });
    if (r.ok) {
      const json: unknown = await r.json();
      const arr = getByPath((json as { data?: unknown }).data, cfg.imgField);
      if (!Array.isArray(arr)) throw new Error('上游 imgField 未命中数组');
      // 先组装再过滤:分开 map + 只过滤 url 会让 name/thumb 整体错位
      rows = (arr as Record<string, unknown>[])
        .map((it) => {
          const url = String(getByPath(it, cfg.imgUrlField) ?? '');
          const thumb = String((cfg.imgThumbField && getByPath(it, cfg.imgThumbField)) || url);
          return { url, thumb, name: String(getByPath(it, cfg.imgNameField) ?? '') };
        })
        .filter((it) => it.url);
    }
  } catch { /* 落到兜底 */ }

  let usedFallback = false;
  if (!rows.length) {
    rows = (cfg.fallbackImages || []).map((u) => ({ url: u, thumb: u, name: '' }));
    usedFallback = true;
    toast('已使用兜底图列表(代理不可用)', 'warn');
  }

  return { list: rows, usedFallback };
}

/** 单飞版 loadImages:四个 Tab 因 v-show 同时挂载,各自的 fetchImages 会
 *  并发发出 3 次相同的代理请求、弹 3 次同样的 toast —— 这里共享同一次
 *  在飞请求,加载完成 toast 只弹一次。 */
let imagesFlight: Promise<{ list: MImage[]; usedFallback: boolean }> | null = null;

export function loadImagesShared(): Promise<{ list: MImage[]; usedFallback: boolean }> {
  if (!imagesFlight) {
    imagesFlight = loadImages()
      .then((r) => {
        toast(`已加载 ${r.list.length} 张图片`, 'success');
        return r;
      })
      .finally(() => { imagesFlight = null; });
  }
  return imagesFlight;
}

/* ── 同步部署(git add/commit/push 指定文件) ── */

export async function syncDeploy(file: string): Promise<string | null> {
  try {
    const r = await api<{ ok: boolean; changed?: boolean; message?: string; error?: string }>(
      'POST', '/api/sync-deploy', { file },
    );
    if (!r.ok) {
      toast('同步失败: ' + (r.error ?? ''), 'error');
      return null;
    }
    return r.message ?? '同步完成';
  } catch (e) {
    toast('同步失败: ' + (e instanceof Error ? e.message : String(e)), 'error');
    return null;
  }
}

/* ── AI 批量分析(SSE 流) ─────────────────── */

export interface AiCallbacks {
  onLog: (text: string) => void;
  onProgress?: (cur: number, total: number) => void;
  onDone: (ok: boolean, code?: string) => void;
}

/**
 * 正确解析 SSE:一个事件块的多个 data: 行按规范用 \n 拼接
 * (旧版正则只取最后一个 data: 行,多行会丢)。
 */
export async function runAi(strategy: string, cb: AiCallbacks): Promise<void> {
  const r = await fetch('/api/run-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy }),
  });
  if (!r.ok || !r.body) {
    toast('AI 启动失败: HTTP ' + r.status, 'error');
    return;
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const handleBlock = (block: string) => {
    const lines = block.split('\n');
    let event = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      const m = line.match(/^(event|data):\s?(.*)$/);
      if (!m) continue;
      if (m[1] === 'event') event = m[2];
      else dataLines.push(m[2]);
    }
    if (dataLines.length === 0) return;
    const dataRaw = dataLines.join('\n');

    // 服务端 log 事件发的是 JSON.stringify(文本),done 发的是 JSON 对象;
    // log 直接展示 dataRaw 会带引号和转义符(\n 显示成字面量)
    let data: unknown = null;
    try { data = JSON.parse(dataRaw); } catch { return; }

    if (event === 'log') {
      const text = typeof data === 'string' ? data : dataRaw;
      cb.onLog(text);
      const pm = text.match(/\[(\d+)\/(\d+)\]/);
      if (pm && cb.onProgress) {
        cb.onProgress(Number(pm[1]), Number(pm[2]));
      }
    } else if (event === 'done') {
      const d = data as { ok?: boolean; code?: string };
      cb.onDone(!!d.ok, d.code);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const b of blocks) handleBlock(b);
    }
  } catch (e) {
    // 流中途断掉(服务被关/网络抖动):不 toast 的话 UI 会永远停在「运行中」
    toast('AI 任务流中断: ' + (e instanceof Error ? e.message : String(e)), 'error');
    cb.onDone(false, 'stream_error');
  }
}
