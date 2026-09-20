<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import {
  loadViewerConfig, saveConfig, syncDeploy, toast,
  CONFIG_WHITELIST, type ConfigPatch,
} from './api';

/* ============================================================
 * 配置 Tab — 编辑 src/site/config.ts 的版面/拉取字段
 *   - 仅白名单字段可改(rows/cardWidth/perPage/thumbWidth/lazyRootMargin)
 *   - mode/token/字段映射等敏感键不可见改(服务端二次校验)
 *   - 保存 = 合并写回;同步 = git 提交推送触发 CF 部署
 *   ⚠ 保存会重写 config.ts,手工注释会丢失(字段值保留)
 * ============================================================ */

const DATA_FILE = 'src/site/config.ts';

const form = reactive({
  rows: 3,
  cardWidth: 300,
  perPage: 100,
  thumbWidth: '' as string,   // 空串 = null
  lazyRootMargin: '200px',
});
/** 服务器端当前快照(dirty 对比基准) */
const snapshot = ref('');

const loading = ref(true);
const saving = ref(false);
const syncing = ref(false);

function fillForm(cfg: NonNullable<Awaited<ReturnType<typeof loadViewerConfig>>>) {
  form.rows = cfg.rows ?? 3;
  form.cardWidth = cfg.cardWidth ?? 300;
  form.perPage = cfg.perPage ?? 100;
  form.thumbWidth = cfg.thumbWidth == null ? '' : String(cfg.thumbWidth);
  form.lazyRootMargin = cfg.lazyRootMargin ?? '200px';
  snapshot.value = JSON.stringify(currentPatch());
}

/** 当前表单 → patch(仅合法化后的白名单字段) */
function currentPatch(): ConfigPatch {
  const tw = String(form.thumbWidth).trim();
  return {
    rows: Number(form.rows),
    cardWidth: Number(form.cardWidth),
    perPage: Number(form.perPage),
    thumbWidth: tw === '' ? null : Number(tw),
    lazyRootMargin: String(form.lazyRootMargin).trim(),
  };
}

const dirty = computed(() => JSON.stringify(currentPatch()) !== snapshot.value);

/** 客户端预校验(服务端还会再验一次) */
const validationError = computed(() => {
  const p = currentPatch();
  if (!Number.isInteger(p.rows) || p.rows! < 1 || p.rows! > 10) return '行数必须是 1–10 的整数';
  if (!Number.isInteger(p.cardWidth) || p.cardWidth! < 150 || p.cardWidth! > 600) return '卡片宽度必须是 150–600 的整数';
  if (!Number.isInteger(p.perPage) || p.perPage! < 1 || p.perPage! > 200) return '拉取上限必须是 1–200 的整数';
  if (p.thumbWidth != null && (!Number.isInteger(p.thumbWidth) || p.thumbWidth < 100 || p.thumbWidth > 2000)) {
    return '缩略图宽度必须是 100–2000 的整数或留空';
  }
  if (!/^\d+px$/.test(p.lazyRootMargin ?? '')) return '懒加载边距必须是形如 200px';
  return '';
});

async function reload() {
  const cfg = await loadViewerConfig();
  if (cfg) fillForm(cfg);
  loading.value = false;
}

async function onSave() {
  if (validationError.value) {
    toast(validationError.value, 'error');
    return;
  }
  if (!dirty.value) {
    toast('没有改动需要保存');
    return;
  }
  if (!confirm('将合并写回 config.ts(白名单字段)。\n⚠ 手工注释会被生成头替换,token/mode 不受影响。\n\n确定继续?')) return;
  saving.value = true;
  const updated = await saveConfig(currentPatch());
  saving.value = false;
  if (updated) {
    toast(`已写回 config.ts(${updated.join(', ')})`, 'success');
    await reload();
  }
}

async function onSync() {
  if (dirty.value) {
    toast('请先完成保存,再执行同步', 'error');
    return;
  }
  if (!confirm('将提交 config.ts 并推送到 GitHub,触发 Cloudflare 部署。继续吗?')) return;
  syncing.value = true;
  const msg = await syncDeploy(DATA_FILE);
  syncing.value = false;
  if (msg) toast(msg, 'success');
}

onMounted(reload);
</script>

<template>
  <!-- 操作按钮(传送到顶栏) -->
  <Teleport to="#bar-right">
    <button class="btn" :disabled="loading" @click="reload">↻ 重新读取</button>
    <button class="btn" :disabled="loading || saving" @click="onSave">
      {{ saving ? '保存中...' : '💾 保存到 viewer' }}
    </button>
    <button class="btn btn-primary" :disabled="loading || syncing" @click="onSync">
      {{ syncing ? '同步中...' : '↥ 同步并部署' }}
    </button>
  </Teleport>

  <main class="config-pane tab-pane">
    <div v-if="loading" class="empty">读取配置中…</div>

    <template v-else>
      <section class="status">
        <div class="status-item">
          <span class="status-label">状态</span>
          <span class="status-value">{{ dirty ? '● 有未保存改动' : '✓ 已保存' }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">可改字段</span>
          <span class="status-value">{{ CONFIG_WHITELIST.length }} 个</span>
        </div>
      </section>

      <p class="config-warn">
        ⚠ 保存会重写 <code>src/site/config.ts</code>(手工注释丢失,字段值保留);
        数据源模式 / token / 字段映射不在可改范围。
        保存后还需「同步并部署」才会更新线上站点。
      </p>

      <section class="config-form">
        <label class="config-row">
          <span class="config-label">图片墙行数</span>
          <input v-model.number="form.rows" type="number" min="1" max="10" step="1">
          <span class="config-hint">1–10,主页流动墙行数</span>
        </label>

        <label class="config-row">
          <span class="config-label">卡片宽度 (px)</span>
          <input v-model.number="form.cardWidth" type="number" min="150" max="600" step="10">
          <span class="config-hint">150–600,单张卡片基准宽度</span>
        </label>

        <label class="config-row">
          <span class="config-label">拉取上限 (张)</span>
          <input v-model.number="form.perPage" type="number" min="1" max="200" step="1">
          <span class="config-hint">1–200,代理分页合并后的返回上限</span>
        </label>

        <label class="config-row">
          <span class="config-label">缩略图宽度</span>
          <input v-model="form.thumbWidth" type="text" placeholder="留空 = null(不改写)">
          <span class="config-hint">100–2000 或留空;实测 7bu.top 不支持改写,保持留空</span>
        </label>

        <label class="config-row">
          <span class="config-label">懒加载边距</span>
          <input v-model="form.lazyRootMargin" type="text" placeholder="200px">
          <span class="config-hint">形如 200px,IntersectionObserver rootMargin</span>
        </label>
      </section>

      <p v-if="validationError" class="config-error">{{ validationError }}</p>
    </template>
  </main>
</template>
