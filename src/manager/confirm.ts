/* ============================================================
 * 全局确认弹窗 — Promise 化的毛玻璃 confirm
 * ------------------------------------------------------------
 * 用法:
 *   const ok = await confirmAsync({
 *     title: '删除图集', message: '该图集下 3 张图将降级。',
 *     danger: true, confirmText: '删除',
 *   });
 *   if (!ok) return;
 * 弹窗本体由 ConfirmModal.vue 渲染(App 挂载一次)。
 * ============================================================ */
import { reactive } from 'vue';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** 危险操作 → 确认按钮红色 */
  danger?: boolean;
  confirmText?: string;
}

const state = reactive({
  open: false,
  title: '',
  message: '',
  danger: false,
  confirmText: '确定',
});

let resolveFn: ((v: boolean) => void) | null = null;

export function confirmAsync(opts: ConfirmOptions): Promise<boolean> {
  // 已有弹窗未决时,前一个按取消结算(理论不会发生:按钮各自串行)
  if (resolveFn) resolveFn(false);
  state.title = opts.title;
  state.message = opts.message;
  state.danger = opts.danger ?? false;
  state.confirmText = opts.confirmText ?? '确定';
  state.open = true;
  return new Promise((resolve) => { resolveFn = resolve; });
}

/** ConfirmModal 调用:结算并关闭 */
export function settleConfirm(v: boolean) {
  state.open = false;
  const fn = resolveFn;
  resolveFn = null;
  fn?.(v);
}

/** ConfirmModal 渲染绑定 */
export function useConfirmState() {
  return { state, settle: settleConfirm };
}
