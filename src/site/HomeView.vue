<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { loadImages } from '@/shared/apiClient';
import { shuffle, debounce } from '@/shared/utils';
import type { Image } from '@/shared/types';
import { useSettings } from './settings';
import { useFocal, useLightbox, lightboxIsOpen } from './composables';
import { isScreensaverActive } from './screensaver';
import { windowSize, nextWindow, prefersReducedMotion, STEP_RATIO } from './wallRotate';
import {
  normalizeOffset, flingVelocity, flingStep, isTap,
  DRAG_SLOP, DOUBLE_TAP_MS, FLING_MIN_V, type MoveSample,
} from './wallTouch';

/* ============================================================
 * 黑框 bug 修复说明:
 *   旧版在「首张图加载完」就克隆全部卡片做无缝循环,被克隆的
 *   大多是占位 GIF → 副本永远空白。现在:
 *     1. 先只渲染原图序列,等待全部 @load/@error 完成
 *     2. allLoaded 后才把每行数据双份渲染(displayRows)并加 .ready
 *   副本从诞生起就带真实 src,不再有黑框。
 *
 * 内容轮换说明:
 *   - gallery 为固定顺序全量池,RowItem.gi 始终指向池下标 → 灯箱
 *     open(gallery) 的 ←/→ 导航始终正确。
 *   - 墙上只放一个「登台窗口」(wallRotate.windowSize 计算张数,约为
 *     池子的 60% 且不小于填满一屏所需);到点后滑动窗口换掉约一半
 *     图、并对每行重新洗牌 → 内容与顺序都焕新,不再原地打转。
 *   - 切换用「整墙按行错峰淡出 → 不可见时替换 → 淡入」遮蔽(wallRotate
 *     + styles.css 的 .swapping);轨道 DOM 保留,滚动相位连续,无跳变。
 *   - 下一窗在「排计时」就定好(含整圈重洗后的池顺序),预热与兑现必然同
 *     一批图,换班新卡不会来不及淡入而闪一下。
 *   - 换班那半秒内忽略点击(池可能已重洗,画面上的旧 gi 会开错图)与 resize
 *     (避免与轮换并发两次换班)。
 *   - 开关/间隔来自设置;轮换在 开屏中/后台/拖拽中/已暂停/灯箱打开/
 *     动画关闭/系统要求减少动态效果 时不触发,交互结束重置计时器。
 *   - 窗口张数封顶 WINDOW_MAX(超大图库不必每次预热上百张)。
 *
 * 设置响应式说明:
 *   行数/速度来自 useSettings()(localStorage),改行数时从当前窗口
 *   重建分桶,不重新请求;loadedUrls 按 url 键记录,重建后加载状态
 *   依然有效。卡片宽度走 <html> 上的 --card-w(settings.ts)。
 *
 * 触屏手动说明(桌面不受影响):
 *   - 结构:.row > .row-drag(承接手动位移) > .row-track(CSS 动画)
 *     两层 transform 叠加,动画内核零改动。
 *   - 按住即暂停该行(.is-held);横向拖动拨动墙,位移以轨道宽度的
 *     50% 为周期归一化,永远落在无缝区间内。
 *   - 松手按末段速度惯性衰减(wallTouch.flingStep),松手后动画恢复。
 *   - 双击该行 = 持久暂停/继续(.is-paused);单击卡片仍开灯箱——
 *     触屏上延迟 280ms 开(双击暂停可取消它),桌面即时开;
 *     拖拽/双击手势会抑制紧随其后的合成 click(justDragged)。
 *   - 仅响应 touch 指针(桌面保留 :hover 暂停,见 styles.css)。
 * ============================================================ */

interface RowItem {
  img: Image;
  /** 在全量池 gallery 中的下标(灯箱 ←/→ 用) */
  gi: number;
}

/** 卡片间横向间距(与 styles.css --row-gap 一致,窗口宽度估算用) */
const ROW_GAP = 16;
/** 换班淡出/淡入时长(与 CSS .row-track transition 一致) */
const FADE_MS = 400;
/** 换班时每行的错峰延迟(形成波浪) */
const ROW_STAGGER_MS = 60;

