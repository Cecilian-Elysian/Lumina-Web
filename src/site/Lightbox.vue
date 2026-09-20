<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useLightbox, useTags, LIGHTBOX_ZOOM } from './composables';

const {
  isOpen, current, index, items, close, next, prev,
  scale, tx, ty, zoomBy, resetView,
} = useLightbox();
const { tagsOf } = useTags();

/* 大图换图淡入:src 变化时先透明,load 后显示 */
const imgLoaded = ref(false);
watch(() => current.value?.url, () => { imgLoaded.value = false; });

/* ---- 滚轮缩放 / 双击缩放 / 拖拽平移(scale > 1 时) ---- */
const panning = ref(false);

function onWheel(e: WheelEvent) {
  zoomBy(e.deltaY < 0 ? LIGHTBOX_ZOOM.step : -LIGHTBOX_ZOOM.step);
}

function onDblClick() {
  if (scale.value > LIGHTBOX_ZOOM.min) resetView();
  else zoomBy(1.5); // 1 → 2.5
}

let startX = 0;
let startY = 0;
let baseTx = 0;
let baseTy = 0;

function onPointerDown(e: PointerEvent) {
  if (scale.value <= LIGHTBOX_ZOOM.min) return;
  panning.value = true;
  startX = e.clientX;
  startY = e.clientY;
  baseTx = tx.value;
  baseTy = ty.value;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!panning.value) return;
  tx.value = baseTx + (e.clientX - startX);
  ty.value = baseTy + (e.clientY - startY);
}

function onPointerUp(e: PointerEvent) {
  if (!panning.value) return;
  panning.value = false;
  const el = e.currentTarget as HTMLElement | null;
  if (el && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
}

const imgStyle = computed(() => ({
  opacity: imgLoaded.value ? 1 : 0,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
  transition: panning.value
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
  if (!open) resetView();
  lockScroll(open);
}, { immediate: true });
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
      :href="current?.url"
      download
      target="_blank"
      rel="noopener"
      aria-label="下载原图"
      title="下载原图"
    >↓</a>
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
        class="lb-img"
        :style="imgStyle"
        :src="current?.url"
        :alt="current?.name || `图片 ${(index ?? 0) + 1}`"
        draggable="false"
        @load="imgLoaded = true"
        @error="imgLoaded = true"
      >
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
