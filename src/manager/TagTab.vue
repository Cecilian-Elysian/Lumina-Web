<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import type { TagsDoc } from '@/shared/types';
import { fileName } from '@/shared/utils';
import {
  useManagerState, loadTags, saveTags, loadImages, syncDeploy, toast,
} from './api';

/* ============================================================
 * 标签 Tab — 给每张图打标签,写入 src/site/tags.ts
 *   - 编辑进 localStorage(lumina.tags.local),null = 清空该图
 *   - 与静态 tags.ts 合并预览;保存时合并覆盖写回
 *   - 键 = Image.url(原图直链),与焦点/图集一致
 * ============================================================ */

const LS_TAGS_KEY = 'lumina.tags.local';
const DATA_FILE = 'src/site/tags.ts';

const state = useManagerState();

/* ── 数据 ── */
const staticTags = ref<TagsDoc>({});
/** 本会话编辑 url→tags(null=清空),LS 持久化 */
const lsTags = reactive<Record<string, string[] | null>>({});
const tagSearch = ref('');
/** 每个图块的新标签草稿 */
const drafts = reactive<Record<string, string>>({});

function readLs(): Record<string, string[] | null> {
  try { return JSON.parse(localStorage.getItem(LS_TAGS_KEY) || '{}'); }
  catch { return {}; }
}

function persistLs() {
  localStorage.setItem(LS_TAGS_KEY, JSON.stringify(lsTags));
}

async function reloadTags() {
  const doc = await loadTags();
  if (doc) staticTags.value = doc;
  Object.keys(lsTags).forEach((k) => delete lsTags[k]);
  for (const [k, v] of Object.entries(readLs())) lsTags[k] = v;
}

function staticTagsOf(url: string): string[] {
  const v = staticTags.value[url];
  return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
}

/** LS > STATIC > [] */
function mergedTags(url: string): string[] {
  if (url in lsTags) {
    const v = lsTags[url];
    return Array.isArray(v) ? v : [];
  }
  return staticTagsOf(url);
}

/** 与静态一致时不留 LS 项,避免无谓 dirty */
function setLs(url: string, tags: string[] | null) {
  const same = tags === null
    ? staticTagsOf(url).length === 0
    : JSON.stringify(tags) === JSON.stringify(staticTagsOf(url));
  if (same) delete lsTags[url];
  else lsTags[url] = tags;
  persistLs();
}

function addTag(url: string, raw: string) {
  const parts = raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return;
  const cur = mergedTags(url);
  const next = [...cur];
  let added = 0;
  for (const p of parts) {
    if (p.length > 32) { toast(`标签过长(>32): ${p}`, 'error'); return; }
    if (!next.includes(p)) { next.push(p); added++; }
  }
  if (added === 0) { toast('标签已存在', 'warn'); return; }
  setLs(url, next);
  delete drafts[url];
}

function removeTag(url: string, tag: string) {
  setLs(url, mergedTags(url).filter((t) => t !== tag));
}

function clearTags(url: string) {
  if (mergedTags(url).length === 0) return;
  setLs(url, null);
}

const dirtyCount = computed(() => Object.keys(lsTags).length);
const taggedCount = computed(() =>
  state.images.value.filter((img) => mergedTags(img.url).length > 0).length);

/** 全部已知标签(datalist 候选) */
const knownTags = computed(() => {
  const set = new Set<string>();
  for (const v of Object.values(staticTags.value)) {
    if (Array.isArray(v)) v.forEach((t) => set.add(t));
  }
  for (const v of Object.values(lsTags)) {
    if (Array.isArray(v)) v.forEach((t) => set.add(t));
  }
  return [...set].sort();
});

/* ── 搜索过滤 ── */
const filteredImages = computed(() => {
  const q = tagSearch.value.trim().toLowerCase();
  const list = state.images.value;
  if (!q) return list;
  return list.filter((img) =>
    img.url.toLowerCase().includes(q) ||
    mergedTags(img.url).some((t) => t.toLowerCase().includes(q)));
});

/* ── 读取图片列表 ── */
async function fetchImages() {
  const { list } = await loadImages();
  state.images.value = list;
  state.imagesLoaded.value = true;
  toast(`已加载 ${list.length} 张图片`, 'success');
}

