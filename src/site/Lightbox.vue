<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { useLightbox, useTags, LIGHTBOX_ZOOM } from './composables';
import { useLikes } from './likes';
import { useFavorites } from './favorites';
import { formatInt } from '@/shared/utils';

const {
  isOpen, current, index, items, close, next, prev,
  scale, tx, ty, zoomBy, resetView,
} = useLightbox();
const { tagsOf } = useTags();
const { ready: likesReady, likeCount, isLiked, toggleLike } = useLikes();
const { isFav, toggleFav } = useFavorites();

/* 大图换图淡入:src 变化时先透明,load 后显示 */
const imgLoaded = ref(false);
/** 原图加载失败(404/网络/被图床清除):显示占位层而不是 0×0 空白 */
const imgFailed = ref(false);
watch(() => current.value?.url, () => {
  imgLoaded.value = false;
  imgFailed.value = false;
});

/* ---- 邻图预热:左右各 1 张 ----
 * 灯箱加载的是原图(单张常以 MB 计),等点击切换才开始下载,
 * 翻页就是一次空白等待。提前取相邻两张,浏览器会与后续 <img>
 * 请求共享 HTTP 缓存,翻页基本即点即显。 */
watch(index, (i) => {
  const n = items.value.length;
  if (n < 2) return;
  for (const off of [-1, 1]) {
    const u = items.value[(i + off + n) % n]?.url;
    if (u) new Image().src = u;
  }
});

/* ---- 点赞(服务端计数就绪才显示) ---- */
const currentLiked = computed(() => {
  const url = current.value?.url;
  return url ? isLiked(url) : false;
});
const currentLikes = computed(() => {
  const url = current.value?.url;
  return url ? likeCount(url) : 0;
});

function onLike() {
  const url = current.value?.url;
  if (url) toggleLike(url);
}

/* ---- 收藏(纯本地,恒可用) ---- */
const currentFaved = computed(() => {
  const url = current.value?.url;
  return url ? isFav(url) : false;
});

/** 下载/新开目标只认 http(s):url 来自上游 API,
 *  javascript: 之类的伪协议在这里会变成可点击的注入点 */
const safeUrl = computed(() => {
  const u = current.value?.url || '';
  return /^https?:\/\//i.test(u) ? u : '';
});

/** 失败占位的「看下一张」:换图后 watch 会复位 imgFailed */
function nextAfterFail() {
  next();
}

function onFav() {
  const url = current.value?.url;
  if (url) toggleFav(url);
}

/* ---- 滚轮缩放 / 双击缩放 / 拖拽平移 / 触屏滑动与 pinch ----
 * 指针模型(统一鼠标与触屏):
 *   1 指 + scale=1  → 横向滑动切图(跟手,松手过阈值切上/下一张)
 *   1 指 + scale>1  → 平移(原逻辑)
 *   2 指            → pinch 缩放(1–4,双指中心跟随平移)
 *   点按            → 手动双击检测(iOS Safari 不合成 dblclick 的兜底)
 */
const panning = ref(false);
const swiping = ref(false);
/** 滑动跟手位移 px(scale=1 时叠加在 transform 前) */
const swipeDx = ref(0);

/** 滑动切图:位移阈值 px / 快扫最短位移 px / 快扫时长上限 ms */
const SWIPE_THRESHOLD = 60;
const SWIPE_FLICK_DIST = 24;
const SWIPE_FLICK_MS = 220;

/* 滚轮缩放按帧合并:触控板滚动/捏合会以极小粒度每秒触发上百次 wheel,
 * 逐次写 scale 就是每秒上百次组件重渲染。攒进一个非响应式累加器,
 * 到下一帧合并成一步应用 —— zoomBy 内部按序钳制,合并前后结果完全一致。 */
let pendingZoomStep = 0;
let zoomRaf: number | null = null;

function flushZoom() {
  zoomRaf = null;
  const d = pendingZoomStep;
  pendingZoomStep = 0;
  if (d !== 0) zoomBy(d);
}

