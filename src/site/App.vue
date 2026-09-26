<script setup lang="ts">
import { computed, onMounted } from 'vue';
import HomeView from './HomeView.vue';
import GalleryView from './GalleryView.vue';
import NotFoundView from './NotFoundView.vue';
import SettingsView from './SettingsView.vue';
import Lightbox from './Lightbox.vue';
import { useErrorBanner } from './composables';
import { useVisit } from './visit';
import { formatInt } from '@/shared/utils';

/** 入口 HTML 内联脚本注入的视图标识(home / gallery / settings / notfound) */
const view = window.__VIEW__ || 'home';

const views = { home: HomeView, gallery: GalleryView, settings: SettingsView, notfound: NotFoundView } as const;
type ViewKey = keyof typeof views;

const currentView = computed(() => views[(view as ViewKey) in views ? (view as ViewKey) : 'notfound']);

const navItems = [
  { href: 'index.html', key: 'home', text: '主页' },
  { href: 'gallery.html', key: 'gallery', text: '图集' },
  { href: 'settings.html', key: 'settings', text: '设置' },
] as const;

const banner = useErrorBanner();
const visit = useVisit();

onMounted(() => {
  visit.track();
});
</script>

<template>
  <header class="navbar">
    <div><h1 class="navbar-title">Lumina-Web</h1></div>
    <nav class="navbar-nav" aria-label="主导航">
      <a
        v-for="item in navItems"
        :key="item.key"
        :href="item.href"
        class="navbar-link"
        :class="{ active: view === item.key }"
      >{{ item.text }}</a>
    </nav>
  </header>

  <div v-if="banner.visible.value" class="error-banner" :class="{ 'is-fading': banner.fading.value }" role="alert">
    <span class="error-banner-msg">{{ banner.msg.value }}</span>
    <button class="error-banner-close" type="button" aria-label="关闭通知" @click="banner.dismiss()">×</button>
  </div>

  <component :is="currentView" />

  <footer class="site-footer">
    <div class="footer-capsule">
      <a class="footer-link" href="https://github.com/Cecilian-Elysian/Lumina" target="_blank" rel="noopener">GitHub</a>
      <template v-if="visit.totals.value">
        <span class="footer-dot" aria-hidden="true">·</span>
        <span class="footer-stats">
          {{ formatInt(visit.totals.value.pv) }} 次照亮 · {{ formatInt(visit.totals.value.uv) }} 位旅人
          <span class="footer-tip" role="tooltip">
            今日 {{ formatInt(visit.totals.value.today.pv) }} 次照亮 · {{ formatInt(visit.totals.value.today.uv) }} 位旅人
          </span>
        </span>
      </template>
    </div>
  </footer>

  <Lightbox />
</template>