const { focalStyle } = useFocal();
const lb = useLightbox();
const { settings } = useSettings();

/** 全量池(顺序固定;整圈走完时重洗一次) */
const gallery = ref<Image[]>([]);
/** 当前登台窗口内的条目(带池下标,Live 重建行的数据源) */
const windowItems = ref<RowItem[]>([]);
const rows = ref<RowItem[][]>([]);
const total = ref(0);
const allLoaded = ref(false);
/** 换班中(整墙淡出,遮蔽内容替换) */
const swapping = ref(false);
/** 已就绪(加载成功或失败)的图片,控制淡入(键 = img.url) */
const loadedUrls = ref(new Set<string>());
/** 2x 原图 404 时回退 1x 缩略图(键 = img.url) */
const fallbackThumb = ref(new Set<string>());

/* ---- 触屏手动状态 ---- */
/** 每行手动位移 px(外层 .row-drag 的 translateX) */
const dragX = ref<number[]>([]);
/** 手指按住中的行(临时暂停) */
const heldRows = ref(new Set<number>());
/** 双击切换的持久暂停行 */
const pausedRows = ref(new Set<number>());

let safetyTimer: ReturnType<typeof setTimeout> | null = null;

/* 按行数把窗口条目轮转分桶 + 行内打乱(输入已带池下标 gi) */
function buildRows(items: RowItem[], n: number): RowItem[][] {
  const buckets: RowItem[][] = Array.from({ length: n }, () => []);
  items.forEach((it, i) => buckets[i % n].push(it));
  buckets.forEach((b) => shuffle(b));
  return buckets;
}

/* ============================================================
 * 内容轮换:登台窗口 + 每行重排
 * ============================================================ */

/** 当前窗口的池游标(下次从这里滑) */
let cursor = 0;
/** 轮换计时器 */
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
/** 组件已卸载标记(遮蔽在途异步换班) */
let disposed = false;
/** 已发起预加载的 thumb(去重,避免重复 new Image) */
const preloading = new Set<string>();

/**
 * 一次「已排定」的轮换。在 scheduleRotate 时算好(含整圈重洗后的池顺序),
 * 到点直接兑现 —— 这样「预热的那一窗」与「实际换上来的那一窗」必然是同一
 * 批图,不会因重洗而预错。若不在排定时就兑现,新卡会来不及淡入而闪一下。
 */
interface RotationPlan {
  /** 本次取出的池下标(读 pool 字段) */
  indices: number[];
  /** 兑现后游标 */
  nextCursor: number;
  /** 兑现时生效的池顺序(重洗时为新数组) */
  pool: Image[];
}
let rotationPlan: RotationPlan | null = null;

/** 由排定窗口构造条目(读该排定自带的池顺序,不改动全局 gallery) */
function planItems(plan: RotationPlan): RowItem[] {
  return plan.indices.map((gi) => ({ img: plan.pool[gi], gi }));
}

/** 当前应取窗口张数 */
function currentWindowSize(): number {
  return windowSize(
    gallery.value.length,
    settings.value.rows,
    window.innerWidth,
    settings.value.cardWidth,
    ROW_GAP,
  );
}

/** 推演下一窗(纯读:不改游标、不重洗),整圈走完则产出重洗后的新池 */
function planNext(): RotationPlan | null {
  const n = gallery.value.length;
  if (n === 0) return null;
  const size = currentWindowSize();
  const step = Math.max(1, Math.round(size * STEP_RATIO));
  const res = nextWindow(n, cursor, size, step);
  if (res.wrapped) {
    return {
      indices: Array.from({ length: size }, (_, i) => i),
      nextCursor: step % n,
      pool: shuffle(gallery.value.slice()),
    };
  }
  return { indices: res.indices, nextCursor: res.nextCursor, pool: gallery.value };
}

/** 兑现排定:换池 / 前进游标 / 返回窗口条目,并作废该排定 */
function commitPlan(plan: RotationPlan): RowItem[] {
  gallery.value = plan.pool;
  cursor = plan.nextCursor;
  rotationPlan = null;
  return planItems(plan);
}

