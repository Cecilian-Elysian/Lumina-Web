<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue';
import FocalEditor from './FocalEditor.vue';
import type { FocalPoint } from '@/shared/types';
import {
  useManagerState, loadFocalPoints, saveFocalPoints, loadImages,
  syncDeploy, runAi, toast,
} from './api';

const LS_FOCAL_KEY = 'lumina.focal.local';
const DATA_FILE = 'src/site/focalPoints.ts';

const state = useManagerState();

/* ── 数据 ── */
const staticFocal = ref<Record<string, FocalPoint>>({});
/** 本会话编辑(LS 持久化);键存在 = dirty */
const lsFocal = reactive<Record<string, FocalPoint>>({});
/** 本次会话中显式清除的 url(保存时要从静态里删掉) */
const focalRemoved = ref(new Set<string>());

function readLs(): Record<string, FocalPoint> {
  try { return JSON.parse(localStorage.getItem(LS_FOCAL_KEY) || '{}'); }
  catch { return {}; }
}

function persistLs() {
  localStorage.setItem(LS_FOCAL_KEY, JSON.stringify(lsFocal));
}

async function reloadFocal() {
  staticFocal.value = await loadFocalPoints();
  Object.keys(lsFocal).forEach((k) => delete lsFocal[k]);
  for (const [k, v] of Object.entries(readLs())) lsFocal[k] = v;
  focalRemoved.value = new Set();
}

function mergedPoint(url: string): FocalPoint | null {
  return lsFocal[url] ?? staticFocal.value[url] ?? null;
}

const dirtyCount = computed(() => Object.keys(lsFocal).length + focalRemoved.value.size);
const removedCount = computed(() => focalRemoved.value.size);

/* ── 读取图片列表 ── */
async function fetchImages() {
  const { list } = await loadImages();
  state.images.value = list;
  state.imagesLoaded.value = true;
  toast(`已加载 ${list.length} 张图片`, 'success');
}

/* ── 单图编辑器 ── */
const editing = ref<{ url: string; name: string } | null>(null);
const editingInitial = ref<FocalPoint | null>(null);

function openEditor(img: { url: string; name: string }) {
  editing.value = img;
  editingInitial.value = mergedPoint(img.url);
}

function applyPoint(p: FocalPoint) {
  if (!editing.value) return;
  lsFocal[editing.value.url] = p;
  focalRemoved.value.delete(editing.value.url);
  persistLs();
  editing.value = null;
  toast('已保存到当前会话', 'success');
}

function clearPoint() {
  if (!editing.value) return;
  const url = editing.value.url;
  delete lsFocal[url];
  focalRemoved.value.add(url);
  persistLs();
  editing.value = null;
  toast('已从本次会话中清除', 'success');
}

/* ── 保存到 viewer ── */
async function saveFocal() {
  if (dirtyCount.value === 0) {
    toast('没有改动需要保存');
    return;
  }
  const merged: Record<string, FocalPoint> = { ...staticFocal.value };
  for (const url of focalRemoved.value) delete merged[url];
  for (const [url, p] of Object.entries(lsFocal)) merged[url] = p;

  if (!confirm(`将覆盖 viewer 的 focalPoints.ts(共 ${Object.keys(merged).length} 项)。\n\n确定继续?`)) return;

  const count = await saveFocalPoints(merged);
  if (count == null) return;
  toast(`已写入 viewer 的 focalPoints.ts(${count} 项)`, 'success');
  await reloadFocal();
}

/* ── 同步并部署 ── */
const syncing = ref(false);

async function syncFocal() {
  if (dirtyCount.value > 0) {
    toast('请先完成保存,再执行同步', 'error');
    return;
  }
  if (!confirm('将提交 focalPoints.ts 并推送到 GitHub,触发 Cloudflare 部署。继续吗?')) return;
  syncing.value = true;
  const msg = await syncDeploy(DATA_FILE);
  syncing.value = false;
  if (msg) toast(msg, 'success');
}

/* ── 导出 JSON ── */
const exportOpen = ref(false);
const exportText = ref('');