/* ── 保存到 viewer ── */
async function saveTagsToViewer() {
  if (dirtyCount.value === 0) {
    toast('没有改动需要保存');
    return;
  }
  const merged: TagsDoc = { ...staticTags.value };
  for (const [url, tags] of Object.entries(lsTags)) {
    if (tags == null || tags.length === 0) delete merged[url];
    else merged[url] = tags;
  }
  const tagTotal = Object.values(merged).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  if (!confirm(`将覆盖 viewer 的 tags.ts:\n  • ${dirtyCount.value} 张图变动\n  • 共 ${Object.keys(merged).length} 张图 / ${tagTotal} 个标签\n\n确定继续?`)) return;

  const r = await saveTags(merged);
  if (r == null) return;
  toast(`已写入 tags.ts (${r} 张图带标签)`, 'success');
  await reloadTags();
}

/* ── 同步并部署 ── */
const syncing = ref(false);

async function syncTags() {
  if (dirtyCount.value > 0) {
    toast('请先完成保存,再执行同步', 'error');
    return;
  }
  if (!confirm('将提交 tags.ts 并推送到 GitHub,触发 Cloudflare 部署。继续吗?')) return;
  syncing.value = true;
  const msg = await syncDeploy(DATA_FILE);
  syncing.value = false;
  if (msg) toast(msg, 'success');
}

onMounted(async () => {
  await reloadTags();
  await fetchImages();
});

function openInNewTab(url: string) {
  window.open(url, '_blank');
}
</script>

<template>
  <!-- 操作按钮(传送到顶栏) -->
  <Teleport to="#bar-right">
    <button class="btn" @click="fetchImages">↻ 读取图片列表</button>
    <button class="btn" @click="saveTagsToViewer">💾 保存到 viewer</button>
    <button class="btn btn-primary" :disabled="syncing" @click="syncTags">
      {{ syncing ? '同步中...' : '↥ 同步并部署' }}
    </button>
  </Teleport>

  <!-- 状态条 -->
  <section class="status">
    <div class="status-item">
      <span class="status-label">带标签</span>
      <span class="status-value">{{ taggedCount }} 张</span>
    </div>
    <div class="status-item">
      <span class="status-label">本次编辑</span>
      <span class="status-value">{{ dirtyCount }} 张</span>
    </div>
    <div class="status-item">
      <span class="status-label">候选标签</span>
      <span class="status-value">{{ knownTags.length }} 个</span>
    </div>
  </section>

  <main class="album-pane tab-pane">
    <!-- 工具栏 -->
    <div class="album-toolbar">
      <input v-model="tagSearch" type="search" class="album-search" placeholder="按 URL 或标签筛选…">
      <span class="album-count">
        {{ state.imagesLoaded.value ? `${filteredImages.length} / ${state.images.value.length} 张` : '—' }}
      </span>
    </div>

    <!-- 候选标签 datalist -->
    <datalist id="known-tag-list">
      <option v-for="t in knownTags" :key="t" :value="t" />
    </datalist>

    <!-- 图片网格 -->
    <div class="album-grid">
      <div v-if="!state.imagesLoaded.value" class="empty">点击右上"读取图片列表"开始</div>
      <div
        v-for="img in filteredImages"
        :key="img.url"
        class="album-tile tag-tile"
        :class="{ 'is-dirty': img.url in lsTags }"
      >
        <button
          v-if="mergedTags(img.url).length"
          class="album-tile-remove"
          title="清空该图全部标签"
          @click.stop="clearTags(img.url)"
        >✕</button>
        <img
          :src="img.url"
          alt=""
          loading="lazy"
          @click="openInNewTab(img.url)"
        >
        <div class="album-tile-body">
          <div class="album-tile-name" :title="img.url">{{ fileName(img.url) }}</div>
          <div class="tag-chips">
            <span v-for="t in mergedTags(img.url)" :key="t" class="tag-chip">
              {{ t }}
              <button class="tag-chip-x" :title="`移除「${t}」`" @click.stop="removeTag(img.url, t)">✕</button>
            </span>
            <span v-if="mergedTags(img.url).length === 0" class="tag-none">未打标签</span>
          </div>
          <input
            v-model="drafts[img.url]"
            type="text"
            class="tag-input"
            list="known-tag-list"
            placeholder="+ 标签 (回车添加,逗号批量)"
            @keydown.enter.prevent="addTag(img.url, drafts[img.url] || '')"
          >
        </div>
      </div>
      <div v-if="state.imagesLoaded.value && filteredImages.length === 0" class="empty">无匹配项</div>
    </div>
  </main>
</template>