function onWheel(e: WheelEvent) {
  pendingZoomStep += e.deltaY < 0 ? LIGHTBOX_ZOOM.step : -LIGHTBOX_ZOOM.step;
  if (zoomRaf == null) zoomRaf = requestAnimationFrame(flushZoom);
}

/** 手动双击后的时间戳(抑制原生 dblclick 重复触发) */
let manualDoubleTapAt = 0;

function onDblClick() {
  if (performance.now() - manualDoubleTapAt < 500) return;
  if (scale.value > LIGHTBOX_ZOOM.min) resetView();
  else zoomBy(1.5); // 1 → 2.5
}

let startX = 0;
let startY = 0;
let baseTx = 0;
let baseTy = 0;

let swipeStartX = 0;
let swipeStartY = 0;
let swipeStartT = 0;

/* 多指追踪 */
const pointers = new Map<number, { x: number; y: number }>();
let pinching = false;
let pinchBaseDist = 1;
let pinchBaseScale = 1;
let pinchBaseTx = 0;
let pinchBaseTy = 0;
let pinchMidX = 0;
let pinchMidY = 0;

/* 手动双击检测(iOS 不触发 dblclick) */
let lastTapT = 0;
let lastTapX = 0;
let lastTapY = 0;

function twoPointers(): Array<{ x: number; y: number }> {
  return [...pointers.values()].slice(0, 2);
}

function beginPinch() {
  const [a, b] = twoPointers();
  pinchBaseDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  pinchBaseScale = scale.value;
  pinchBaseTx = tx.value;
  pinchBaseTy = ty.value;
  pinchMidX = (a.x + b.x) / 2;
  pinchMidY = (a.y + b.y) / 2;
  pinching = true;
  panning.value = false;
  swiping.value = false;
  swipeDx.value = 0;
}

function onPointerDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    beginPinch();
    return;
  }
  if (pointers.size > 2) return;

  if (scale.value > LIGHTBOX_ZOOM.min) {
    panning.value = true;
    startX = e.clientX;
    startY = e.clientY;
    baseTx = tx.value;
    baseTy = ty.value;
  } else {
    swiping.value = true;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swipeStartT = performance.now();
  }
}

function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinching && pointers.size >= 2) {
    const [a, b] = twoPointers();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoomBy(pinchBaseScale * (dist / pinchBaseDist) - scale.value);
    tx.value = pinchBaseTx + ((a.x + b.x) / 2 - pinchMidX);
    ty.value = pinchBaseTy + ((a.y + b.y) / 2 - pinchMidY);
    return;
  }
  if (panning.value) {
    tx.value = baseTx + (e.clientX - startX);
    ty.value = baseTy + (e.clientY - startY);
    return;
  }
  if (swiping.value) {
    swipeDx.value = e.clientX - swipeStartX;
  }
}

function onPointerUp(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const el = e.currentTarget as HTMLElement | null;
  if (el && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);

  if (pinching) {
    if (pointers.size < 2) pinching = false;
    return;
  }

  if (panning.value) {
    if (pointers.size === 0) panning.value = false;
    return;
  }

  if (swiping.value) {
    swiping.value = false;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    const dur = performance.now() - swipeStartT;
    swipeDx.value = 0; // 弹回(transition 恢复后生效)

    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
    const dist = Math.hypot(dx, dy);
    const flick = Math.abs(dx) >= SWIPE_FLICK_DIST && dur <= SWIPE_FLICK_MS;
    if (horizontal && dist >= 10 && (Math.abs(dx) >= SWIPE_THRESHOLD || flick)) {
      if (dx < 0) next(); else prev();
      return;
    }
    // 点按(非滑动)→ 手动双击检测
    if (dist < 10 && dur < 250) {
      const now = performance.now();
      if (now - lastTapT < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 48) {
        lastTapT = 0;
        onDblClick();
        manualDoubleTapAt = now; // 抑制紧随的原生 dblclick(部分平台会合成)
      } else {
        lastTapT = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      }
    }
  }
}

