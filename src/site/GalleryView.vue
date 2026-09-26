<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { loadImages } from '@/shared/apiClient';
import type { Image } from '@/shared/types';
import { useAlbums, useTags, useFocal, useLightbox } from './composables';
import { useLikes } from './likes';
import { formatInt } from '@/shared/utils';

/* ============================================================
 * 图集页 — 双视图(图集网格 / 全部图片瀑布流)
 *   - 搜索域:图集名 + 图集内图片标签 + 图片所属图集名
 *   - 图集卡片下展示 top-6 标签 chips(点击 = 填入搜索)
 *   - all 模式瀑布流用 thumb(600w)原图留给灯箱
 *   - 瀑布流卡片点赞角标(服务端计数就绪才渲染;点击不进灯箱)
 * ============================================================ */

const images = ref<Image[]>([]);
const query = ref('');
const mode = ref<'albums' | 'all'>('albums');
const loading = ref(true);
/** 封面已加载完成的图集(淡入用,键 = cover/thumb url) */
const loadedCovers = ref(new Set<string>());

const albums = useAlbums(() => images.value);
const { tagsOf, albumTags } = useTags();
const { focalStyle } = useFocal();
const lb = useLightbox();
const { ready: likesReady, likeCount, isLiked, toggleLike } = useLikes();

/** 角标显示条件:已赞 或 计数 > 0(0 赞未赞不占位) */
function showLike(url: string): boolean {
  return likesReady.value && (likeCount(url) > 0 || isLiked(url));
}

/** albums 模式过滤:图集名或图集内任一标签命中 */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return albums.value;
  return albums.value.filter((a) =>
    a.name.toLowerCase().includes(q) ||
    albumTags(a.images).some((t) => t.toLowerCase().includes(q)));
});

/** 命中图集名 → 该图集全部图片视为命中(all 模式用) */
const matchedAlbumUrls = computed(() => {
  const q = query.value.trim().toLowerCase();
  const set = new Set<string>();
  if (!q) return set;
  for (const a of albums.value) {
    if (a.name.toLowerCase().includes(q)) a.images.forEach((u) => set.add(u));
  }
  return set;
});

/** all 模式过滤:标签命中 或 所属图集名命中 */
const filteredImages = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return images.value;
  return images.value.filter((img) =>
    matchedAlbumUrls.value.has(img.url) ||
    tagsOf(img.url).some((t) => t.toLowerCase().includes(q)));
});

/** 卡片展示的 top-N 标签(按频次) */
function cardTags(albumImages: string[]): string[] {
  return albumTags(albumImages).slice(0, 6);
}

const resultText = computed(() => {
  const q = query.value.trim();
  if (mode.value === 'all') {
    if (!q) return images.value.length > 0 ? `共 ${images.value.length} 张` : '';
    return `匹配 ${filteredImages.value.length} / ${images.value.length} 张`;
  }
  if (!q) return albums.value.length > 0 ? `共 ${albums.value.length} 个图集` : '';
  return `匹配 ${filtered.value.length} / ${albums.value.length}`;
});

function openAlbum(index: number) {
  const album = filtered.value[index];
  if (!album) return;
  const list = album.images.map((url) => ({ url, name: album.name }));
  lb.open(list, 0);
}

function openMasonry(index: number) {
  const list = filteredImages.value.map((img) => ({ url: img.url, name: img.name }));
  lb.open(list, index);
}

function onTagClick(tag: string) {
  query.value = tag;
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

function onMasonryKeydown(e: KeyboardEvent, index: number) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  openMasonry(index);
}

onMounted(async () => {
  const { images: list } = await loadImages();
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
      <label class="hero-search" aria-label="搜索图集与标签">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <input v-model="query" type="text" class="search-input" placeholder="搜索图集名或标签…" autocomplete="off">
      </label>
      <div class="hero-toolbar">
        <span class="result-count">{{ resultText }}</span>
        <div class="view-switch" role="group" aria-label="浏览方式">
          <button
            type="button"
            :class="{ active: mode === 'albums' }"
            :aria-pressed="mode === 'albums' ? 'true' : 'false'"
            @click="mode = 'albums'"
          >图集</button>
          <button
            type="button"
            :class="{ active: mode === 'all' }"
            :aria-pressed="mode === 'all' ? 'true' : 'false'"
            @click="mode = 'all'"
          >全部</button>
        </div>
      </div>
    </div>
  </section>

  <!-- 图集网格 -->
  <main v-if="mode === 'albums'" class="gallery-main" aria-label="相册列表">
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
        <div v-if="cardTags(album.images).length" class="gallery-card-tags">
          <button
            v-for="tag in cardTags(album.images)"
            :key="tag"
            type="button"
            class="tag-chip"
            :title="`搜索标签「${tag}」`"
            @click.stop="onTagClick(tag)"
          >{{ tag }}</button>
        </div>
      </article>
    </div>

    <p v-if="!loading && filtered.length === 0" class="gallery-empty">
      {{ query ? '无匹配图集' : '暂无相册' }}
    </p>
  </main>

  <!-- 全部图片瀑布流 -->
  <main v-else class="gallery-main" aria-label="全部图片">
    <div class="masonry">
      <figure
        v-for="(img, i) in filteredImages"
        :key="img.url"
        class="masonry-item"
        tabindex="0"
        @click="openMasonry(i)"
        @keydown="onMasonryKeydown($event, i)"
      >
        <img
          :src="img.thumb"
          :alt="img.name || '图片'"
          :class="{ 'is-loaded': loadedCovers.has(img.thumb) }"
          loading="lazy"
          decoding="async"
          @load="onCoverLoad(img.thumb)"
          @error="onCoverLoad(img.thumb)"
        >
        <button
          v-if="showLike(img.url)"
          class="masonry-like"
          :class="{ liked: isLiked(img.url) }"
          type="button"
          :aria-label="isLiked(img.url) ? '取消点赞' : '点赞'"
          :aria-pressed="isLiked(img.url) ? 'true' : 'false'"
          @click.stop="toggleLike(img.url)"
          @keydown.stop
        >
          <span class="masonry-like-heart">{{ isLiked(img.url) ? '♥' : '♡' }}</span>
          <span v-if="likeCount(img.url) > 0" class="masonry-like-count">{{ formatInt(likeCount(img.url)) }}</span>
        </button>
      </figure>
    </div>

    <p v-if="!loading && filteredImages.length === 0" class="gallery-empty">
      {{ query ? '无匹配图片' : '暂无图片' }}
    </p>
  </main>
</template>
