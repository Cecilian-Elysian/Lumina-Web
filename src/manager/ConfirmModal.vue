<script setup lang="ts">
import { onUnmounted, watch } from 'vue';
import { useConfirmState } from './confirm';

const { state, settle } = useConfirmState();

function onKeydown(e: KeyboardEvent) {
  if (!state.open) return;
  if (e.key === 'Escape') settle(false);
  // 危险操作(删除/清库类)不允许 Enter 快捷确认,防手滑
  else if (e.key === 'Enter' && !state.danger) settle(true);
}

watch(() => state.open, (open) => {
  if (open) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
});

onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="modal"
      role="alertdialog"
      aria-modal="true"
      :aria-label="state.title"
    >
      <div class="modal-mask" @click="settle(false)" />
      <div class="modal-body modal-body-small confirm-body">
        <h2 class="modal-title">{{ state.title }}</h2>
        <p class="confirm-message">{{ state.message }}</p>
        <div class="ctrl-row ctrl-actions">
          <button class="btn" @click="settle(false)">取消</button>
          <button
            class="btn"
            :class="state.danger ? 'btn-danger-solid' : 'btn-primary'"
            @click="settle(true)"
          >{{ state.confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
