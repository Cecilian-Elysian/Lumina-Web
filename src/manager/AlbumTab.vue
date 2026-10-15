<script setup lang="ts">
import { ref, reactive, computed, watchEffect, onMounted } from 'vue';
import AlbumChip from './AlbumChip.vue';
import AlbumModal from './AlbumModal.vue';
import type { AlbumMeta, AlbumsDoc } from '@/shared/types';
import { fileName } from '@/shared/utils';
import {
  useManagerState, loadAlbums, saveAlbums, addAlbum,
  renameAlbum, deleteAlbum, loadImages, toast,
} from './api';
import { registerSaver, setDirty } from './queue';
import { confirmAsync } from './confirm';

const LS_ALBUM_KEY = 'lumina.album.local';

const state = useManagerState();

/* ── 数据 ── */
const staticAlbums = ref<AlbumsDoc>({ _meta: [] });
/** 本会话编辑 url→albumId(null=解除归属),LS 持久化 */
const lsAlbums = reactive<Record<string, string | null>>({});
const albumSearch = ref('');
const draggingUrl = ref<string | null>(null);
/** 本次点击前是否发生过拖拽(用于区分"拖完"和"真点击") */
let didDrag = false;

function readLs(): Record<string, string | null> {
  try { return JSON.parse(localStorage.getItem(LS_ALBUM_KEY) || '{}'); }
  catch { return {}; }
}

function persistLs() {
  localStorage.setItem(LS_ALBUM_KEY, JSON.stringify(lsAlbums));
}

async function reloadAlbums() {
  const doc = await loadAlbums();
  if (doc) staticAlbums.value = doc;
  Object.keys(lsAlbums).forEach((k) => delete lsAlbums[k]);
  for (const [k, v] of Object.entries(readLs())) lsAlbums[k] = v;
}

const albumMeta = computed<AlbumMeta[]>(() =>
  Array.isArray(staticAlbums.value._meta) ? staticAlbums.value._meta : [],
);

function staticIdOf(url: string): string | null {
  const v = staticAlbums.value[url];
  return typeof v === 'string' ? v : null;
}

/** LS > STATIC > null */
function mergedAlbumId(url: string): string | null {
  if (url in lsAlbums) return lsAlbums[url];
  return staticIdOf(url);
}

/** 每个图集的图片计数(合并后) */
const albumCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const a of albumMeta.value) counts[a.id] = 0;
  for (const img of state.images.value) {
    const id = mergedAlbumId(img.url);
    if (id && counts[id] != null) counts[id]++;
  }
  return counts;
});

const metaById = computed<Record<string, AlbumMeta>>(() => {
  const m: Record<string, AlbumMeta> = {};
  for (const a of albumMeta.value) m[a.id] = a;
  return m;
});

/* ── 拖拽归属 ── */
function assign(url: string, albumId: string | null) {
  lsAlbums[url] = albumId;
  // 与静态一致时不留 LS 项,避免无谓 dirty
  if (lsAlbums[url] === staticIdOf(url)) delete lsAlbums[url];
  persistLs();
}

const dirtyCount = computed(() => Object.keys(lsAlbums).length);

/* ── 搜索过滤 ── */
const filteredImages = computed(() => {
  const q = albumSearch.value.trim().toLowerCase();
  const list = state.images.value;
  if (!q) return list;
  return list.filter((img) => {
    const id = mergedAlbumId(img.url);
    const meta = id ? metaById.value[id] : null;
    return img.url.toLowerCase().includes(q)
      || (meta ? meta.name.toLowerCase().includes(q) : false);
  });
});

/* ── 读取图片列表 ── */
async function fetchImages() {
  const { list } = await loadImages();
  state.images.value = list;
  state.imagesLoaded.value = true;
  toast(`已加载 ${list.length} 张图片`, 'success');
}

/* ── 图集 CRUD ── */
const modalOpen = ref(false);
const modalMode = ref<'add' | 'rename'>('add');
const modalTargetId = ref<string | null>(null);
const modalInitialName = ref('');

function openAdd() {
  modalMode.value = 'add';
  modalTargetId.value = null;
  modalInitialName.value = '';
  modalOpen.value = true;
}

function openRename(id: string) {
  modalMode.value = 'rename';
  modalTargetId.value = id;
  modalInitialName.value = metaById.value[id]?.name ?? '';
  modalOpen.value = true;
}

async function onModalSave(name: string) {
  modalOpen.value = false;
  if (modalMode.value === 'add') {
    const r = await addAlbum(name);
    if (r != null) {
      toast(`已创建图集「${r}」`, 'success');
      await reloadAlbums();
    }
  } else if (modalTargetId.value) {
    const r = await renameAlbum(modalTargetId.value, name);
    if (r != null) {
      toast(`已重命名为「${r}」`, 'success');
      await reloadAlbums();
    }
  }
}

async function onDeleteAlbum(id: string) {
  const meta = metaById.value[id];
  if (!meta) return;
  let count = 0;
  for (const img of state.images.value) {
    if (mergedAlbumId(img.url) === id) count++;
  }
  const ok = await confirmAsync({
    title: `删除图集「${meta.name}」`,
    message: `该图集下的 ${count} 张图片将自动降级为「未分组」(图片本身不会被删除)。`,
    danger: true,
    confirmText: '删除',
  });
  if (!ok) return;
  const removed = await deleteAlbum(id);
  if (removed != null) {
    toast(`已删除图集「${meta.name}」(${removed} 张降级)`, 'success');
    await reloadAlbums();
  }
}

