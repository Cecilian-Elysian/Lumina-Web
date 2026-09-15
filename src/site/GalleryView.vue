<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { loadImages } from '@/shared/apiClient';
import type { Image } from '@/shared/types';
import { useAlbums, useFocal, useLightbox, useErrorBanner } from './composables';

const images = ref<Image[]>([]);
const query = ref('');
const loading = ref(true);
/** 封面已加载完成的图集(淡入用,键 = cover url) */
const loadedCovers = ref(new Set<string>());

const albums = useAlbums(() => images.value);
const { focalStyle } = useFocal();
const lb = useLightbox();
const banner = useErrorBanner();

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return albums.value;
  return albums.value.filter((a) => a.name.toLowerCase().includes(q));
});

const resultText = computed(() => {
  const q = query.value.trim();
  if (!q) return albums.value.length > 0 ? `共 ${albums.value.length} 个图集` : '';
  return `匹配 ${filtered.value.length} / ${albums.value.length}`;
});

function openAlbum(index: number) {
  const album = filtered.value[index];
  if (!album) return;
  const list = album.images.map((url) => ({ url, name: album.name }));
  lb.open(list, 0);
}

function onCoverLoad(cover: string) {
  if (!loadedCovers.value.has(cover)) {
    const next = new Set(loadedCovers.value);
    next.add(cover);
    loadedCovers.value = next;
  }
}

function onCardKeydown(e: KeyboardEvent, index: number) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  openAlbum(index);
}

onMounted(async () => {
  const { images: list, error } = await loadImages();
  if (error) {
    const isTokenMissing = /QUBU_TOKEN|未配置环境变量/.test(error);
    banner.showBanner(
      isTokenMissing
        ? 'CF Pages 未配置 QUBU_TOKEN(Settings → Environment variables),已展示兜底演示图'
        : '图床暂时不可达,已展示兜底演示图 (' + error + ')',
    );
  }
  images.value = list;
  loading.value = false;
});
</script>

<template>
  <section class="gallery-hero">
    <div class="hero-text">
      <h1 class="hero-title">光影画廊</h1>
      <p class="hero-subtitle">定格时间，封存每一次心跳</p>
    </div>
    <div class="hero-search-wrap">
      <label class="hero-search" aria-label="搜索图集">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <input v-model="query" type="text" class="search-input" placeholder="搜索图集名…" autocomplete="off">
      </label>
      <span class="result-count">{{ resultText }}</span>
    </div>
  </section>

  <main class="gallery-main" aria-label="相册列表">
    <div class="gallery-grid">
      <article
        v-for="(album, i) in filtered"
        :key="album.id || 'unassigned'"
        class="gallery-card"
        :class="{ 'is-uncategorized': album.unassigned }"
        tabindex="0"
        @click="openAlbum(i)"
        @keydown="onCardKeydown($event, i)"
      >
        <img
          :src="album.cover"
          :alt="album.name"
          :style="focalStyle(album.cover)"
          :class="{ 'is-loaded': loadedCovers.has(album.cover) }"
          loading="lazy"
          decoding="async"
          @load="onCoverLoad(album.cover)"
          @error="onCoverLoad(album.cover)"
        >
        <div class="gallery-card-meta">
          <span class="gallery-card-title">{{ album.name }}</span>
          <span class="gallery-card-count">{{ album.count }}</span>
        </div>
      </article>
    </div>

    <p v-if="!loading && filtered.length === 0" class="gallery-empty">
      {{ query ? '无匹配图集' : '暂无相册' }}
    </p>
  </main>
</template>
