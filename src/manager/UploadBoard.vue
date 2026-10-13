<script setup lang="ts">
/* ============================================================
 * 上传图片工作台 — 可拖拽悬浮面板(借鉴 Hub FloatingImageTool)
 *   拖拽/点选多文件 → POST /api/upload-image(服务端代理图床)
 *   → 展示外链 + 一键复制。上传的图随后会出现在图床列表中,
 *   点「读取图片列表」即可在焦点/图集/标签中看到。
 * ============================================================ */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { toast } from './api';

const emit = defineEmits<{ (e: 'close'): void }>();

/* ── 面板拖拽移动 ── */
const pos = ref({ x: Math.max(16, window.innerWidth - 396), y: 88 });
let dragging = false;
const dragOff = { x: 0, y: 0 };

function onHeadDown(e: MouseEvent) {
  dragging = true;
  dragOff.x = e.clientX - pos.value.x;
  dragOff.y = e.clientY - pos.value.y;
}
function onMove(e: MouseEvent) {
  if (!dragging) return;
  pos.value = {
    x: Math.max(8, Math.min(window.innerWidth - 120, e.clientX - dragOff.x)),
    y: Math.max(8, Math.min(window.innerHeight - 60, e.clientY - dragOff.y)),
  };
}
function onUp() { dragging = false; }

/* ── 上传队列 ── */
interface UpItem {
  file: File;
  /** 入队时生成的本地预览 URL(移除/卸载时 revoke) */
  thumb: string;
  status: 'waiting' | 'uploading' | 'ok' | 'fail';
  url?: string;
  error?: string;
}

const MAX_SIZE = 15 * 1024 * 1024;
const items = ref<UpItem[]>([]);
const busy = ref(false);
const dragOver = ref(false);

const doneCount = computed(() => items.value.filter((it) => it.status === 'ok').length);
const failCount = computed(() => items.value.filter((it) => it.status === 'fail').length);

function addFiles(list: FileList | File[] | null | undefined) {
  if (!list) return;
  for (const f of Array.from(list)) {
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(f.type)) {
      toast(`跳过非图片文件:${f.name}`, 'warn');
      continue;
    }
    if (f.size > MAX_SIZE) {
      toast(`跳过超过 15MB 的文件:${f.name}`, 'warn');
      continue;
    }
    items.value.push({ file: f, thumb: URL.createObjectURL(f), status: 'waiting' });
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  addFiles(input.files);
  input.value = '';
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  addFiles(e.dataTransfer?.files);
}

async function uploadAll() {
  if (busy.value) return;
  const pending = items.value.filter((it) => it.status === 'waiting' || it.status === 'fail');
  if (pending.length === 0) {
    toast('没有待上传的文件');
    return;
  }
  busy.value = true;
  for (const it of items.value) {
    if (it.status === 'ok' || it.status === 'uploading') continue;
    it.status = 'uploading';
    it.error = undefined;
    try {
      const fd = new FormData();
      fd.append('file', it.file);
      const r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      const json = await r.json() as { ok?: boolean; data?: { url?: string }; error?: string };
      if (!json.ok || !json.data?.url) throw new Error(json.error || 'HTTP ' + r.status);
      it.url = json.data.url;
      it.status = 'ok';
    } catch (err) {
      it.status = 'fail';
      it.error = err instanceof Error ? err.message : String(err);
    }
  }
  busy.value = false;
  toast(`上传完成:成功 ${doneCount.value},失败 ${failCount.value}`, failCount.value ? 'warn' : 'success');
}

async function copyUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast('已复制外链', 'success');
  } catch {
    toast('复制失败,请手动复制', 'error');
  }
}

function removeItem(i: number) {
  const it = items.value[i];
  if (!it || it.status === 'uploading') return;
  URL.revokeObjectURL(it.thumb);
  items.value.splice(i, 1);
}

function clearDone() {
  const keep: UpItem[] = [];
  for (const it of items.value) {
    if (it.status === 'ok') URL.revokeObjectURL(it.thumb);
    else keep.push(it);
  }
  items.value = keep;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
  window.removeEventListener('keydown', onKeydown);
  for (const it of items.value) URL.revokeObjectURL(it.thumb);
});
</script>

<template>
  <Teleport to="body">
    <div class="modal">
      <div class="modal-mask" @click="emit('close')" />
      <div class="upload-board" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
        <div class="upload-head" @mousedown.prevent="onHeadDown">
          <h2 class="modal-title">🖼 上传图片到图床</h2>
          <button class="upload-head-close" aria-label="关闭" @click="emit('close')">×</button>
        </div>

        <!-- 拖放区 -->
        <div
          class="upload-drop"
          :class="{ 'is-over': dragOver }"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop.prevent="onDrop"
        >
          <p class="upload-drop-main">把图片拖到这里,或</p>
          <label class="btn btn-primary upload-pick">
            选择文件
            <input type="file" accept="image/*" multiple hidden @change="onPick">
          </label>
          <p class="upload-drop-sub">支持 png / jpg / webp / gif / avif,单张 ≤ 15MB</p>
        </div>

        <!-- 队列列表 -->
        <div v-if="items.length" class="upload-list">
          <div
            v-for="(it, i) in items"
            :key="`${it.file.name}-${it.file.lastModified}-${i}`"
            class="upload-item"
            :class="'is-' + it.status"
          >
            <img :src="it.thumb" alt="" class="upload-thumb">
            <div class="upload-item-main">
              <div class="upload-item-name" :title="it.file.name">{{ it.file.name }}</div>
              <div class="upload-item-status">
                <template v-if="it.status === 'waiting'">等待上传</template>
                <template v-else-if="it.status === 'uploading'">上传中…</template>
                <template v-else-if="it.status === 'ok'">
                  <span class="upload-item-url" :title="it.url">{{ it.url }}</span>
                </template>
                <template v-else>✗ {{ it.error }}</template>
              </div>
            </div>
            <div class="upload-item-actions">
              <button
                v-if="it.status === 'ok' && it.url"
                class="btn btn-small"
                title="复制外链"
                @click="copyUrl(it.url!)"
              >📋 复制</button>
              <button class="btn btn-small btn-ghost" title="移除" @click="removeItem(i)">✕</button>
            </div>
          </div>
        </div>

        <div class="upload-foot ctrl-row">
          <button class="btn btn-ghost btn-small" :disabled="doneCount === 0" @click="clearDone">清除已完成</button>
          <span class="ctrl-spacer" />
          <button class="btn btn-primary btn-small" :disabled="busy || items.length === 0" @click="uploadAll">
            {{ busy ? '上传中…' : `开始上传${items.length ? '(' + items.length + ')' : ''}` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
