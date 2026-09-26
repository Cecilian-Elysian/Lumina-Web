import { createApp } from 'vue';
import App from './App.vue';
import { initSettings } from './settings';
import { initLikes } from './likes';
import './styles.css';

initSettings();
initLikes();
createApp(App).mount('#app');