/** 预取(仅暖浏览器缓存,不改 loadedUrls 以免开屏前误判就绪) */
const preloadImage = (url: string, markKey: string) => {
  if (!url || preloading.has(url)) return;
  preloading.add(url);
  const im = new Image();
  im.onload = im.onerror = () => {
    preloading.delete(url);
    // 墙已就绪后再预热成功 → 按 markKey(原图 url)登记,换班出新卡时不淡入闪白
    if (allLoaded.value) markLoaded(markKey);
  };
  im.src = url;
};

/**
 * 高分屏(srcset 的 2x 候选是原图)预热原图,否则预热缩略图 —
 * 与浏览器实际请求的候选保持一致,否则预热纯属浪费。
 * 登记键统一用 img.url,与模板 loadedUrls.has(img.url) 对齐。
 */
function preloadItems(items: RowItem[]): void {
  const use2x = typeof window !== 'undefined' && window.devicePixelRatio >= 2;
  for (const it of items) preloadImage(use2x ? it.img.url : it.img.thumb, it.img.url);
}

/** 错峰淡出 → 不可见时替换内容 → 淡入(轨道 DOM 保留,滚动相位连续) */
async function swapTo(items: RowItem[]): Promise<void> {
  if (disposed || items.length === 0) return;
  swapping.value = true;
  const waitMs = FADE_MS + ROW_STAGGER_MS * Math.max(0, rows.value.length - 1) + 40;
  await new Promise<void>((r) => setTimeout(r, waitMs));
  if (disposed) return;
  windowItems.value = items;
  rows.value = buildRows(items, settings.value.rows);
  resetTouchState();
  await nextTick();
  if (disposed) return;
  swapping.value = false;
}

/** 鼠标是否正悬停在某行上(CSS 已据此暂停滚动,轮换也须让路) */
function isRowHovered(): boolean {
  return rowEls.some((el) => el != null && el.matches(':hover'));
}

/** 是否允许此刻轮换 */
function canRotate(): boolean {
  return settings.value.autoRotate
    && settings.value.animate
    && !prefersReducedMotion()
    && allLoaded.value
    && !document.hidden
    && !isRowHovered()
    && !active
    && heldRows.value.size === 0
    && pausedRows.value.size === 0
    && !lightboxIsOpen()
    && !isScreensaverActive();
}

/** 是否可以安排计时(开关/动画/减少动态效果/卸载) */
function canScheduleRotate(): boolean {
  return settings.value.autoRotate
    && settings.value.animate
    && !prefersReducedMotion()
    && !disposed;
}

/** 重新排下一次轮换(同时把这一窗排定下来并预热,保证预热即将来时的内容) */
function scheduleRotate(): void {
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (!canScheduleRotate()) { rotationPlan = null; return; }
  rotationPlan = planNext();
  if (rotationPlan) preloadItems(planItems(rotationPlan));
  rotateTimer = setTimeout(rotateNow, settings.value.rotateSec * 1000);
}

async function rotateNow(): Promise<void> {
  rotateTimer = null;
  if (disposed) return;
  if (!canRotate()) { scheduleRotate(); return; }
  // 优先兑现排定的那一窗(排定时已预热);排定缺失才现场推演
  const plan = rotationPlan ?? planNext();
  if (!plan) { scheduleRotate(); return; }
  await swapTo(commitPlan(plan));
  if (!disposed) scheduleRotate();
}

function forceReady() {
  if (allLoaded.value) return;
  if (loadedUrls.value.size < total.value) {
    console.warn('[Lumina] 加载超时/部分失败,强制启动滚动');
  }
  allLoaded.value = true;
  if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
  // 墙就绪后重排一次:此时预热可登记 loadedUrls,换班新卡不淡入闪白
  scheduleRotate();
}

/** 登记某 url 已就绪(加载成功或失败都算,控制淡入) */
function markLoaded(url: string) {
  if (loadedUrls.value.has(url)) return;
  const next = new Set(loadedUrls.value);
  next.add(url);
  loadedUrls.value = next;
  if (total.value > 0 && loadedUrls.value.size >= total.value) forceReady();
}

function onImgDone(img: Image) {
  markLoaded(img.url);
}