/* ── 保存到 viewer(操作队列批量调用,无确认) ── */
async function saveAlbumsCore(): Promise<boolean> {
  if (dirtyCount.value === 0) return true;
  const merged: AlbumsDoc = { ...staticAlbums.value };
  for (const [url, aid] of Object.entries(lsAlbums)) {
    if (aid == null) delete merged[url];
    else merged[url] = aid;
  }
  const r = await saveAlbums(merged);
  if (!r) return false;
  toast(`已写入 albums.ts (图集 ${r.metaCount} 个, 图片 ${r.imageCount} 张)`, 'success');
  await reloadAlbums();
  return true;
}

registerSaver('album', saveAlbumsCore);
watchEffect(() => setDirty('album', dirtyCount.value > 0));

onMounted(async () => {
  await reloadAlbums();
  await fetchImages();
});

function onDragStart(e: DragEvent, url: string) {
  didDrag = true;
  draggingUrl.value = url;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/url', url);
    e.dataTransfer.setData('text/plain', url);
  }
}

function onDragEnd() {
  draggingUrl.value = null;
}

/** 拖拽结束后浏览器仍会派发 click;dragstart 只在真正拖动时触发,用它挡掉误触 */
function onTileClick(url: string) {
  if (didDrag) { didDrag = false; return; }
  openInNewTab(url);
}

function openInNewTab(url: string) {
  window.open(url, '_blank');
}
</script>

<template>
  <!-- 操作按钮(传送到顶栏;保存/部署统一走侧栏操作队列) -->
  <Teleport to="#bar-right">
    <button class="btn" @click="fetchImages">↻ 读取图片列表</button>
  </Teleport>

  <!-- 状态条 -->
  <section class="status">
    <div class="status-item">
      <span class="status-label">图集</span>
      <span class="status-value">{{ albumMeta.length }} 个</span>
    </div>
    <div class="status-item">
      <span class="status-label">本次编辑</span>
      <span class="status-value">{{ dirtyCount }} 张</span>
    </div>
    <div class="status-item">
      <span class="status-label">未保存</span>
      <span class="status-value">{{ dirtyCount }} 张</span>
    </div>
  </section>

  <main class="album-pane tab-pane">
    <!-- 图集 chips 面板 -->
    <div class="album-panel">
      <div class="album-panel-header">图集(拖入图片即可归类)</div>
      <div class="album-chips" :class="{ 'is-drop-target': draggingUrl !== null }">
        <div class="album-chip album-chip-add" @click="openAdd">＋ 新建图集</div>
        <div
          class="album-chip album-chip-trash"
          title="拖到此处 = 未分组"
          @click="toast('把图片拖到这里解除归属')"
          @dragover.prevent
          @drop.prevent="draggingUrl && assign(draggingUrl, null); draggingUrl = null"
        >🚮 未分组</div>
        <AlbumChip
          v-for="a in albumMeta"
          :key="a.id"
          :album="a"
          :count="albumCounts[a.id] ?? 0"
          @rename="openRename"
          @delete="onDeleteAlbum"
          @assign="(url: string, id: string) => { assign(url, id); draggingUrl = null; }"
        />
      </div>
    </div>

    <!-- 空提示 -->
    <div v-if="albumMeta.length === 0" class="album-empty-hint">
      还没有图集。<span class="album-hint-link" @click="openAdd">点此创建第一个图集</span>
    </div>

    <!-- 工具栏 -->
    <div class="album-toolbar">
      <input v-model="albumSearch" type="search" class="album-search" placeholder="按 URL 或图集名筛选…">
      <span class="album-count">
        {{ state.imagesLoaded.value ? `${filteredImages.length} / ${state.images.value.length} 张` : '—' }}
      </span>
    </div>

    <!-- 图片网格 -->
    <div class="album-grid">
      <div v-if="!state.imagesLoaded.value" class="empty">点击右上"读取图片列表"开始</div>
      <div
        v-for="img in filteredImages"
        :key="img.url"
        class="album-tile"
        :class="{ 'is-dirty': mergedAlbumId(img.url) != null && img.url in lsAlbums, 'is-dragging': draggingUrl === img.url }"
        draggable="true"
        :data-url="img.url"
        title="点击看大图,拖动可归类"
        @click="onTileClick(img.url)"
        @dragstart="onDragStart($event, img.url)"
        @dragend="onDragEnd"
      >
        <button
          v-if="mergedAlbumId(img.url)"
          class="album-tile-remove"
          title="解除归属"
          @click.stop="assign(img.url, null)"
        >✕</button>
        <div class="album-frame">
          <img
            :src="img.thumb || img.url"
            alt=""
            loading="lazy"
            decoding="async"
          >
        </div>
        <div class="album-tile-body">
          <div class="album-tile-name" :title="img.url">{{ fileName(img.url) }}</div>
          <div
            class="album-tile-tag"
            :class="{ 'is-none': !mergedAlbumId(img.url) }"
          >{{ mergedAlbumId(img.url) ? '📁' : '·' }} {{ mergedAlbumId(img.url) ? metaById[mergedAlbumId(img.url)!]?.name : '未分组' }}</div>
        </div>
      </div>
      <div v-if="state.imagesLoaded.value && filteredImages.length === 0" class="empty">无匹配项</div>
    </div>
  </main>

  <!-- 新建/重命名图集 -->
  <AlbumModal
    v-if="modalOpen"
    :mode="modalMode"
    :initial-name="modalInitialName"
    @save="onModalSave"
    @close="modalOpen = false"
  />
</template>
