/* ============================================================
 * useAlbums — 图集聚合
 * ------------------------------------------------------------
 * 优先级: localStorage(lumina.album.local) > ALBUMS 静态数据。
 * 仅保留本次实际拉到的 url(过滤图床已下架的旧记录);
 * 未分配的 url 归入末尾「未分组」。
 * ============================================================ */
import { computed } from 'vue';
import type { Image, Album, AlbumMeta } from '@/shared/types';
import { ALBUMS } from './albums';

const LS_ALBUM_KEY = 'lumina.album.local';

function readAlbumOverrides(): Record<string, string | null> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_ALBUM_KEY) || '{}');
    // LS 是用户数据,可能是任何东西(旧版格式/手动改动/损坏):
    // 只接受纯对象,键值只留 null(解除归属)与字符串,其余整体作废。
    // 不设防的话 JSON.parse('null') 会让 Object.entries 直接抛 TypeError,
    // 图集页整个白屏。
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function buildMapping(): Record<string, string> {
  const metaById: Record<string, AlbumMeta> = {};
  for (const a of ALBUMS._meta) metaById[a.id] = a;

  const mapping: Record<string, string> = {};
  for (const [url, id] of Object.entries(ALBUMS)) {
    if (url === '_meta') continue;
    if (typeof id === 'string' && metaById[id]) mapping[url] = id;
  }
  // LS 覆盖:null = 解除归属,其余覆盖静态值
  for (const [url, id] of Object.entries(readAlbumOverrides())) {
    if (id == null) delete mapping[url];
    else if (typeof id === 'string' && metaById[id]) mapping[url] = id;
  }
  return mapping;
}

export function useAlbums(images: () => Image[]) {
  const albums = computed<Album[]>(() => {
    const list = images();
    const mapping = buildMapping();
    const out: Album[] = [];

    for (const a of ALBUMS._meta) {
      const urls = Object.keys(mapping).filter((u) => mapping[u] === a.id);
      const imgs = list.filter((it) => urls.includes(it.url));
      if (imgs.length === 0) continue;
      out.push({
        id: a.id,
        name: a.name,
        cover: imgs[0].url,
        images: imgs.map((it) => it.url),
        count: imgs.length,
      });
    }

    const assigned = new Set(out.flatMap((a) => a.images));
    const unassigned = list.filter((it) => !assigned.has(it.url));
    if (unassigned.length > 0) {
      out.push({
        id: '',
        name: '未分组',
        cover: unassigned[0].url,
        images: unassigned.map((it) => it.url),
        count: unassigned.length,
        unassigned: true,
      });
    }
    return out;
  });

  return albums;
}
