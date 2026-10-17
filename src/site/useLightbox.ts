/* ============================================================
 * useLightbox — 灯箱单例
 * ------------------------------------------------------------
 * 模块级单例状态:App.vue 渲染 <Lightbox/>,任意视图调用
 * useLightbox().open(...) 打开,共用同一份列表与键盘事件。
 * 附带缩放/平移状态(滚轮/双击/+/−/0 键),换图与开关自动复位。
 * ============================================================ */
import { ref, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue';
import type { LightboxItem } from '@/shared/types';
import { isScreensaverActive } from './screensaver';

const lbState = {
  isOpen: ref(false),
  items: ref<LightboxItem[]>([]),
  index: ref(0),
  /** 缩放(1–4)与平移偏移 px */
  scale: ref(1),
  tx: ref(0),
  ty: ref(0),
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
export const LIGHTBOX_ZOOM = { min: ZOOM_MIN, max: ZOOM_MAX, step: 0.25 } as const;

function lbResetView() {
  lbState.scale.value = ZOOM_MIN;
  lbState.tx.value = 0;
  lbState.ty.value = 0;
}

function lbZoomBy(d: number) {
  const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, lbState.scale.value + d));
  lbState.scale.value = s;
  if (s === ZOOM_MIN) { lbState.tx.value = 0; lbState.ty.value = 0; }
}

function lbOpen(list: LightboxItem[], start = 0) {
  lbState.items.value = list;
  lbState.index.value = start;
  lbState.isOpen.value = true;
  lbResetView();
}

function lbClose() {
  lbState.isOpen.value = false;
}

function lbNext() {
  const total = lbState.items.value.length;
  if (total === 0) return;
  lbState.index.value = (lbState.index.value + 1) % total;
  lbResetView();
}

function lbPrev() {
  const total = lbState.items.value.length;
  if (total === 0) return;
  lbState.index.value = (lbState.index.value - 1 + total) % total;
  lbResetView();
}

function lbOnKey(e: KeyboardEvent) {
  if (!lbState.isOpen.value) return;
  // 屏保激活时按键只用于退出屏保,不透传灯箱(防 Esc 连关两层/隐形切图)
  if (isScreensaverActive()) return;
  if (e.key === 'Escape') lbClose();
  else if (e.key === 'ArrowRight') lbNext();
  else if (e.key === 'ArrowLeft') lbPrev();
  else if (e.key === '+' || e.key === '=') lbZoomBy(LIGHTBOX_ZOOM.step);
  else if (e.key === '-') lbZoomBy(-LIGHTBOX_ZOOM.step);
  else if (e.key === '0') lbResetView();
}

/** 供外部只读灯箱开关状态(不注册键盘监听,任意上下文可调) */
export function lightboxIsOpen(): boolean {
  return lbState.isOpen.value;
}

export function useLightbox() {
  // 键盘监听只应由挂载的组件注册;测试等无实例上下文调用时跳过,
  // 消除 "onMounted is called when there is no active component instance" 警告
  if (getCurrentInstance()) {
    onMounted(() => window.addEventListener('keydown', lbOnKey));
    onUnmounted(() => window.removeEventListener('keydown', lbOnKey));
  }

  const current = computed<LightboxItem | null>(() =>
    lbState.items.value[lbState.index.value] ?? null,
  );

  return {
    isOpen: lbState.isOpen,
    items: lbState.items,
    index: lbState.index,
    scale: lbState.scale,
    tx: lbState.tx,
    ty: lbState.ty,
    current,
    open: lbOpen,
    close: lbClose,
    next: lbNext,
    prev: lbPrev,
    zoomBy: lbZoomBy,
    resetView: lbResetView,
  };
}
