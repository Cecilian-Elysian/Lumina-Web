<script setup lang="ts">
import { ref, computed } from 'vue';
import FocalTab from './FocalTab.vue';
import AlbumTab from './AlbumTab.vue';
import TagTab from './TagTab.vue';
import ConfigTab from './ConfigTab.vue';
import ConfirmModal from './ConfirmModal.vue';
import UploadBoard from './UploadBoard.vue';
import { provideManagerState, useToast, syncDeploy, toast } from './api';
import {
  dirtyFiles, dirtyCount, saveAll, fileOf, FILE_LABELS, type FileKey,
} from './queue';
import { confirmAsync } from './confirm';

provideManagerState();

const activeTab = ref<'focal' | 'album' | 'tags' | 'config'>('focal');
const t = useToast();

const subTexts: Record<typeof activeTab.value, string> = {
  focal: '为每张图标记主角位置,人脸再也不会被切',
  album: '手动图集:创建图集 → 拖图片到图集。前端按图集分 section 展示',
  tags: '给图片打标签:图集页搜索与灯箱都会用到',
  config: '站点配置:行数/卡片宽度/拉取上限(白名单字段)',
};
const subText = computed(() => subTexts[activeTab.value]);

const navItems: { key: typeof activeTab.value; icon: string; label: string }[] = [
  { key: 'focal', icon: '📍', label: '焦点' },
  { key: 'album', icon: '📚', label: '图集' },
  { key: 'tags', icon: '🏷', label: '标签' },
  { key: 'config', icon: '⚙', label: '配置' },
];

/* ── 操作队列:统一保存 / 保存并部署 ── */
const saving = ref(false);
const deploying = ref(false);
const uploadOpen = ref(false);

async function onSaveAll() {
  if (saving.value || deploying.value) return;
  if (dirtyCount.value === 0) {
    toast('没有待保存的改动');
    return;
  }
  const names = dirtyFiles.value.map((k) => FILE_LABELS[k]).join('、');
  const ok = await confirmAsync({
    title: '保存全部改动',
    message: `将写入 ${names} 共 ${dirtyCount.value} 个数据文件。`,
  });
  if (!ok) return;
  saving.value = true;
  try {
    const saved = await saveAll();
    if (saved.length > 0) toast(`已保存 ${saved.map((k) => FILE_LABELS[k]).join('、')}`, 'success');
  } finally {
    // 保存失败抛错也必须解锁按钮,否则「保存中…」永久卡死
    saving.value = false;
  }
}

async function onSaveDeploy() {
  if (saving.value || deploying.value) return;
  if (dirtyCount.value === 0) {
    toast('没有待部署的改动(先编辑再保存)', 'warn');
    return;
  }
  const names = dirtyFiles.value.map((k) => FILE_LABELS[k]).join('、');
  const ok = await confirmAsync({
    title: '保存并部署',
    message: `将保存 ${names} 共 ${dirtyCount.value} 个文件,并逐个推送到 GitHub 触发 Cloudflare 部署。`,
    confirmText: '保存并部署',
  });
  if (!ok) return;
  deploying.value = true;
  try {
    const saved = await saveAll();
    let okCount = 0;
    for (const key of saved as FileKey[]) {
      const msg = await syncDeploy(fileOf(key));
      if (!msg) break; // syncDeploy 内部已 toast 错误
      okCount++;
    }
    if (okCount > 0) toast(`已部署 ${okCount} 个文件,Cloudflare Pages 将自动构建`, 'success');
  } finally {
    deploying.value = false;
  }
}
</script>

<template>
  <div class="shell">
    <!-- 侧边栏:导航 + 操作队列 -->
    <aside class="side">
      <div class="side-brand"><span class="side-brand-icon">✦</span> Lumina 管理器</div>

      <nav class="side-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="side-item"
          :class="{ 'side-item-active': activeTab === item.key }"
          @click="activeTab = item.key"
        >
          <span class="side-item-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="side-foot">
        <div class="queue">
          <span class="queue-dot" :class="{ on: dirtyCount > 0 }" />
          <span class="queue-text">
            {{ dirtyCount > 0 ? `${dirtyFiles.map((k) => FILE_LABELS[k]).join('、')} 待保存` : '暂无待保存改动' }}
          </span>
        </div>
        <button
          class="btn btn-block"
          :disabled="saving || deploying || dirtyCount === 0"
          @click="onSaveAll"
        >{{ saving ? '保存中…' : '💾 保存全部' }}</button>
        <button
          class="btn btn-primary btn-block"
          :disabled="saving || deploying || dirtyCount === 0"
          @click="onSaveDeploy"
        >{{ deploying ? '部署中…' : '🚀 保存并部署' }}</button>
        <button class="btn btn-ghost btn-block" @click="uploadOpen = true">🖼 上传图片</button>
      </div>
    </aside>

    <!-- 工作区 -->
    <div class="workspace">
      <header class="bar">
        <span class="bar-sub">{{ subText }}</span>
        <!-- 各 Tab 通过 <Teleport> 把操作按钮注入这里 -->
        <div id="bar-right" class="bar-right" />
      </header>

      <main class="content">
        <!-- active prop:四个 Tab 因 v-show 同时挂载,Teleport 的顶栏按钮
             必须只在自家 Tab 激活时渲染,否则四个 Tab 的按钮全部挤进顶栏 -->
        <FocalTab :active="activeTab === 'focal'" v-show="activeTab === 'focal'" />
        <AlbumTab :active="activeTab === 'album'" v-show="activeTab === 'album'" />
        <TagTab :active="activeTab === 'tags'" v-show="activeTab === 'tags'" />
        <ConfigTab :active="activeTab === 'config'" v-show="activeTab === 'config'" />
      </main>
    </div>
  </div>

  <UploadBoard v-if="uploadOpen" @close="uploadOpen = false" />
  <ConfirmModal />

  <div class="toast" :class="[t.type.value ? 'toast-' + t.type.value : '', { hidden: !t.visible.value }]">
    {{ t.msg.value }}
  </div>
</template>
