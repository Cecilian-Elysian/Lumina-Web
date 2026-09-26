/* ============================================================
 * 访客统计 — 模块级单例(页脚胶囊数据源)
 * ------------------------------------------------------------
 * track():页面加载时(App.vue 挂载)POST /api/visit 一次。
 * 服务端记完 PV/UV 后在【同一响应】里返回最新累计,省一次 GET。
 * 失败/未绑定 D1 → totals 保持 null,页脚统计段隐藏,零打扰。
 * ============================================================ */
import { ref } from 'vue';

export interface VisitDay {
  pv: number;
  uv: number;
}

export interface VisitTotals {
  pv: number;
  uv: number;
  today: VisitDay;
}

const state = { totals: ref<VisitTotals | null>(null) };

/** 每次页面加载只记一次(单例防重复) */
let tracked = false;

function toCount(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function sanitize(raw: unknown): VisitTotals | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const today = (o.today && typeof o.today === 'object' ? o.today : {}) as Record<string, unknown>;
  return {
    pv: toCount(o.pv),
    uv: toCount(o.uv),
    today: { pv: toCount(today.pv), uv: toCount(today.uv) },
  };
}

export function useVisit() {
  /** 记一次访问并接收最新累计(同一请求,无需单独 GET) */
  async function track(): Promise<void> {
    if (tracked) return;
    tracked = true;
    try {
      const res = await fetch('/api/visit', { method: 'POST', keepalive: true });
      const json = await res.json();
      if (res.ok && json && json.status && json.data) {
        state.totals.value = sanitize(json.data);
      }
    } catch {
      console.warn('[Lumina] 访客统计不可用(本地开发或未绑定 D1)');
    }
  }

  return { totals: state.totals, track };
}