function onImgError(img: Image) {
  // Retina 屏选了 2x 原图失败 → 清 srcset,回退 thumb(只试一次,防循环)
  fallbackThumb.value.add(img.url);
  onImgDone(img);
}

/** allLoaded 后每行内容双份 → CSS translateX(-50%) 无缝循环 */
const displayRows = computed<RowItem[][]>(() =>
  allLoaded.value ? rows.value.map((r) => [...r, ...r]) : rows.value,
);

function trackStyle(rowIndex: number): Record<string, string> {
  return {
    animationDirection: rowIndex % 2 === 1 ? 'reverse' : 'normal',
    animationDuration: ((40 + rowIndex * 6) / settings.value.speed) + 's',
    // 换班时的错峰延迟(波浪);非换班态无 effect
    transitionDelay: (rowIndex * ROW_STAGGER_MS) + 'ms',
  };
}

function openLightbox(gi: number) {
  lb.open(gallery.value.map((i) => ({ url: i.url, name: i.name })), gi);
}

/* ============================================================
 * 触屏手势(pointer capture,仅 touch 指针)
 * ============================================================ */
const rowEls: (HTMLElement | null)[] = [];

function setRowRef(r: number, el: unknown) {
  rowEls[r] = el as HTMLElement | null;
}

interface ActiveDrag {
  row: number;
  pointerId: number;
  startX: number;
  startY: number;
  startT: number;
  lastX: number;
  dragging: boolean;
  samples: MoveSample[];
  period: number;
}
let active: ActiveDrag | null = null;
/** 拖拽后抑制紧随其后的合成 click(误开灯箱) */
let justDragged = false;
let justDraggedTimer: ReturnType<typeof setTimeout> | null = null;
/** 触屏延迟开灯箱的定时器(给双击暂停留判定窗口) */
let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null;
/** 最近一次按下的指针类型(触屏点击卡片才延迟开灯箱) */
let lastPointerType = 'mouse';
/** 每行最近一次点按时间(双击判定) */
const lastTap = new Map<number, number>();
/** 每行惯性速度(0 = 无惯性) */
const flingV: number[] = [];
let rafId: number | null = null;
let lastFrameT = 0;

/** 轨道一份内容宽(scrollWidth 为双份) */
function rowPeriod(r: number): number {
  const track = rowEls[r]?.querySelector('.row-track');
  const w = track instanceof HTMLElement ? track.scrollWidth : 0;
  return w / 2;
}

function setDragX(r: number, x: number) {
  const next = dragX.value.slice();
  next[r] = x;
  dragX.value = next;
}

function addHeld(r: number) {
  const s = new Set(heldRows.value); s.add(r); heldRows.value = s;
}
function removeHeld(r: number) {
  const s = new Set(heldRows.value); s.delete(r); heldRows.value = s;
}
function togglePaused(r: number) {
  const s = new Set(pausedRows.value);
  if (s.has(r)) s.delete(r); else s.add(r);
  pausedRows.value = s;
}

function onRowDown(r: number, e: PointerEvent) {
  if (e.pointerType === 'mouse') return; // 桌面用 :hover 暂停,不做鼠标拖拽
  lastPointerType = e.pointerType;
  if (!allLoaded.value || active || swapping.value) return;
  stopFling(r); // 该行惯性立即停,从当前位置接管
  const el = e.currentTarget as HTMLElement;
  el?.setPointerCapture?.(e.pointerId);
  active = {
    row: r,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startT: performance.now(),
    lastX: e.clientX,
    dragging: false,
    samples: [{ x: e.clientX, t: performance.now() }],
    period: 0,
  };
  addHeld(r);
}

function onRowMove(e: PointerEvent) {
  if (!active || active.pointerId !== e.pointerId) return;
  const now = performance.now();
  const dx = e.clientX - active.startX;
  const dy = e.clientY - active.startY;

  if (!active.dragging) {
    if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    active.dragging = true;
    active.period = rowPeriod(active.row);
  }

  active.samples.push({ x: e.clientX, t: now });
  if (active.samples.length > 8) active.samples.shift();

  setDragX(active.row, normalizeOffset((dragX.value[active.row] ?? 0) + (e.clientX - active.lastX), active.period));
  active.lastX = e.clientX;
}

