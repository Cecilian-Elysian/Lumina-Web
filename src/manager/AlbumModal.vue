<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  mode: 'add' | 'rename';
  initialName: string;
}>();

const emit = defineEmits<{
  (e: 'save', name: string): void;
  (e: 'close'): void;
}>();

const name = ref(props.initialName);
const inputEl = ref<HTMLInputElement | null>(null);

function save() {
  const v = name.value.trim();
  if (!v) return;
  emit('save', v);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'Enter') save();
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  setTimeout(() => inputEl.value?.focus(), 50);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="modal" role="dialog" aria-modal="true" aria-label="编辑图集名">
    <div class="modal-mask" @click="emit('close')" />
    <div class="modal-body modal-body-small">
      <button class="modal-close" aria-label="关闭" @click="emit('close')">×</button>
      <h2 class="modal-title">{{ mode === 'add' ? '新建图集' : '重命名图集' }}</h2>
      <p class="modal-hint">给图集起个名字(中英文皆可)。id 自动生成。</p>
      <input
        ref="inputEl"
        v-model="name"
        type="text"
        class="album-edit-input"
        placeholder="例:德克萨斯"
        maxlength="40"
        @keyup.enter="save"
      >
      <div class="ctrl-row ctrl-actions">
        <span class="ctrl-spacer" />
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
