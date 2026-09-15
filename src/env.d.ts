/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

/** 由各入口 HTML 内联脚本设置,决定 App.vue 渲染哪个视图 */
interface Window {
  __VIEW__?: string;
}