function onRowUp(e: PointerEvent) {
  if (!active || active.pointerId !== e.pointerId) return;
  const el = e.currentTarget as HTMLElement | null;
  if (el && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  removeHeld(active.row);

  const dist = Math.hypot(e.clientX - active.startX, e.clientY - active.startY);
  const dur = performance.now() - active.startT;

  if (active.dragging) {
    justDragged = true;
    if (justDraggedTimer) clearTimeout(justDraggedTimer);
    justDraggedTimer = setTimeout(() => { justDragged = false; }, 150);
    const v = flingVelocity(active.samples);
    if (Math.abs(v) > FLING_MIN_V) startFling(active.row, v);
  } else if (isTap(dist, dur)) {
    handleTap(active.row);
  }
  active = null;
  // 交互结束:重置轮换计时,避免刚松手就换班
  scheduleRotate();
}

/** 单击记录,300ms 内第二次点按 → 切换该行持久暂停 */
function handleTap(r: number) {
  const now = performance.now();
  const prev = lastTap.get(r) ?? -Infinity;
  lastTap.set(r, now);
  if (now - prev < DOUBLE_TAP_MS) {
    lastTap.set(r, -Infinity);
    stopFling(r);
    // 取消第一击排队的开灯箱,并吞掉第二击的合成 click
    if (pendingOpenTimer) { clearTimeout(pendingOpenTimer); pendingOpenTimer = null; }
    justDragged = true;
    if (justDraggedTimer) clearTimeout(justDraggedTimer);
    justDraggedTimer = setTimeout(() => { justDragged = false; }, 150);
    togglePaused(r);
  }
}

function startFling(r: number, v: number) {
  flingV[r] = v;
  if (rafId == null) {
    lastFrameT = performance.now();
    rafId = requestAnimationFrame(flingFrame);
  }
}

function stopFling(r: number) {
  flingV[r] = 0;
}

function flingFrame(now: number) {
  const dt = Math.max(4, Math.min(64, now - lastFrameT));
  lastFrameT = now;
  let moving = false;
  for (let r = 0; r < flingV.length; r++) {
    const v = flingV[r];
    if (!v) continue;
    const [nv, dx] = flingStep(v, dt);
    flingV[r] = nv;
    if (nv === 0) continue;
    moving = true;
    setDragX(r, normalizeOffset((dragX.value[r] ?? 0) + dx, rowPeriod(r)));
  }
  rafId = moving ? requestAnimationFrame(flingFrame) : null;
}

/** 卡片点击入口:拖拽手势后的合成 click 不开灯箱;
 * 触屏延迟 280ms 开,双击(暂停/继续)可在此窗口内取消它 */
function onCardClick(gi: number) {
  // 换班中:池顺序可能已被重洗,画面上的旧 gi 会开错图,直接忽略
  if (swapping.value) return;
  if (justDragged) {
    justDragged = false;
    return;
  }
  if (lastPointerType === 'touch') {
    if (pendingOpenTimer) return; // 已有等待中的打开(双击的第二击)
    pendingOpenTimer = setTimeout(() => {
      pendingOpenTimer = null;
      openLightbox(gi);
    }, 280);
    return;
  }
  openLightbox(gi);
}

/* 行数变更 → 从当前窗口重建分桶(不重新请求),触屏状态一并复位 */
watch(() => settings.value.rows, (n) => {
  if (windowItems.value.length > 0) rows.value = buildRows(windowItems.value, n);
  resetTouchState();
  scheduleRotate();
});

/* 轮换开关/间隔变更 → 立刻重排(关闭则清计时器) */
watch(
  [() => settings.value.autoRotate, () => settings.value.rotateSec],
  () => scheduleRotate(),
);

/* 卡片宽度变更 → 窗口「填满一屏」下限可能变化,重算并要求补足 */
watch(() => settings.value.cardWidth, () => onResize());

/** 视口变化:仅当窗口需「变宽补卡」时重建(避免循环露白);防抖 */
const onResize = debounce(() => {
  const n = gallery.value.length;
  // 换班中忽略本次 resize,避免与轮换并发两次换班
  if (disposed || n === 0 || swapping.value) return;
  const size = currentWindowSize();
  if (size <= windowItems.value.length) return;
  const plan = planNext();
  if (!plan) return;
  void swapTo(commitPlan(plan));
}, 300);

function onVisibilityChange() {
  // 回到前台时重置轮换计时(后台不计时),并刷新下一窗预热
  if (!document.hidden) scheduleRotate();
}

/** 系统「减少动态效果」开关变化 → 立刻停/启轮换 */
function onMotionPrefChange() {
  scheduleRotate();
}

/** 订阅减少动态效果变化(旧版 Safari 只有 addListener) */
let motionQuery: MediaQueryList | null = null;
function watchMotionPref() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', onMotionPrefChange);
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener(onMotionPrefChange);
  }
}

