<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue';
import { useErrorBanner } from './composables';
import { useVisit } from './visit';
import { initScreensaver } from './screensaver';
import { formatInt } from '@/shared/utils';

/** 入口 HTML 内联脚本注入的视图标识(home / gallery / settings / notfound) */
const view = window.__VIEW__ || 'home';

/* 视图按需加载:四个页面共用一个入口,静态 import 会让 404.html(只有两行字)
 * 也下载并执行全站代码。异步组件把它拆成独立 chunk,各页只下自己那份。 */
const views = {
  home: defineAsyncComponent(() => import('./HomeView.vue')),
  gallery: defineAsyncComponent(() => import('./GalleryView.vue')),
  settings: defineAsyncComponent(() => import('./SettingsView.vue')),
  notfound: defineAsyncComponent(() => import('./NotFoundView.vue')),
} as const;
type ViewKey = keyof typeof views;

const currentView = computed(() => views[(view as ViewKey) in views ? (view as ViewKey) : 'notfound']);

/* 灯箱与屏保是全站常驻层(任意页面都能唤起),保持静态引入 */

/* 收藏区块已在设置页内(id="favs"),不再单列导航项,避免两个入口指向同一页 */
const navItems = [
  { href: 'index.html', key: 'home', text: '主页' },
  { href: 'gallery.html', key: 'gallery', text: '图集' },
  { href: 'settings.html', key: 'settings', text: '设置' },
] as const;

function isActive(key: (typeof navItems)[number]['key']): boolean {
  return view === key;
}

const banner = useErrorBanner();
const visit = useVisit();

onMounted(() => {
  visit.track();
  initScreensaver();
});
</script>

<template>
  <header class="navbar">
    <div><h1 class="navbar-title">Illusium Wall</h1></div>
    <nav class="navbar-nav" aria-label="主导航">
      <a
        v-for="item in navItems"
        :key="item.key"
        :href="item.href"
        class="navbar-link"
        :class="{ active: isActive(item.key) }"
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
  <ScreensaverOverlay />
</template>
