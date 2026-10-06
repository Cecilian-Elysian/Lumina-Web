<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import type { CSSProperties } from 'vue';
import { useScreensaver } from './screensaver';
import { useFocal } from './composables';
import { useSettings } from './settings';

/* ============================================================
 * 屏保遮罩 — App.vue 挂载,active 时全屏渲染
 *   - 双层 <img> 交叉淡入淡出(1.5s)
 *   - Ken Burns 缓慢缩放(时长 = 换图间隔 + 2s 缓冲,可关)
 *   - 焦点定位(复用焦点数据,防止 cover 裁脸)
 *   - 退出:pointerdown / keydown / wheel / touchstart 任一;
 *     进入后 800ms 输入免疫(防触发进入的那下点击立即退出)
 * ============================================================ */
const { active, current, hide } = useScreensaver();
const { focalStyle } = useFocal();
const { settings } = useSettings();

/* ---- 双层交叉淡入:A/B 两槽交替,显示层 .on ---- */
const slotA = ref('');
const slotB = ref('');
const showA = ref(false);

watch(current, (url) => {
  if (!url) return;
  if (!slotA.value && !slotB.value) {
    // 首张:先渲染到隐藏层,下一帧再点亮 → 从黑场淡入
    slotA.value = url;
    nextTick(() => { showA.value = true; });
    return;
  }
  if (showA.value) slotB.value = url;
  else slotA.value = url;
  showA.value = !showA.value;
}, { immediate: true });

/* ---- Ken Burns 时长 = 间隔 + 2s 缓冲(淡入后仍有缓慢运动) ---- */
function layerStyle(url: string): CSSProperties {
  return {
    ...focalStyle(url),
    animationDuration: (settings.value.screensaver.intervalSec * 1000 + 2000) + 'ms',
  } as CSSProperties;
}

/* ---- 退出信号(800ms 免疫) ---- */
const IMMUNE_MS = 800;
let enteredAt = 0;

function onExitSignal() {
  if (performance.now() - enteredAt < IMMUNE_MS) return;
  hide();
}

/* ---- 首次操作提示:3s 后淡出 ---- */
const hintFading = ref(false);
let hintTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  enteredAt = performance.now();
  window.addEventListener('pointerdown', onExitSignal);
  window.addEventListener('keydown', onExitSignal);
  window.addEventListener('wheel', onExitSignal, { passive: true });
  window.addEventListener('touchstart', onExitSignal, { passive: true });
  document.body.style.overflow = 'hidden';
  hintTimer = setTimeout(() => { hintFading.value = true; }, 3000);
});

onUnmounted(() => {
  window.removeEventListener('pointerdown', onExitSignal);
  window.removeEventListener('keydown', onExitSignal);
  window.removeEventListener('wheel', onExitSignal);
  window.removeEventListener('touchstart', onExitSignal);
  document.body.style.overflow = '';
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
});
</script>

<template>
  <div v-if="active" class="screensaver" role="dialog" aria-label="屏保模式">
    <img
      v-if="slotA"
      class="ss-layer"
      :class="{ on: showA, kenburns: showA && settings.screensaver.kenBurns }"
      :src="slotA"
      :style="layerStyle(slotA)"
      alt=""
      draggable="false"
    >
    <img
      v-if="slotB"
      class="ss-layer"
      :class="{ on: !showA, kenburns: !showA && settings.screensaver.kenBurns }"
      :src="slotB"
      :style="layerStyle(slotB)"
      alt=""
      draggable="false"
    >
    <p class="ss-hint" :class="{ fade: hintFading }">屏保模式 · 点击 / 按键 / 滚轮退出</p>
  </div>
</template>