function openExport() {
  const merged: Record<string, FocalPoint> = { ...staticFocal.value };
  for (const url of focalRemoved.value) delete merged[url];
  for (const [url, p] of Object.entries(lsFocal)) merged[url] = p;
  exportText.value = `export const FOCAL_POINTS = ${JSON.stringify(merged, null, 2)};\n`;
  exportOpen.value = true;
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    toast('已复制到剪贴板', 'success');
  } catch {
    toast('复制失败,请手动全选复制', 'error');
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: 'application/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'focalPoints.ts';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── AI 批量分析 ── */
const aiOpen = ref(false);
const aiLog = ref('');
const aiRunning = ref(false);
const aiProgress = ref<{ cur: number; total: number } | null>(null);

async function startAi() {
  if (!confirm('AI 批量分析将:\n1. 启动 Node 工具下载每张图(约 60 张)\n2. 用 @vladmandic/face-api 检测人脸\n3. 写回 viewer 的 focalPoints.ts\n\n首次运行需下载模型(~6MB),可能需要几分钟。\n\n确定继续?')) return;

  aiOpen.value = true;
  aiLog.value = '';
  aiRunning.value = true;
  aiProgress.value = null;

  await runAi('max', {
    onLog: (text) => { aiLog.value += text; },
    onProgress: (cur, total) => { aiProgress.value = { cur, total }; },
    onDone: async (ok, code) => {
      aiLog.value += '\n\n' + (ok ? '✓ 完成' : '✗ 失败 code=' + code);
      aiRunning.value = false;
      if (ok) {
        await reloadFocal();
        toast('AI 分析完成,已自动重载', 'success');
      }
    },
  });
}

/* ── Esc 关闭弹窗 ── */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (editing.value) return; // 编辑器自行处理
  if (aiRunning.value) return;
  exportOpen.value = false;
  aiOpen.value = false;
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  await reloadFocal();
  await fetchImages();
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <!-- 操作按钮(传送到顶栏) -->
  <Teleport to="#bar-right">
    <button class="btn" @click="fetchImages">↻ 读取图片列表</button>
    <button class="btn btn-primary" @click="startAi">🧠 AI 批量分析</button>
    <button class="btn" @click="saveFocal">💾 保存到 viewer</button>
    <button class="btn btn-primary" :disabled="syncing" @click="syncFocal">
      {{ syncing ? '同步中...' : '↥ 同步并部署' }}
    </button>
    <button class="btn btn-ghost" @click="openExport">📋 导出 JSON</button>
  </Teleport>

  <!-- 状态条 -->
  <section class="status">
    <div class="status-item">
      <span class="status-label">静态焦点</span>
      <span class="status-value">{{ Object.keys(staticFocal).length }} 项</span>
    </div>
    <div class="status-item">
      <span class="status-label">本次编辑</span>
      <span class="status-value">{{ Object.keys(lsFocal).length }} 项</span>
    </div>
    <div class="status-item">
      <span class="status-label">未保存</span>
      <span class="status-value">{{ dirtyCount }} 项(含清除 {{ removedCount }})</span>
    </div>
    <div v-if="aiRunning && aiProgress" class="status-progress">
      <div class="status-progress-bar">
        <div
          class="status-progress-fill"
          :style="{ width: (aiProgress.cur / aiProgress.total * 100) + '%' }"
        />
      </div>
      <span class="status-progress-label">{{ aiProgress.cur }} / {{ aiProgress.total }}</span>
    </div>
    <div v-else-if="aiRunning" class="status-progress">
      <div class="status-progress-bar"><div class="status-progress-fill" style="width: 0%" /></div>
      <span class="status-progress-label">启动中...</span>
    </div>
  </section>

  <!-- 焦点网格 -->
  <main class="grid tab-pane">
    <div v-if="!state.imagesLoaded.value" class="empty">点击右上"读取图片列表"开始</div>
    <div
      v-for="(img, i) in state.images.value"
      :key="img.url"
      class="tile"
      @click="openEditor(img)"
    >
      <span
        class="tile-badge"
        :class="mergedPoint(img.url) ? 'tile-badge-static' : 'tile-badge-empty'"
        :title="mergedPoint(img.url) ? '已设焦点' : '未设'"
      >{{ mergedPoint(img.url) ? '●' : '○' }}</span>
      <img
        :src="img.url"
        :alt="img.name"
        :style="(() => {
          const p = mergedPoint(img.url);
          return p ? { '--tile-x': (p.x*100).toFixed(1)+'%', '--tile-y': (p.y*100).toFixed(1)+'%' } : {};
        })()"
        loading="lazy"
      >
      <div class="tile-name">{{ img.name || ('#' + (i + 1)) }}</div>
    </div>
  </main>

  <!-- 单图编辑器 -->
  <FocalEditor
    v-if="editing"
    :url="editing.url"
    :name="editing.name"
    :initial="editingInitial"
    @apply="applyPoint"
    @clear="clearPoint"
    @close="editing = null"
  />

  <!-- 导出 JSON -->
  <div v-if="exportOpen" class="modal" role="dialog" aria-modal="true" aria-label="导出焦点配置">
    <div class="modal-mask" @click="exportOpen = false" />
    <div class="modal-body modal-body-small">
      <button class="modal-close" aria-label="关闭" @click="exportOpen = false">×</button>
      <h2 class="modal-title">导出焦点配置</h2>
      <textarea :value="exportText" class="export-text" readonly />
      <div class="ctrl-row ctrl-actions">
        <button class="btn" @click="copyExport">📋 复制到剪贴板</button>
        <button class="btn" @click="downloadExport">💾 下载 focalPoints.ts</button>
        <span class="ctrl-spacer" />
        <button class="btn" @click="exportOpen = false">关闭</button>
      </div>
    </div>
  </div>

  <!-- AI 日志 -->
  <div v-if="aiOpen" class="modal" role="dialog" aria-modal="true" aria-label="AI 分析日志">
    <div class="modal-mask" @click="!aiRunning && (aiOpen = false)" />
    <div class="modal-body modal-body-small">
      <button class="modal-close" aria-label="关闭" :disabled="aiRunning" @click="aiOpen = false">×</button>
      <h2 class="modal-title">🧠 AI 焦点批量分析日志</h2>
      <pre class="ai-log">{{ aiLog }}</pre>
      <div class="ctrl-row ctrl-actions">
        <span class="ctrl-spacer" />
        <button class="btn" @click="aiOpen = false">关闭</button>
      </div>
    </div>
  </div>
</template>
