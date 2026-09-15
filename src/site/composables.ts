/* ============================================================
 * 站点组合式函数 — 视图层的全部有状态逻辑
 * ------------------------------------------------------------
 *   useFocal      焦点 → CSS 变量样式(纯绑定,根治旧版查表键错误)
 *   useAlbums     图集聚合(ALBUMS + localStorage 覆盖 + 未分组兜底)
 *   useLightbox   灯箱单例(App.vue 挂载组件,各视图调用 open)
 * ============================================================ */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { CSSProperties } from 'vue';
import type { Image, Album, AlbumMeta, LightboxItem } from '@/shared/types';
import { FOCAL_POINTS } from './focalPoints';
import { ALBUMS } from './albums';

/* ============================================================
 * useFocal — 焦点样式
 * ------------------------------------------------------------
 * ★ 键约定:FOCAL_POINTS 的键 = Image.url(原图直链)。
 *   旧版曾用 img.src(thumb 域)查表导致焦点 100% 失效,
 *   现改为在模板里 :style 绑定,键来源唯一(url),类型可查。
 * ============================================================ */
export function useFocal() {
  const store = FOCAL_POINTS as Record<string, { x: number; y: number }>;

  /** 返回给定图片的 object-position CSS 变量;无数据返回空对象(回退 CSS 默认 50%/25%) */
  function focalStyle(url: string): CSSProperties {
    const p = store[url];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return {};
    return {
      '--focal-x': (p.x * 100).toFixed(2) + '%',
      '--focal-y': (p.y * 100).toFixed(2) + '%',
    } as CSSProperties;
  }

  return { focalStyle };
}

/* ============================================================
 * useAlbums — 图集聚合
 * ------------------------------------------------------------
 * 优先级: localStorage(lumina.album.local) > ALBUMS 静态数据。
 * 仅保留本次实际拉到的 url(过滤图床已下架的旧记录);
 * 未分配的 url 归入末尾「未分组」。
 * ============================================================ */
const LS_ALBUM_KEY = 'lumina.album.local';

function readAlbumOverrides(): Record<string, string | null> {
  try {
    return JSON.parse(localStorage.getItem(LS_ALBUM_KEY) || '{}');
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

/* ============================================================
 * useLightbox — 灯箱单例
 * ------------------------------------------------------------
 * 模块级单例状态:App.vue 渲染 <Lightbox/>,任意视图调用
 * useLightbox().open(...) 打开,共用同一份列表与键盘事件。
 * ============================================================ */
const lbState = {
  isOpen: ref(false),
  items: ref<LightboxItem[]>([]),
  index: ref(0),
};

function lbOpen(list: LightboxItem[], start = 0) {
  lbState.items.value = list;
  lbState.index.value = start;
  lbState.isOpen.value = true;
}

function lbClose() {
  lbState.isOpen.value = false;
}

function lbNext() {
  const total = lbState.items.value.length;
  if (total === 0) return;
  lbState.index.value = (lbState.index.value + 1) % total;
}

function lbPrev() {
  const total = lbState.items.value.length;
  if (total === 0) return;
  lbState.index.value = (lbState.index.value - 1 + total) % total;
}

function lbOnKey(e: KeyboardEvent) {
  if (!lbState.isOpen.value) return;
  if (e.key === 'Escape') lbClose();
  else if (e.key === 'ArrowRight') lbNext();
  else if (e.key === 'ArrowLeft') lbPrev();
}

/* ============================================================
 * useErrorBanner — 顶部错误横条单例
 * ------------------------------------------------------------
 *   - showBanner(msg)  显示 3 秒后自动淡出
 *   - dismiss()         用户点击 ✕ 立即关闭 + 写入 localStorage
 *   - localStorage 记忆 dismiss:同一会话内(本次浏览器)不再弹相同提示
 * ============================================================ */
const BANNER_LS_KEY = 'lumina.banner.dismissed';

const bannerState = {
  msg: ref(''),
  visible: ref(false),
  fading: ref(false),
  /** 当前消息是否已被用户 dismiss(同一会话内不再弹) */
  dismissed: ref(false),
};

let bannerTimer: ReturnType<typeof setTimeout> | null = null;

function showBanner(msg: string) {
  // 同消息已 dismiss → 跳过(避免每次 fetch 重试都弹)
  if (bannerState.dismissed.value && bannerState.msg.value === msg) return;

  bannerState.msg.value = msg;
  bannerState.fading.value = false;
  bannerState.visible.value = true;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    bannerState.fading.value = true;
    setTimeout(() => { bannerState.visible.value = false; }, 400);
  }, 3000);
}

function dismissBanner() {
  bannerState.visible.value = false;
  bannerState.fading.value = false;
  bannerState.dismissed.value = true;
  try {
    // 仅记忆当前消息(key 用消息前缀,避免日后改文案还能命中)
    const dismissed = JSON.parse(localStorage.getItem(BANNER_LS_KEY) || '{}');
    dismissed[bannerState.msg.value] = true;
    localStorage.setItem(BANNER_LS_KEY, JSON.stringify(dismissed));
  } catch {}
  if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
}

function resetBannerMemory() {
  try { localStorage.removeItem(BANNER_LS_KEY); } catch {}
  bannerState.dismissed.value = false;
}

export function useErrorBanner() {
  return {
    ...bannerState,
    showBanner,
    dismiss: dismissBanner,
    reset: resetBannerMemory,
  };
}

export function useLightbox() {
  onMounted(() => window.addEventListener('keydown', lbOnKey));
  onUnmounted(() => window.removeEventListener('keydown', lbOnKey));

  const current = computed<LightboxItem | null>(() =>
    lbState.items.value[lbState.index.value] ?? null,
  );

  return {
    isOpen: lbState.isOpen,
    items: lbState.items,
    index: lbState.index,
    current,
    open: lbOpen,
    close: lbClose,
    next: lbNext,
    prev: lbPrev,
  };
}