const imgStyle = computed(() => ({
  opacity: imgLoaded.value ? 1 : 0,
  transform: `translateX(${swipeDx.value}px) translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transition: (panning.value || swiping.value)
    ? 'opacity 0.2s ease'
    : 'opacity 0.2s ease, transform 0.15s ease',
  cursor: scale.value > 1 ? (panning.value ? 'grabbing' : 'grab') : 'zoom-in',
}));

/* 当前图标签(只读展示) */
const currentTags = computed(() => {
  const url = current.value?.url;
  return url ? tagsOf(url) : [];
});

function lockScroll(lock: boolean) {
  document.body.style.overflow = lock ? 'hidden' : '';
}

watch(isOpen, (open) => {
  if (open) {
    // 同一张图关了再开:url 不变,上面的 watch 不会触发 → 在此复位两态
    imgLoaded.value = false;
    imgFailed.value = false;
  } else {
    resetView();
  }
  lockScroll(open);
}, { immediate: true });
onUnmounted(() => {
  if (zoomRaf != null) { cancelAnimationFrame(zoomRaf); zoomRaf = null; }
});

</script>

<template>
  <div
    v-if="isOpen"
    class="lightbox"
    role="dialog"
    aria-modal="true"
    aria-label="图片预览"
    @click.self="close"
  >
    <button class="lb-btn lb-close" aria-label="关闭预览" title="关闭 (Esc)" @click="close">×</button>
    <a
      class="lb-btn lb-download"
      :href="safeUrl || undefined"
      download
      target="_blank"
      rel="noopener"
      aria-label="下载原图"
      title="下载原始图片"
    >↓</a>
    <button
      class="lb-btn lb-fav"
      :class="{ faved: currentFaved }"
      type="button"
      :aria-label="currentFaved ? '取消收藏' : '收藏'"
      :aria-pressed="currentFaved ? 'true' : 'false'"
      :title="currentFaved ? '取消收藏' : '收藏'"
      @click="onFav"
    >
      <span class="lb-fav-star">{{ currentFaved ? '★' : '☆' }}</span>
    </button>
    <button
      v-if="likesReady"
      class="lb-btn lb-like"
      :class="{ liked: currentLiked }"
      type="button"
      :aria-label="currentLiked ? '取消点赞' : '点赞'"
      :title="currentLiked ? '取消点赞' : '点赞'"
      @click="onLike"
    >
      <span class="lb-like-heart">{{ currentLiked ? '♥' : '♡' }}</span>
      <span v-if="currentLikes > 0" class="lb-like-count">{{ formatInt(currentLikes) }}</span>
    </button>
    <button class="lb-btn lb-prev" aria-label="上一张" title="上一张 (←)" @click="prev">‹</button>

    <div
      class="lb-stage"
      @wheel.prevent="onWheel"
      @dblclick="onDblClick"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img
        v-show="!imgFailed"
        class="lb-img"
        :style="imgStyle"
        :src="current?.url"
        :alt="current?.name || `图片 ${(index ?? 0) + 1}`"
        draggable="false"
        @load="imgLoaded = true"
        @error="imgFailed = true"
      >
      <div v-if="imgFailed" class="lb-fail" role="alert">
        <p class="lb-fail-title">原图加载失败</p>
        <p class="lb-fail-desc">文件可能已被图床清除,或当前网络无法访问图床</p>
        <p v-if="current?.name" class="lb-fail-name">{{ current.name }}</p>
        <button type="button" class="lb-fail-next" @click="nextAfterFail">看下一张 ›</button>
      </div>
    </div>

    <button class="lb-btn lb-next" aria-label="下一张" title="下一张 (→)" @click="next">›</button>
    <p class="lb-caption">
      {{ (index ?? 0) + 1 }} / {{ items.length }}<template v-if="current?.name"> · {{ current.name }}</template>
    </p>
    <div v-if="currentTags.length" class="lb-tags">
      <span v-for="tag in currentTags" :key="tag" class="lb-tag">{{ tag }}</span>
    </div>
  </div>
</template>
