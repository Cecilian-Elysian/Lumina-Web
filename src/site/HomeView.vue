<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { loadImages } from '@/shared/apiClient';
import { shuffle } from '@/shared/utils';
import type { Image } from '@/shared/types';
import { useSettings } from './settings';
import { useFocal, useLightbox } from './composables';
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
 * 设置响应式说明:
 *   行数/速度来自 useSettings()(localStorage),改行数时从已拉取的
 *   gallery 重建分桶,不重新请求;loadedUrls 按 url 键记录,重建后
 *   加载状态依然有效。卡片宽度走 <html> 上的 --card-w(settings.ts)。
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
  /** 在扁平 gallery 中的下标(灯箱 ←/→ 用) */
  gi: number;
}

const { focalStyle } = useFocal();
const lb = useLightbox();
const { settings } = useSettings();

const gallery = ref<Image[]>([]);
const rows = ref<RowItem[][]>([]);
const total = ref(0);
const allLoaded = ref(false);
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

/** 按行数把图片轮转分桶 + 行内打乱(纯函数,便于测试/重建) */
function buildRows(list: Image[], n: number): RowItem[][] {
  const buckets: RowItem[][] = Array.from({ length: n }, () => []);
  list.forEach((img, gi) => buckets[gi % n].push({ img, gi }));
  buckets.forEach((b) => shuffle(b));
  return buckets;
}

function forceReady() {
  if (allLoaded.value) return;
  if (loadedUrls.value.size < total.value) {
    console.warn('[Lumina] 加载超时/部分失败,强制启动滚动');
  }
  allLoaded.value = true;
  if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
}

function onImgDone(img: Image) {
  if (!loadedUrls.value.has(img.url)) {
    const next = new Set(loadedUrls.value);
    next.add(img.url);
    loadedUrls.value = next;
  }
  if (total.value > 0 && loadedUrls.value.size >= total.value) forceReady();
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
  if (!allLoaded.value || active) return;
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

/* 行数变更 → 从已拉取数据重建分桶(不重新请求),触屏状态一并复位 */
watch(() => settings.value.rows, (n) => {
  if (gallery.value.length > 0) rows.value = buildRows(gallery.value, n);
  resetTouchState();
});

function resetTouchState() {
  dragX.value = rows.value.map(() => 0);
  flingV.length = rows.value.length;
  flingV.fill(0);
  heldRows.value = new Set();
  pausedRows.value = new Set();
  if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
}

onMounted(async () => {
  const { images } = await loadImages();

  const shuffled = shuffle(images.slice());
  gallery.value = shuffled;
  total.value = shuffled.length;

  rows.value = buildRows(shuffled, settings.value.rows);
  resetTouchState();

  if (total.value > 0) {
    // 30 秒兜底:个别图片卡死也强制启动(失败图显示深灰底)
    safetyTimer = setTimeout(forceReady, 30000);
  } else {
    allLoaded.value = true;
  }
});

onUnmounted(() => {
  if (safetyTimer) clearTimeout(safetyTimer);
  if (justDraggedTimer) clearTimeout(justDraggedTimer);
  if (pendingOpenTimer) clearTimeout(pendingOpenTimer);
  if (rafId != null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <main class="wall" :class="{ ready: allLoaded }" aria-label="流动图片墙">
    <div v-if="total === 0" class="wall-loading">加载中…</div>

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
