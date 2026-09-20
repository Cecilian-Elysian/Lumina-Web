import { createApp } from 'vue';
import App from './App.vue';
import { initSettings } from './settings';
import './styles.css';

initSettings();
createApp(App).mount('#app');
