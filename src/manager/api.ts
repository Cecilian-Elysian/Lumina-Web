/* ============================================================
 * Manager API 层 — 全部本地 tools/server 端点封装
 * ------------------------------------------------------------
 *   /api/viewer-config   读 src/site/config.ts(经 acorn 解析)
 *   /api/focal-points    读/写 src/site/focalPoints.ts
 *   /api/albums(+crud)   读/写 src/site/albums.ts
 *   /api/proxy-images    本地代理拉图床列表
 *   /api/sync-deploy     git 提交并推送指定数据文件
 *   /api/run-ai          AI 批量分析(SSE 流)
 * ============================================================ */
import { ref, inject, provide } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import { getByPath } from '@/shared/utils';
import type { FocalPoint, AlbumsDoc } from '@/shared/types';

/* ── 通用请求 ────────────────────────────── */

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const opt: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (opt.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  return (await r.json()) as T;
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
  url: string;
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
  perPage: number;
  imgField: string;
  imgUrlField: string;
  imgNameField: string;
  fallbackImages: string[];
}

export async function loadViewerConfig(): Promise<ViewerConfig | null> {
  const r = await api<{ ok: boolean; data?: ViewerConfig; error?: string }>('GET', '/api/viewer-config');
  if (!r.ok || !r.data) {
    toast('读取 viewer 配置失败: ' + (r.error ?? ''), 'error');
    return null;
  }
  return r.data;
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

/* ── 图片列表(代理 + 兜底) ───────────────── */

export async function loadImages(): Promise<{ list: MImage[]; usedFallback: boolean }> {
  const cfg = await loadViewerConfig();
  if (!cfg) return { list: [], usedFallback: false };

  let urls: string[] = [];
  let names: string[] = [];
  try {
    const r = await fetch(`/api/proxy-images?per_page=${cfg.perPage || 60}`, { cache: 'no-store' });
    if (r.ok) {
      const json: unknown = await r.json();
      const arr = getByPath((json as { data?: unknown }).data, cfg.imgField);
      if (!Array.isArray(arr)) throw new Error('上游 imgField 未命中数组');
      urls = arr.map((it) => String(getByPath(it, cfg.imgUrlField) ?? '')).filter(Boolean);
      names = arr.map((it) => String(getByPath(it, cfg.imgNameField) ?? ''));
    }
  } catch { /* 落到兜底 */ }

  let usedFallback = false;
  if (!urls.length) {
    urls = cfg.fallbackImages || [];
    names = urls.map(() => '');
    usedFallback = true;
    toast('已使用兜底图列表(代理不可用)', 'warn');
  }

  return {
    list: urls.map((u, i) => ({ url: u, name: names[i] || '' })),
    usedFallback,
  };
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

    let data: { ok?: boolean; code?: string } = {};
    try { data = JSON.parse(dataRaw); } catch { return; }

    if (event === 'log') {
      cb.onLog(String(dataRaw));
      const pm = String(dataRaw).match(/\[(\d+)\/(\d+)\]/);
      if (pm && cb.onProgress) {
        cb.onProgress(Number(pm[1]), Number(pm[2]));
      }
    } else if (event === 'done') {
      cb.onDone(!!data.ok, data.code);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() ?? '';
    for (const b of blocks) handleBlock(b);
  }
}
