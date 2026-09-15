<script setup lang="ts">
import { ref, computed } from 'vue';
import FocalTab from './FocalTab.vue';
import AlbumTab from './AlbumTab.vue';
import { provideManagerState, useToast } from './api';

provideManagerState();

const activeTab = ref<'focal' | 'album'>('focal');
const t = useToast();

const subText = computed(() => activeTab.value === 'focal'
  ? '为每张图标记主角位置,人脸再也不会被切'
  : '手动图集:创建图集 → 拖图片到图集。前端按图集分 section 展示');
</script>

<template>
  <header class="bar">
    <div class="bar-left">
      <h1 class="bar-title"><span class="bar-icon">✦</span> Lumina 管理器</h1>
      <span class="bar-sub">{{ subText }}</span>
    </div>
    <!-- 各 Tab 通过 <Teleport> 把操作按钮注入这里 -->
    <div id="bar-right" class="bar-right" />
  </header>

  <nav class="tabs">
    <button
      class="tab"
      :class="{ 'tab-active': activeTab === 'focal' }"
      @click="activeTab = 'focal'"
    >📍 焦点</button>
    <button
      class="tab"
      :class="{ 'tab-active': activeTab === 'album' }"
      @click="activeTab = 'album'"
    >📚 图集</button>
  </nav>

  <FocalTab v-show="activeTab === 'focal'" />
  <AlbumTab v-show="activeTab === 'album'" />

  <div class="toast" :class="[t.type.value ? 'toast-' + t.type.value : '', { hidden: !t.visible.value }]">
    {{ t.msg.value }}
  </div>
</template>
