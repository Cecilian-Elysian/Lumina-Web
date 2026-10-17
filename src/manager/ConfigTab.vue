<script setup lang="ts">
import { ref, reactive, computed, watchEffect, onMounted } from 'vue';
import {
  loadViewerConfig, saveConfig, toast,
  CONFIG_WHITELIST, type ConfigPatch,
} from './api';
import { registerSaver, setDirty } from './queue';

/** App 同时挂载四个 Tab,只有 active 的才有资格把按钮 Teleport 到顶栏 */
defineProps<{ active: boolean }>();

/* ============================================================
 * 配置 Tab — 编辑 src/site/config.ts 的版面/拉取字段
 *   - 仅白名单字段可改(rows/cardWidth/perPage/thumbWidth)
 *   - mode/token/字段映射等敏感键不可见改(服务端二次校验)
 *   - 保存走操作队列批量落盘;同步统一走「保存并部署」
 *   ⚠ 保存会重写 config.ts,手工注释会丢失(字段值保留)
 * ============================================================ */

const form = reactive({
  rows: 3,
  cardWidth: 300,
  perPage: 500,
  thumbWidth: '' as string,   // 空串 = null
});
/** 服务器端当前快照(dirty 对比基准) */
const snapshot = ref('');

const loading = ref(true);

function fillForm(cfg: NonNullable<Awaited<ReturnType<typeof loadViewerConfig>>>) {
  form.rows = cfg.rows ?? 3;
  form.cardWidth = cfg.cardWidth ?? 300;
  form.perPage = cfg.perPage ?? 100;
  form.thumbWidth = cfg.thumbWidth == null ? '' : String(cfg.thumbWidth);
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
  };
}

const dirty = computed(() => JSON.stringify(currentPatch()) !== snapshot.value);

/** 客户端预校验。范围必须与 src/site/settings.ts 的 ROWS_RANGE / WIDTH_RANGE 一致:
 *  站点 loadSettings() 会按自己的范围 clamp,写宽了只会「保存成功但被静默改掉」。 */
const validationError = computed(() => {
  const p = currentPatch();
  if (!Number.isInteger(p.rows) || p.rows! < 1 || p.rows! > 6) return '行数必须是 1–6 的整数';
  if (!Number.isInteger(p.cardWidth) || p.cardWidth! < 180 || p.cardWidth! > 560) return '卡片宽度必须是 180–560 的整数';
  if (!Number.isInteger(p.perPage) || p.perPage! < 1 || p.perPage! > 500) return '拉取上限必须是 1–500 的整数';
  if (p.thumbWidth != null && (!Number.isInteger(p.thumbWidth) || p.thumbWidth < 100 || p.thumbWidth > 2000)) {
    return '缩略图宽度必须是 100–2000 的整数或留空';
  }
  return '';
});

async function reload() {
  const cfg = await loadViewerConfig();
  if (cfg) fillForm(cfg);
  loading.value = false;
}

/* ── 保存(操作队列批量调用,无确认;校验失败视为未保存) ── */
async function saveConfigCore(): Promise<boolean> {
  if (validationError.value) {
    toast(validationError.value, 'error');
    return false;
  }
  if (!dirty.value) return true;
  const updated = await saveConfig(currentPatch());
  if (!updated) return false;
  toast(`已写回 config.ts(${updated.join(', ')})`, 'success');
  await reload();
  return true;
}

registerSaver('config', saveConfigCore);
watchEffect(() => setDirty('config', dirty.value));

onMounted(reload);
</script>

<template>
  <!-- 操作按钮(传送到顶栏;保存/部署统一走侧栏操作队列) -->
  <Teleport v-if="active" to="#bar-right">
    <button class="btn" :disabled="loading" @click="reload">↻ 重新读取</button>
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
          <input v-model.number="form.rows" type="number" min="1" max="6" step="1">
          <span class="config-hint">1–6,主页流动墙行数</span>
        </label>

        <label class="config-row">
          <span class="config-label">卡片宽度 (px)</span>
          <input v-model.number="form.cardWidth" type="number" min="180" max="560" step="10">
          <span class="config-hint">180–560,单张卡片基准宽度</span>
        </label>

        <label class="config-row">
          <span class="config-label">拉取上限 (张)</span>
          <input v-model.number="form.perPage" type="number" min="1" max="500" step="1">
          <span class="config-hint">1–500,最多拿多少张(图片墙靠轮换展示全部,不靠这个数)</span>
        </label>

        <label class="config-row">
          <span class="config-label">缩略图宽度</span>
          <input v-model="form.thumbWidth" type="text" placeholder="留空 = null(不改写)">
          <span class="config-hint">100–2000 或留空;实测 7bu.top 不支持改写,保持留空</span>
        </label>
      </section>

      <p v-if="validationError" class="config-error">{{ validationError }}</p>
    </template>
  </main>
</template>
