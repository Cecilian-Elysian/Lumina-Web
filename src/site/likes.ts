/* ============================================================
 * 图片点赞 — 模块级单例(同 settings.ts / lbState 模式)
 * ------------------------------------------------------------
 * 数据:
 *   - 服务端计数:GET /api/likes 一次性拉全量 { [url]: count }
 *   - 访客已赞集合:localStorage lumina.liked(string[],键 = Image.url,
 *     与焦点/图集/标签查表约定一致)
 *   - 未绑定 D1 / 请求失败 → 静默降级,UI 不渲染不报错
 *
 * toggleLike 流程(乐观更新):
 *   1. 本地立即翻转已赞集合 + 计数 ±1,并持久化 LS
 *   2. POST /api/likes { url, delta } → 成功用服务端权威计数覆盖
 *   3. 失败回滚本地两处状态 + 错误横条提示(防重复弹:同 banner 逻辑)
 *
 * 并发防护:同一 url 的在途请求期间忽略再次点击(pending 集合)。
 * ============================================================ */
import { ref } from 'vue';
import { useErrorBanner } from './composables';

const LS_LIKED_KEY = 'lumina.liked';

export interface VisitLikePayload {
  url: string;
  count: number;
}

/* ---- 模块级单例状态 ---- */
const state = {
  /** 全量计数 { [url]: count }(服务端权威,成功响应时覆盖) */
  likes: ref<Record<string, number>>({}),
  /** 访客已赞集合(本地去重依据) */
  liked: ref<Set<string>>(readLiked()),
  /** 服务端计数是否就绪(false = 未绑定 D1 或首次拉取失败) */
  ready: ref(false),
};

/** 在途请求的 url,防连点重复计数 */
const pending = new Set<string>();

function readLiked(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LS_LIKED_KEY) || '[]');
    return Array.isArray(v) ? new Set(v.filter((u): u is string => typeof u === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeLiked(set: Set<string>): void {
  try {
    localStorage.setItem(LS_LIKED_KEY, JSON.stringify([...set]));
  } catch {
    /* 隐私模式等写入失败静默忽略 */
  }
}

/** 启动时拉一次全量计数;失败静默(ready 保持 false,UI 隐藏) */
export async function initLikes(): Promise<void> {
  try {
    const res = await fetch('/api/likes');
    const json = await res.json();
    const likes = json && json.data && json.data.likes;
    if (json && json.status && likes && typeof likes === 'object') {
      const clean: Record<string, number> = {};
      for (const [url, count] of Object.entries(likes as Record<string, unknown>)) {
        const n = Number(count);
        if (Number.isFinite(n) && n >= 0) clean[url] = Math.floor(n);
      }
      state.likes.value = clean;
      state.ready.value = true;
    }
  } catch {
    console.warn('[Lumina] 点赞计数拉取失败,点赞 UI 已隐藏');
  }
}

export function useLikes() {
  function likeCount(url: string): number {
    return state.likes.value[url] ?? 0;
  }

  function isLiked(url: string): boolean {
    return state.liked.value.has(url);
  }

  /** 点赞/取消(乐观更新 + 失败回滚);返回是否接受了本次操作 */
  function toggleLike(url: string): boolean {
    if (!state.ready.value || pending.has(url)) return false;

    const wasLiked = state.liked.value.has(url);
    const delta = wasLiked ? -1 : 1;
    const before = {
      liked: new Set(state.liked.value),
      likes: { ...state.likes.value },
    };

    // 1) 乐观更新 + LS 持久化
    const likedNext = new Set(state.liked.value);
    if (wasLiked) likedNext.delete(url);
    else likedNext.add(url);
    state.liked.value = likedNext;
    writeLiked(likedNext);

    const countNext = { ...state.likes.value };
    countNext[url] = Math.max(0, (countNext[url] ?? 0) + delta);
    state.likes.value = countNext;

    // 2) 服务端权威计数
    pending.add(url);
    fetch('/api/likes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, delta }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (res.ok && json && json.status && json.data && typeof json.data.count === 'number') {
          const authoritative = { ...state.likes.value };
          authoritative[url] = Math.max(0, Math.floor(json.data.count));
          state.likes.value = authoritative;
        } else {
          throw new Error((json && json.message) || `HTTP ${res.status}`);
        }
      })
      .catch((err) => {
        // 3) 回滚 + 提示
        state.liked.value = before.liked;
        state.likes.value = before.likes;
        writeLiked(before.liked);
        console.warn('[Lumina] 点赞失败已回滚:', err);
        useErrorBanner().showBanner('点赞失败，请稍后再试');
      })
      .finally(() => pending.delete(url));

    return true;
  }

  return { likes: state.likes, liked: state.liked, ready: state.ready, likeCount, isLiked, toggleLike };
}
