/* ============================================================
 * useErrorBanner — 顶部错误横条单例
 * ------------------------------------------------------------
 *   - showBanner(msg)  显示 3 秒后自动淡出
 *   - dismiss()         用户点击 ✕ 立即关闭 + 写入 localStorage
 *   - localStorage 记忆 dismiss:同一会话内(本次浏览器)不再弹相同提示
 * ============================================================ */
import { ref } from 'vue';

const BANNER_LS_KEY = 'lumina.banner.dismissed';

/** 已 dismiss 的消息集合:启动时从 localStorage 读入,
 *  否则「不再提示」刷新即失效(只写不读)。 */
function readDismissed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(BANNER_LS_KEY) || '{}') || {}; } catch { return {}; }
}

const bannerState = {
  msg: ref(''),
  visible: ref(false),
  fading: ref(false),
};

let bannerTimer: ReturnType<typeof setTimeout> | null = null;
let bannerFadeTimer: ReturnType<typeof setTimeout> | null = null;

function showBanner(msg: string) {
  // 已 dismiss(本浏览器)→ 跳过,避免每次重试都弹
  if (readDismissed()[msg]) return;

  // 内外两个计时器都要清:否则淡出窗口内再次弹出/手动关闭时,
  // 残留的内层计时器会把刚显示的新横幅瞬间隐藏
  if (bannerTimer) clearTimeout(bannerTimer);
  if (bannerFadeTimer) { clearTimeout(bannerFadeTimer); bannerFadeTimer = null; }
  bannerState.msg.value = msg;
  bannerState.fading.value = false;
  bannerState.visible.value = true;
  bannerTimer = setTimeout(() => {
    bannerTimer = null;
    bannerState.fading.value = true;
    bannerFadeTimer = setTimeout(() => {
      bannerFadeTimer = null;
      bannerState.visible.value = false;
      bannerState.fading.value = false;
    }, 400);
  }, 3000);
}

function dismissBanner() {
  if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
  if (bannerFadeTimer) { clearTimeout(bannerFadeTimer); bannerFadeTimer = null; }
  bannerState.visible.value = false;
  bannerState.fading.value = false;
  try {
    // key 用消息原文:改文案即视为新提示,不会误伤旧记忆
    const dismissed = readDismissed();
    dismissed[bannerState.msg.value] = true;
    localStorage.setItem(BANNER_LS_KEY, JSON.stringify(dismissed));
  } catch {}
}

export function useErrorBanner() {
  return {
    ...bannerState,
    showBanner,
    dismiss: dismissBanner,
  };
}
