/* ============================================================
 * 屏保模式 — 模块级单例(同 settings.ts / likes.ts 模式)
 * ------------------------------------------------------------
 * 闲置自动进入(idleMin > 0;任一交互重置计时,1s 节流;后台不触发)
 * 或 URL 直达(?screensaver=1)。退出在 ScreensaverOverlay.vue:
 * pointerdown/keydown/wheel/touchstart 任一;进入后 800ms 输入免疫,
 * 防进入的那下点击秒退;退出信号不含 pointermove(轻微晃动不打断)。
 * 序列:random 走完一圈重洗且首项 ≠ 当前项;seq 按拉取顺序循环。
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

/** show 的世代号:hide() 或新一轮 show() 会使在途 show 的 await 结果作废 */
let showToken = 0;

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

/** 纯函数:前进到下一项。seq 循环;random 走完一圈重洗且避免连续重复。
 *  注:防重复的邻位交换会让原第 2 项作首项的概率略高于均匀分布,
 *  屏保场景可接受。空表防御性返回空 url。 */
export function advancePlaylist(
  list: string[],
  pos: number,
  order: 'random' | 'seq',
): { list: string[]; pos: number; url: string } {
  const total = list.length;
  if (total === 0) return { list, pos, url: '' };
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
  if (document.hidden) {
    // 后台标签页:跳过本轮换图(省下载/解码),保持轮询节奏
    scheduleNext();
    return;
  }
  const next = advancePlaylist(playlist, pos, order());
  playlist = next.list;
  pos = next.pos;
  state.current.value = next.url;
  // 预加载「下一张」(不是刚显示的这张),交叉淡入才不断档
  preload(playlist[(pos + 1) % playlist.length]);
  scheduleNext();
}

/** 预加载指定 url(利用浏览器缓存,交叉淡入不断档) */
function preload(url: string): void {
  if (!url) return;
  const img = new Image();
  img.src = url;
}

/* ---- 对外 API ---- */

/** 供灯箱键盘守卫等外部模块只读屏保开关状态 */
export function isScreensaverActive(): boolean {
  return state.active.value;
}

/** 进入屏保(幂等;图片加载失败回退兜底图,loadImages 永不 reject) */
export async function showScreensaver(): Promise<void> {
  if (state.active.value || starting) return;
  starting = true;
  const myToken = ++showToken;
  try {
    const { images } = await loadImages();
    // await 期间被 hide() 或新一轮 show() 赶上 → 本次作废(hide 必胜)
    if (myToken !== showToken) return;
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
  showToken++; // 作废在途 show
  state.active.value = false;
  state.current.value = '';
  playlist = [];
  pos = 0;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // 闲置计时与其「补武装」一并清掉:退出后不允许残留自动进入,
  // 下一次真实交互会重新武装(hide 可能发生在 rearmTimer 排队期间)
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (rearmTimer) {
    clearTimeout(rearmTimer);
    rearmTimer = null;
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

/** 交互重置节流:高频 pointermove 下避免反复 setTimeout 重排;
 *  注意清除旧计时器不受节流影响(节流只省重新排程),防残留误触发 */
const RESET_THROTTLE_MS = 1000;
let lastResetAt = Number.NEGATIVE_INFINITY;
let rearmTimer: ReturnType<typeof setTimeout> | null = null;

let initialized = false;

/** (重新)武装闲置计时。幂等:已有计时则不动。 */
function armIdleTimer(): void {
  if (idleTimer) return;
  const idleMin = useSettings().settings.value.screensaver.idleMin;
  if (!idleMin || state.active.value || document.hidden) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!document.hidden && !state.active.value) void showScreensaver();
  }, idleMin * 60_000);
}

function resetIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const now = performance.now();
  if (now - lastResetAt < RESET_THROTTLE_MS) {
    // 节流窗内不重排常驻计时,但排一个「窗末补武装」——否则交互风暴
    // 的最后一次事件会把闲置计时清掉却不再补,之后用户彻底静止时
    // 屏保永远不会触发(清了没补的裸奔状态)。
    if (!rearmTimer) {
      rearmTimer = setTimeout(() => {
        rearmTimer = null;
        armIdleTimer();
      }, RESET_THROTTLE_MS);
    }
    return;
  }
  lastResetAt = now;
  armIdleTimer();
}

/** 从后台回到可见:若仍空闲则重新武装闲置计时 */
function onVisibilityChange(): void {
  if (!document.hidden && !state.active.value) resetIdle();
}

/** main 挂载后调用一次:绑定闲置监听 + 处理 ?screensaver=1 直达(幂等) */
export function initScreensaver(): void {
  if (initialized) return;
  initialized = true;

  for (const ev of IDLE_EVENTS) {
    window.addEventListener(ev, resetIdle, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  resetIdle();

  const params = new URLSearchParams(window.location.search);
  if (params.get('screensaver') === '1') void showScreensaver();
}
