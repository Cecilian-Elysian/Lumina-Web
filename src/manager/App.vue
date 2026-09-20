<script setup lang="ts">
import { ref, computed } from 'vue';
import FocalTab from './FocalTab.vue';
import AlbumTab from './AlbumTab.vue';
import TagTab from './TagTab.vue';
import ConfigTab from './ConfigTab.vue';
import { provideManagerState, useToast } from './api';

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
    <button
      class="tab"
      :class="{ 'tab-active': activeTab === 'tags' }"
      @click="activeTab = 'tags'"
    >🏷 标签</button>
    <button
      class="tab"
      :class="{ 'tab-active': activeTab === 'config' }"
      @click="activeTab = 'config'"
    >⚙ 配置</button>
  </nav>

  <FocalTab v-show="activeTab === 'focal'" />
  <AlbumTab v-show="activeTab === 'album'" />
  <TagTab v-show="activeTab === 'tags'" />
  <ConfigTab v-show="activeTab === 'config'" />

  <div class="toast" :class="[t.type.value ? 'toast-' + t.type.value : '', { hidden: !t.visible.value }]">
    {{ t.msg.value }}
  </div>
</template>