function unwatchMotionPref() {
  if (!motionQuery) return;
  if (typeof motionQuery.removeEventListener === 'function') {
    motionQuery.removeEventListener('change', onMotionPrefChange);
  } else if (typeof motionQuery.removeListener === 'function') {
    motionQuery.removeListener(onMotionPrefChange);
  }
  motionQuery = null;
}

function resetTouchState() {
  dragX.value = rows.value.map(() => 0);
  flingV.length = rows.value.length;
  flingV.fill(0);
  heldRows.value = new Set();
  pausedRows.value = new Set();
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
}

onMounted(async () => {
  disposed = false;

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  watchMotionPref();

  const { images } = await loadImages();
  if (disposed) return;

  gallery.value = shuffle(images.slice());

  // 首屏 = 池中第一个登台窗口
  const first = planNext();
  const items = first ? commitPlan(first) : [];
  windowItems.value = items;
  total.value = new Set(items.map((it) => it.img.url)).size;

  rows.value = buildRows(items, settings.value.rows);
  resetTouchState();

  if (total.value > 0) {
    // 30 秒兜底:个别图片卡死也强制启动(失败图显示深灰底)
    safetyTimer = setTimeout(forceReady, 30000);
    scheduleRotate();
  } else {
    allLoaded.value = true;
  }
});

onUnmounted(() => {
  disposed = true;
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  unwatchMotionPref();
  if (safetyTimer) clearTimeout(safetyTimer);
  if (justDraggedTimer) clearTimeout(justDraggedTimer);
  if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
  if (rotateTimer) { clearTimeout(rotateTimer); rotateTimer = null; }
  if (rafId != null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <main class="wall" :class="{ ready: allLoaded, swapping }" aria-label="流动图片墙">
    <!-- 列表请求中:名单未到,墙还是空的 -->
    <div v-if="total === 0" class="wall-loading">加载中…</div>
    <!-- 图片下载中:灰色占位相框已就位,这里给出进度,避免只剩空墙 -->
    <div
      v-else-if="total > 0 && !allLoaded"
      class="wall-progress"
      role="status"
    >加载图片 {{ loadedUrls.size }} / {{ total }}</div>

    <div
      v-for="(row, r) in displayRows"
      :key="r"
      :ref="(el) => setRowRef(r, el)"
      class="row"
      :class="{ 'is-held': heldRows.has(r), 'is-paused': pausedRows.has(r) }"
      @pointerdown="onRowDown(r, $event)"
      @pointermove="onRowMove"
      @pointerup="onRowUp"
      @pointercancel="onRowUp"
    >
      <div class="row-drag" :style="{ transform: `translateX(${dragX[r] ?? 0}px)` }">
        <div class="row-track" :style="trackStyle(r)">
          <figure
            v-for="(item, j) in row"
            :key="`${r}-${item.gi}-${j < row.length / 2 ? 'a' : 'b'}`"
            class="card"
            :data-index="item.gi"
            @click="onCardClick(item.gi)"
          >
            <img
              :src="item.img.thumb"
              :srcset="fallbackThumb.has(item.img.url) ? undefined : item.img.srcset"
              :alt="item.img.name || '图片'"
              :style="focalStyle(item.img.url)"
              :class="{ 'is-loaded': loadedUrls.has(item.img.url) }"
              loading="eager"
              decoding="async"
              @load="onImgDone(item.img)"
              @error="onImgError(item.img)"
            >
          </figure>
        </div>
      </div>
    </div>
  </main>
</template>
