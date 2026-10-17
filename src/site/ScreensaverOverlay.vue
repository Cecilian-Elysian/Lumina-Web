<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import type { CSSProperties } from 'vue';
import { useScreensaver, reportBrokenImage } from './screensaver';
import { useFocal, lightboxIsOpen } from './composables';
import { useSettings } from './settings';

/* ============================================================
 * 屏保遮罩 — App.vue 常驻挂载,但所有副作用由 active 驱动:
 *   active=true  → attach:绑定退出信号 / 锁滚动 / 重置免疫与提示
 *   active=false → detach:全部解绑恢复(组件卸载时兜底再跑一次)
 *
 *   - 双层 <img> 交叉淡入淡出(1.5s);首张双 rAF 点亮,
 *     确保浏览器先完成首帧样式计算,产生真实过渡(非硬切)
 *   - Ken Burns 缓慢缩放(时长 = 换图间隔 + 2s 缓冲);
 *     开关用 animation-play-state 控制:关闭=冻结当前缩放,不重启不跳变
 *     (注:播放中改间隔会按新时长重算动画进度,轻微跳一下,可接受)
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

/** 双 requestAnimationFrame:保证隐藏层已带初始样式完成一次渲染帧后再点亮 */
function raf2(cb: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

watch(current, (url) => {
  if (!url) return;
  if (!slotA.value && !slotB.value) {
    // 首张:先渲染到隐藏层,两帧后再点亮 → 从黑场淡入
    slotA.value = url;
    raf2(() => { if (active.value) showA.value = true; });
    return;
  }
  if (showA.value) slotB.value = url;
  else slotA.value = url;
  showA.value = !showA.value;
});

/** 图床死链:上报后自动跳下一张(坏图 0×0 渲染,表现为黑场一闪,故跳过) */
function onLayerError(url: string) {
  reportBrokenImage(url);
}

/* ---- Ken Burns 时长 = 间隔 + 2s 缓冲(淡入后仍有缓慢运动) ---- */
function layerStyle(url: string): CSSProperties {
  return {
    ...focalStyle(url),
    animationDuration: (settings.value.screensaver.intervalSec * 1000 + 2000) + 'ms',
    animationPlayState: settings.value.screensaver.kenBurns ? 'running' : 'paused',
  } as CSSProperties;
}

/* ---- 退出信号(800ms 免疫) ---- */
const IMMUNE_MS = 800;
let enteredAt = 0;

function onExitSignal() {
  if (performance.now() - enteredAt < IMMUNE_MS) return;
  hide();
}

/* ---- 首次操作提示:每次进入都显示,3s 后淡出 ---- */
const hintFading = ref(true);
let hintTimer: ReturnType<typeof setTimeout> | null = null;

function attach(): void {
  enteredAt = performance.now();
  window.addEventListener('pointerdown', onExitSignal);
  window.addEventListener('keydown', onExitSignal);
  window.addEventListener('wheel', onExitSignal, { passive: true });
  window.addEventListener('touchstart', onExitSignal, { passive: true });
  document.body.style.overflow = 'hidden';

  hintFading.value = false;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hintFading.value = true; }, 3000);
}

function detach(): void {
  window.removeEventListener('pointerdown', onExitSignal);
  window.removeEventListener('keydown', onExitSignal);
  window.removeEventListener('wheel', onExitSignal);
  window.removeEventListener('touchstart', onExitSignal);
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }

  // 滚动锁协调:灯箱仍开着时它持有自己的锁,不代解
  if (!lightboxIsOpen()) document.body.style.overflow = '';

  // 槽位复位:下次进入重新走「首张双 rAF 从黑场淡入」路径,旧图不残留
  slotA.value = '';
  slotB.value = '';
  showA.value = false;
}

/* active 驱动全部副作用;immediate 兼顾「挂载时已激活」(如 URL 直达)。
 * 放在所有 let 声明之后:immediate 回调此刻就会执行 detach */
watch(active, (on) => {
  if (on) attach();
  else detach();
}, { immediate: true });

onUnmounted(detach);
</script>

<template>
  <div v-if="active" class="screensaver" role="dialog" aria-label="屏保模式">
    <img
      v-if="slotA"
      class="ss-layer"
      :class="{ on: showA, kenburns: showA }"
      :src="slotA"
      :style="layerStyle(slotA)"
      alt=""
      draggable="false"
      @error="onLayerError(slotA)"
    >
    <img
      v-if="slotB"
      class="ss-layer"
      :class="{ on: !showA, kenburns: !showA }"
      :src="slotB"
      :style="layerStyle(slotB)"
      alt=""
      draggable="false"
      @error="onLayerError(slotB)"
    >
    <p class="ss-hint" :class="{ fade: hintFading }">屏保模式 · 点击 / 按键 / 滚轮退出</p>
  </div>
</template>
