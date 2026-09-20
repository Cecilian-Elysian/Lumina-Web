<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import {
  useSettings, resetSettings,
  ROWS_RANGE, WIDTH_RANGE, SPEED_RANGE,
} from './settings';

const { settings } = useSettings();

/* 预览轨道:两份相同卡片序列 + translateX(-50%) 无缝循环 */
const previewCards = [0, 1, 2, 0, 1, 2];

const previewStyle = computed(() => ({
  animationDuration: (12 / settings.value.speed) + 's',
  animationPlayState: settings.value.animate ? 'running' : 'paused',
}));

/* 恢复默认后的确认文案 */
const hintVisible = ref(false);
let hintTimer: ReturnType<typeof setTimeout> | null = null;

function onReset() {
  resetSettings();
  hintVisible.value = true;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hintVisible.value = false; }, 2200);
}

onUnmounted(() => {
  if (hintTimer) clearTimeout(hintTimer);
});
</script>

<template>
  <section class="settings-hero">
    <h1 class="settings-title">设置</h1>
    <p class="settings-subtitle">调整图片墙的观感 — 偏好仅保存在本浏览器</p>
  </section>

  <main class="settings-main">
    <section class="settings-group" aria-label="图片墙设置">
      <div class="setting-row">
        <label class="setting-label" for="set-rows">行数</label>
        <input
          id="set-rows"
          v-model.number="settings.rows"
          type="range"
          :min="ROWS_RANGE.min"
          :max="ROWS_RANGE.max"
          step="1"
        >
        <output class="setting-value">{{ settings.rows }} 行</output>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="set-width">卡片宽度</label>
        <input
          id="set-width"
          v-model.number="settings.cardWidth"
          type="range"
          :min="WIDTH_RANGE.min"
          :max="WIDTH_RANGE.max"
          step="10"
        >
        <output class="setting-value">{{ settings.cardWidth }} px</output>
      </div>

      <div class="setting-row">
        <label class="setting-label" for="set-speed">滚动速度</label>
        <input
          id="set-speed"
          v-model.number="settings.speed"
          type="range"
          :min="SPEED_RANGE.min"
          :max="SPEED_RANGE.max"
          step="0.25"
        >
        <output class="setting-value">{{ settings.speed }}×</output>
      </div>

      <div class="setting-row">
        <span class="setting-label" id="set-anim-label">滚动动画</span>
        <button
          type="button"
          class="toggle"
          :class="{ on: settings.animate }"
          role="switch"
          :aria-checked="settings.animate ? 'true' : 'false'"
          aria-labelledby="set-anim-label"
          @click="settings.animate = !settings.animate"
        />
        <output class="setting-value">{{ settings.animate ? '开' : '关' }}</output>
      </div>
    </section>

    <section class="settings-preview" aria-label="效果预览">
      <div class="preview-track" :style="previewStyle">
        <div v-for="i in previewCards.length" :key="i" class="preview-card" />
      </div>
      <p class="preview-note">预览仅为示意,主页以真实图片效果为准</p>
    </section>

    <div class="settings-actions">
      <button type="button" class="settings-reset" @click="onReset">恢复默认</button>
      <span class="settings-hint" :class="{ show: hintVisible }">已恢复默认设置</span>
    </div>
  </main>
</template>
