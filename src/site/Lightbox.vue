<script setup lang="ts">
import { ref, watch } from 'vue';
import { useLightbox } from './composables';

const { isOpen, current, index, items, close, next, prev } = useLightbox();

/* 大图换图淡入:src 变化时先透明,load 后显示 */
const imgLoaded = ref(false);
watch(() => current.value?.url, () => { imgLoaded.value = false; });

function lockScroll(lock: boolean) {
  document.body.style.overflow = lock ? 'hidden' : '';
}

watch(isOpen, (open) => lockScroll(open), { immediate: true });
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
    <button class="lb-btn lb-prev" aria-label="上一张" title="上一张 (←)" @click="prev">‹</button>
    <img
      class="lb-img"
      :style="{ opacity: imgLoaded ? 1 : 0, transition: 'opacity 0.2s ease' }"
      :src="current?.url"
      :alt="current?.name || `图片 ${(index ?? 0) + 1}`"
      @load="imgLoaded = true"
      @error="imgLoaded = true"
    >
    <button class="lb-btn lb-next" aria-label="下一张" title="下一张 (→)" @click="next">›</button>
    <p class="lb-caption">
      {{ (index ?? 0) + 1 }} / {{ items.length }}<template v-if="current?.name"> · {{ current.name }}</template>
    </p>
  </div>
</template>
