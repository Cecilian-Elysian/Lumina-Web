/* ============================================================
 * 屏保模式 — 模块级单例(同 settings.ts / likes.ts 模式)
 * ------------------------------------------------------------
 * 职责:
 *   - active/current 状态 + 图片序列管理与预加载
 *   - initScreensaver():App.vue 挂载时调用一次
 *       · 闲置自动进入(idleMin > 0 时;pointermove/按下/按键/滚轮/
 *         触摸任一交互重置计时;标签页隐藏时不触发)
 *       · URL 直达:?screensaver=1 图片加载完立即进入
 *
 * 序列策略:
 *   - random:Fisher-Yates 洗牌,走完一圈重洗,
 *     且保证重洗后首项 ≠ 当前项(单图列表除外,避免连续重复)
 *   - seq:按拉取顺序循环
 *
 * 退出由 ScreensaverOverlay.vue 处理(pointerdown/keydown/wheel/
 * touchstart 任一;进入后 800ms 输入免疫,防进入的那下点击秒退)。
 * 注意:退出信号不含 pointermove——鼠标轻微晃动不应打断屏保。
 * ============================================================ */
import { ref } from 'vue';
import { loadImages } from '@/shared/apiClient';
import { useSettings } from './settings';

/* ---- 模块级单例状态 ---- */
const state = {
  active: ref(false),
  /** 当前展示的原图 url(空串 = 无) */
  current: ref<string>(''),
};

/** 当前播放序列与游标(非响应式,仅内部消费) */
let playlist: string[] = [];
let pos = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let starting = false;

/* ---- 纯函数(导出供测试) ---- */

/** Fisher-Yates 洗牌(返回新数组,不改原列表) */
export function shuffled(list: string[]): string[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 纯函数:前进到下一项。seq 循环;random 走完一圈重洗且避免连续重复。 */
export function advancePlaylist(
  list: string[],
  pos: number,
  order: 'random' | 'seq',
): { list: string[]; pos: number; url: string } {
  const total = list.length;
  const nextPos = (pos + 1) % total;
  if (order === 'seq' || nextPos !== 0) {
    return { list, pos: nextPos, url: list[nextPos] };
  }
  // random 且恰好走完一圈 → 重洗;首项撞上当前图时与邻位交换(单图列表除外)
  const reshuffled = shuffled(list);
  if (total > 1 && reshuffled[0] === list[pos]) {
    [reshuffled[0], reshuffled[1]] = [reshuffled[1], reshuffled[0]];
  }
  return { list: reshuffled, pos: 0, url: reshuffled[0] };
}

/* ---- 内部:切换与预加载 ---- */

function order(): 'random' | 'seq' {
  return useSettings().settings.value.screensaver.order;
}

function intervalSec(): number {
  return useSettings().settings.value.screensaver.intervalSec;
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(advance, intervalSec() * 1000);
}

function advance(): void {
  if (!state.active.value || playlist.length === 0) return;
  const next = advancePlaylist(playlist, pos, order());
  playlist = next.list;
  pos = next.pos;
  state.current.value = next.url;
  preload(next.url);
  scheduleNext();
}

/** 预加载指定 url(利用浏览器缓存,交叉淡入不断档) */
function preload(url: string): void {
  if (!url) return;
  const img = new Image();
  img.src = url;
}

/* ---- 对外 API ---- */

/** 进入屏保(幂等;图片加载失败回退兜底图,loadImages 永不 reject) */
export async function showScreensaver(): Promise<void> {
  if (state.active.value || starting) return;
  starting = true;
  try {
    const { images } = await loadImages();
    if (images.length === 0) return;
    const urls = images.map((it) => it.url);
    playlist = order() === 'random' ? shuffled(urls) : urls;
    pos = 0;
    state.active.value = true;
    state.current.value = playlist[0];
    if (playlist.length > 1) preload(playlist[1]);
    scheduleNext();
  } finally {
    starting = false;
  }
}

/** 退出屏保并清理序列与计时器 */
export function hideScreensaver(): void {
  state.active.value = false;
  state.current.value = '';
  playlist = [];
  pos = 0;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function useScreensaver() {
  return {
    active: state.active,
    current: state.current,
    show: showScreensaver,
    hide: hideScreensaver,
  };
}

/* ---- 闲置自动进入 + URL 直达 ---- */

/** 视为「用户活跃」的交互事件(指针移动也算;退出信号则不含 move) */
const IDLE_EVENTS: Array<keyof WindowEventMap> = [
  'pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart',
];

function resetIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const idleMin = useSettings().settings.value.screensaver.idleMin;
  if (!idleMin || state.active.value || document.hidden) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!document.hidden && !state.active.value) void showScreensaver();
  }, idleMin * 60_000);
}

/** main 挂载后调用一次:绑定闲置监听 + 处理 ?screensaver=1 直达 */
export function initScreensaver(): void {
  for (const ev of IDLE_EVENTS) {
    window.addEventListener(ev, resetIdle, { passive: true });
  }
  resetIdle();

  const params = new URLSearchParams(window.location.search);
  if (params.has('screensaver')) void showScreensaver();
}
