<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { loadImages } from '@/shared/apiClient';
import { shuffle } from '@/shared/utils';
import type { Image } from '@/shared/types';
import { useSettings } from './settings';
import { useFocal, useLightbox } from './composables';

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

/* 行数变更 → 从已拉取数据重建分桶(不重新请求) */
watch(() => settings.value.rows, (n) => {
  if (gallery.value.length > 0) rows.value = buildRows(gallery.value, n);
});

onMounted(async () => {
  const { images } = await loadImages();

  const shuffled = shuffle(images.slice());
  gallery.value = shuffled;
  total.value = shuffled.length;

  rows.value = buildRows(shuffled, settings.value.rows);

  if (total.value > 0) {
    // 30 秒兜底:个别图片卡死也强制启动(失败图显示深灰底)
    safetyTimer = setTimeout(forceReady, 30000);
  } else {
    allLoaded.value = true;
  }
});

onUnmounted(() => {
  if (safetyTimer) clearTimeout(safetyTimer);
});
</script>

<template>
  <main class="wall" :class="{ ready: allLoaded }" aria-label="流动图片墙">
    <div v-if="total === 0" class="wall-loading">加载中…</div>

    <div v-for="(row, r) in displayRows" :key="r" class="row">
      <div class="row-track" :style="trackStyle(r)">
        <figure
          v-for="(item, j) in row"
          :key="`${r}-${item.gi}-${j < row.length / 2 ? 'a' : 'b'}`"
          class="card"
          :data-index="item.gi"
          @click="openLightbox(item.gi)"
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
  </main>
</template>
