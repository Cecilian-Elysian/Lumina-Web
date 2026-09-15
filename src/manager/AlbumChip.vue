<script setup lang="ts">
import type { AlbumMeta } from '@/shared/types';

const props = defineProps<{
  album: AlbumMeta;
  count: number;
}>();

const emit = defineEmits<{
  (e: 'rename', id: string): void;
  (e: 'delete', id: string): void;
  (e: 'assign', url: string, albumId: string): void;
}>();

function onDrop(e: DragEvent) {
  const url = e.dataTransfer?.getData('text/url') || e.dataTransfer?.getData('text/plain');
  if (url) emit('assign', url, props.album.id);
}
</script>

<template>
  <div
    class="album-chip"
    :title="`拖图片到此处 = 加入「${album.name}」`"
    @dragover.prevent="$event.dataTransfer && ($event.dataTransfer.dropEffect = 'move')"
    @drop.prevent="onDrop"
  >
    <span class="album-chip-name">{{ album.name }}</span>
    <span class="album-chip-count">{{ count }}</span>
    <span class="album-chip-actions">
      <button class="album-chip-action" title="重命名" @click.stop="emit('rename', album.id)">✏️</button>
      <button class="album-chip-action is-danger" title="删除图集" @click.stop="emit('delete', album.id)">🗑</button>
    </span>
  </div>
</template>
